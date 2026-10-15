import { ROLES } from '@ccq/domain';
import type { Actor, Role, Scope } from '@ccq/domain';
import { sql } from 'drizzle-orm';

import type { Database, Tx } from './client';
import { isUuid } from './ids';

/** Database roles a request may run as. The API always uses `ccq_app`. */
export const DB_ROLES = ['ccq_app', 'ccq_readonly', 'ccq_migrator'] as const;
export type DbRole = (typeof DB_ROLES)[number];

export interface RequestContext {
  userId: string;
  roles: readonly Role[];
  scope: Scope;
}

export interface WithRequestContextOptions {
  /**
   * `SET LOCAL ROLE` for the transaction so RLS applies even when the pool connects as a more
   * privileged login (e.g. the local superuser). Defaults to `ccq_app`; `null` keeps the login's role.
   */
  dbRole?: DbRole | null;
}

/** Build the context from a domain `Actor` (what B-04 attaches as `req.actor`). */
export const contextFromActor = (actor: Actor): RequestContext => ({
  userId: actor.userId,
  roles: actor.roles,
  scope: actor.scope,
});

function scopeValues(scope: Scope): readonly string[] {
  return scope.type === 'region' || scope.type === 'account_list' ? scope.values : [];
}

/** Validates the context; throws rather than let a malformed value reach the RLS settings. */
export function contextSettings(ctx: RequestContext): Record<string, string> {
  if (!isUuid(ctx.userId)) throw new Error('request context: userId must be a UUID');
  for (const role of ctx.roles) {
    if (!(ROLES as readonly string[]).includes(role))
      throw new Error(`request context: unknown role ${role}`);
  }
  const values = scopeValues(ctx.scope);
  for (const value of values) {
    if (value.includes(',') || value.trim() === '') {
      throw new Error('request context: scope values must be non-empty and contain no commas');
    }
  }
  return {
    'app.user_id': ctx.userId,
    'app.roles': ctx.roles.join(','),
    'app.scope_type': ctx.scope.type,
    'app.scope_values': values.join(','),
  };
}

/**
 * Run `fn` in a transaction with the request context applied (`SET LOCAL` semantics via
 * `set_config(..., true)`), so Postgres RLS sees who is asking. Everything resets at commit/rollback.
 */
export async function withRequestContext<T>(
  db: Database,
  ctx: RequestContext,
  fn: (tx: Tx) => Promise<T>,
  { dbRole = 'ccq_app' }: WithRequestContextOptions = {},
): Promise<T> {
  const settings = contextSettings(ctx);
  return db.transaction(async (tx) => {
    if (dbRole) {
      if (!(DB_ROLES as readonly string[]).includes(dbRole))
        throw new Error(`unknown db role ${dbRole}`);
      await tx.execute(sql.raw(`set local role ${dbRole}`));
    }
    const pairs = Object.entries(settings).map(
      ([name, value]) => sql`set_config(${name}, ${value}, true)`,
    );
    await tx.execute(sql`select ${sql.join(pairs, sql`, `)}`);
    return fn(tx);
  });
}

/**
 * Run `fn` in a transaction as `ccq_app` with **no** user context. Only for sign-in provisioning,
 * which runs before the user id is known and touches identity tables only (no RLS on them).
 * Any RLS-protected table reads as empty here.
 */
export async function withAppRole<T>(db: Database, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw('set local role ccq_app'));
    return fn(tx);
  });
}
