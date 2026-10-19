import { withAppRole, withRequestContext, type Database } from '@ccq/db';
import {
  findUserByEntraOid,
  getSetting,
  getUserScope,
  hasAuditSince,
  insertAuditEvent,
  listSettings,
  setUserScope,
  syncUserRoles,
  upsertUser,
} from '@ccq/db/repos';
import type { Role, Scope } from '@ccq/domain';

import { AuthError, type Identity } from './identity';

/** A signed-in user after provisioning: what the request context is built from. */
export interface ProvisionedUser {
  userId: string;
  displayName: string;
  upn: string;
  email: string | null;
  roles: Role[];
  scope: Scope;
}

export interface RequestMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

/** Persistence behind sign-in. Postgres in the app; an in-memory fake in unit tests. */
export interface UserDirectory {
  /** Upsert `app_user` by oid, make `user_role` match the token, and load the data scope. */
  provision(identity: Identity): Promise<ProvisionedUser>;
  /** Append a `sign_in` audit row unless the user already has one since `since`. True if written. */
  recordSignIn(user: ProvisionedUser, since: Date, meta: RequestMeta): Promise<boolean>;
  /** Boolean app settings, camelCased (`g1_enabled` → `g1Enabled`). */
  featureFlags(): Promise<Record<string, boolean>>;
}

const camel = (key: string) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** `default_scope_type` app setting (PRD lean: full pipeline). Only value-less scopes can be defaults. */
export function defaultScopeFrom(setting: unknown): Scope {
  return setting === 'owner' ? { type: 'owner' } : { type: 'all' };
}

export function createPgDirectory(db: Database, now: () => Date = () => new Date()): UserDirectory {
  return {
    provision: (identity) =>
      withAppRole(db, async (tx) => {
        // Dev personas keep the seeded profile (faker names) when the database has been seeded.
        const existing = identity.dev ? await findUserByEntraOid(tx, identity.oid) : undefined;
        const user = await upsertUser(tx, {
          entraOid: identity.oid,
          upn: existing?.upn ?? identity.upn,
          displayName: existing?.displayName ?? identity.displayName,
          email: existing ? existing.email : identity.email,
          lastSeenAt: now(),
        });
        if (!user.active) {
          throw new AuthError(
            'no_role',
            403,
            'Your QuoteFlow account is deactivated; contact an admin',
          );
        }
        await syncUserRoles(tx, user.id, identity.roles);

        let scope = await getUserScope(tx, user.id);
        if (!scope && identity.dev) {
          await setUserScope(tx, user.id, identity.dev.scope);
          scope = identity.dev.scope;
        }
        scope ??= defaultScopeFrom(await getSetting(tx, 'default_scope_type'));

        return {
          userId: user.id,
          displayName: user.displayName,
          upn: user.upn,
          email: user.email,
          roles: identity.roles,
          scope,
        };
      }),

    recordSignIn: (user, since, meta) =>
      withRequestContext(db, user, async (tx) => {
        if (await hasAuditSince(tx, user.userId, 'sign_in', since)) return false;
        await insertAuditEvent(tx, {
          actorId: user.userId,
          actorRoles: [...user.roles],
          action: 'sign_in',
          entity: 'app_user',
          entityId: user.userId,
          ip: meta.ip ?? null,
          userAgent: meta.userAgent ?? null,
          requestId: meta.requestId ?? null,
        });
        return true;
      }),

    featureFlags: () =>
      withAppRole(db, async (tx) => {
        const flags: Record<string, boolean> = {};
        for (const s of await listSettings(tx)) {
          if (typeof s.value === 'boolean') flags[camel(s.key)] = s.value;
        }
        return flags;
      }),
  };
}

/** For apps built without a database (health-only unit tests): any sign-in is a 500. */
export function unavailableDirectory(): UserDirectory {
  const fail = () => Promise.reject(new Error('No database configured for user provisioning'));
  return { provision: fail, recordSignIn: fail, featureFlags: fail };
}

export const PROVISION_CACHE_MS = 5 * 60_000;
export const SIGN_IN_WINDOW_MS = 8 * 60 * 60_000;
const MAX_CACHE_ENTRIES = 10_000;

const sameRoles = (a: readonly Role[], b: readonly Role[]) =>
  a.length === b.length && a.every((r) => b.includes(r));

/**
 * Provisioning with a 5-minute cache per oid (a role change in the token bypasses the cache, so
 * removed roles take effect on the next request) and one `sign_in` audit per user per 8 hours.
 */
export function createIdentityService(
  directory: UserDirectory,
  {
    now = () => new Date(),
    cacheMs = PROVISION_CACHE_MS,
    signInWindowMs = SIGN_IN_WINDOW_MS,
  }: { now?: () => Date; cacheMs?: number; signInWindowMs?: number } = {},
) {
  const cache = new Map<string, { user: ProvisionedUser; at: number }>();
  const lastSignInCheck = new Map<string, number>();

  return {
    async resolve(identity: Identity, meta: RequestMeta): Promise<ProvisionedUser> {
      const t = now().getTime();
      const hit = cache.get(identity.oid);
      let user: ProvisionedUser;
      if (hit && t - hit.at < cacheMs && sameRoles(hit.user.roles, identity.roles)) {
        user = hit.user;
      } else {
        user = await directory.provision(identity);
        if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
        cache.set(identity.oid, { user, at: t });
      }

      const checked = lastSignInCheck.get(user.userId);
      if (checked === undefined || t - checked >= signInWindowMs) {
        await directory.recordSignIn(user, new Date(t - signInWindowMs), meta);
        if (lastSignInCheck.size >= MAX_CACHE_ENTRIES) lastSignInCheck.clear();
        lastSignInCheck.set(user.userId, t);
      }
      return user;
    },
    featureFlags: () => directory.featureFlags(),
    /**
     * Forget cached users (B-19: after an admin edits a data scope, so this instance applies it on the
     * next request; other instances pick it up when their 5-minute cache entry expires).
     */
    clear: () => cache.clear(),
  };
}

export type IdentityService = ReturnType<typeof createIdentityService>;
