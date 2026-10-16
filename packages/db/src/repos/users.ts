import type { Role, Scope } from '@ccq/domain';
import { and, asc, eq, ilike, inArray, notInArray, or } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { excludedSet, first } from './_util';
import { appUser, userRole, userScope } from '../schema/index';

export type AppUser = typeof appUser.$inferSelect;
export type NewAppUser = typeof appUser.$inferInsert;

export const findUserById = async (db: DbOrTx, id: string) =>
  first(await db.select().from(appUser).where(eq(appUser.id, id)));

export const findUserByEntraOid = async (db: DbOrTx, entraOid: string) =>
  first(await db.select().from(appUser).where(eq(appUser.entraOid, entraOid)));

/** Insert or refresh a user by Entra object id (B-04 calls this on authenticated requests). */
export async function upsertUser(db: DbOrTx, user: NewAppUser): Promise<AppUser> {
  const [row] = await db
    .insert(appUser)
    .values(user)
    .onConflictDoUpdate({
      target: appUser.entraOid,
      set: {
        ...excludedSet(appUser, ['upn', 'displayName', 'email', 'lastSeenAt']),
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}

export async function listUserRoles(db: DbOrTx, userId: string): Promise<Role[]> {
  const rows = await db
    .select({ role: userRole.role })
    .from(userRole)
    .where(eq(userRole.userId, userId));
  return rows.map((r) => r.role as Role);
}

/** Make the stored roles exactly `roles` (the token is the source of truth). */
export async function syncUserRoles(
  db: DbOrTx,
  userId: string,
  roles: readonly Role[],
): Promise<void> {
  if (roles.length === 0) {
    await db.delete(userRole).where(eq(userRole.userId, userId));
    return;
  }
  await db
    .delete(userRole)
    .where(and(eq(userRole.userId, userId), notInArray(userRole.role, [...roles])));
  await db
    .insert(userRole)
    .values(roles.map((role) => ({ userId, role })))
    .onConflictDoNothing();
}

export async function getUserScope(db: DbOrTx, userId: string): Promise<Scope | undefined> {
  const row = first(await db.select().from(userScope).where(eq(userScope.userId, userId)));
  if (!row) return undefined;
  if (row.scopeType === 'region' || row.scopeType === 'account_list') {
    return { type: row.scopeType, values: row.values };
  }
  return { type: row.scopeType as 'all' | 'owner' };
}

export async function setUserScope(db: DbOrTx, userId: string, scope: Scope): Promise<void> {
  const values = 'values' in scope ? [...scope.values] : [];
  await db
    .insert(userScope)
    .values({ userId, scopeType: scope.type, values })
    .onConflictDoUpdate({
      target: userScope.userId,
      set: { ...excludedSet(userScope, ['scopeType', 'values']), updatedAt: new Date() },
    });
}

export const listUsersByIds = (db: DbOrTx, ids: string[]) =>
  ids.length === 0
    ? Promise.resolve([])
    : db.select().from(appUser).where(inArray(appUser.id, ids));

/** Active users whose name, UPN or email matches `q` (the @mention picker). Identity tables have no RLS. */
export function searchUsers(db: DbOrTx, q: string, limit = 10) {
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db
    .select({
      id: appUser.id,
      displayName: appUser.displayName,
      upn: appUser.upn,
      email: appUser.email,
    })
    .from(appUser)
    .where(
      and(
        eq(appUser.active, true),
        or(
          ilike(appUser.displayName, pattern),
          ilike(appUser.upn, pattern),
          ilike(appUser.email, pattern),
        ),
      ),
    )
    .orderBy(asc(appUser.displayName))
    .limit(limit);
}

/** Active users holding any of the roles (notification recipients by role). */
export async function listActiveUserIdsWithRoles(
  db: DbOrTx,
  roles: readonly Role[],
): Promise<string[]> {
  if (roles.length === 0) return [];
  const rows = await db
    .selectDistinct({ id: appUser.id })
    .from(appUser)
    .innerJoin(userRole, eq(userRole.userId, appUser.id))
    .where(and(eq(appUser.active, true), inArray(userRole.role, [...roles])));
  return rows.map((r) => r.id);
}
