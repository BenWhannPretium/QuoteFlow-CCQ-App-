import { and, count, desc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { appUser, notification, quote, userPreference } from '../schema/index';

// B-18 notifications: the in-app feed, the email outbox and per-user email preferences. Reads and
// writes only; which events exist, who gets them and what an email says is the API's and the domain's.

export type NotificationRow = typeof notification.$inferSelect;
export type NewNotification = typeof notification.$inferInsert;

/**
 * Insert notification rows. A row whose (user, channel, dedupe key) already exists is skipped, which is
 * how "once per state" and "one digest per day" hold across job re-runs, restarts and instances.
 *
 * No `RETURNING`: a request context sees only its own notifications (RLS), and `RETURNING` reads the new
 * row back through that policy, so a KAM creating the EngLead's alert would be refused. Use
 * `insertNotificationRowsCounted` where the context may read the rows (the system jobs).
 */
export async function insertNotificationRows(db: DbOrTx, values: NewNotification[]): Promise<void> {
  if (values.length === 0) return;
  await db.insert(notification).values(values).onConflictDoNothing();
}

/** As `insertNotificationRows`, returning what was inserted. Only for contexts that can read every row. */
export async function insertNotificationRowsCounted(
  db: DbOrTx,
  values: NewNotification[],
): Promise<{ id: string; userId: string; channel: string }[]> {
  if (values.length === 0) return [];
  return db
    .insert(notification)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: notification.id, userId: notification.userId, channel: notification.channel });
}

// ── In-app feed ─────────────────────────────────────────────────────────────────────────────────

export interface FeedPage {
  limit: number;
  /** Return rows strictly older than this (createdAt, id) keyset. */
  before?: { createdAt: Date; id: string } | undefined;
  unreadOnly?: boolean | undefined;
}

/** A page of the caller's in-app notifications, newest first, with the unread count. */
export async function listNotificationFeed(db: DbOrTx, userId: string, page: FeedPage) {
  const where = [eq(notification.userId, userId), eq(notification.channel, 'in_app')];
  if (page.unreadOnly) where.push(isNull(notification.readAt));
  if (page.before) {
    where.push(
      or(
        lt(notification.createdAt, page.before.createdAt),
        and(eq(notification.createdAt, page.before.createdAt), lt(notification.id, page.before.id)),
      )!,
    );
  }
  const [items, unread] = await Promise.all([
    db
      .select({ notification, quoteNumber: quote.quoteNumber })
      .from(notification)
      .leftJoin(quote, eq(quote.id, notification.quoteId))
      .where(and(...where))
      .orderBy(desc(notification.createdAt), desc(notification.id))
      // One extra row tells the caller whether there is a next page.
      .limit(page.limit + 1),
    countUnreadInApp(db, userId),
  ]);
  return { items, unread };
}

export async function countUnreadInApp(db: DbOrTx, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notification)
    .where(
      and(
        eq(notification.userId, userId),
        eq(notification.channel, 'in_app'),
        isNull(notification.readAt),
      ),
    );
  return row?.n ?? 0;
}

/** Mark one of the caller's in-app notifications read. False when it is not theirs or not found. */
export async function markInAppRead(
  db: DbOrTx,
  userId: string,
  id: string,
  at: Date,
): Promise<boolean> {
  const rows = await db
    .update(notification)
    // A raw Date in an `sql` template is not serialized: pass an ISO string with a cast.
    // `coalesce` keeps the first read time when it is read again.
    .set({ readAt: sql`coalesce(${notification.readAt}, ${at.toISOString()}::timestamptz)` })
    .where(
      and(
        eq(notification.id, id),
        eq(notification.userId, userId),
        eq(notification.channel, 'in_app'),
      ),
    )
    .returning({ id: notification.id });
  return rows.length > 0;
}

/** Mark all of the caller's unread in-app notifications read. Email rows have no read state. */
export async function markAllInAppRead(db: DbOrTx, userId: string, at: Date): Promise<number> {
  const rows = await db
    .update(notification)
    .set({ readAt: at })
    .where(
      and(
        eq(notification.userId, userId),
        eq(notification.channel, 'in_app'),
        isNull(notification.readAt),
      ),
    )
    .returning({ id: notification.id });
  return rows.length;
}

// ── Email outbox ────────────────────────────────────────────────────────────────────────────────

/**
 * Email rows due now (never sent, not failed, retry time reached), oldest first. `FOR UPDATE SKIP
 * LOCKED` keeps two dispatchers off the same row if the advisory lock were ever bypassed.
 */
export function claimDueEmails(db: DbOrTx, now: Date, limit: number) {
  return db
    .select()
    .from(notification)
    .where(
      and(
        eq(notification.channel, 'email'),
        isNull(notification.sentAt),
        isNull(notification.failedAt),
        lte(notification.nextAttemptAt, now),
      ),
    )
    .orderBy(notification.createdAt, notification.id)
    .limit(limit)
    .for('update', { skipLocked: true });
}

export async function markEmailSent(db: DbOrTx, id: string, at: Date, attempts: number) {
  await db
    .update(notification)
    .set({ sentAt: at, attempts, error: null, nextAttemptAt: null, updatedAt: at })
    .where(eq(notification.id, id));
}

/** A failed try: schedule the next one (`nextAttemptAt`) or, when the tries are used up, `failedAt`. */
export async function markEmailAttemptFailed(
  db: DbOrTx,
  id: string,
  at: Date,
  fields: { attempts: number; error: string; nextAttemptAt: Date | null },
) {
  await db
    .update(notification)
    .set({
      attempts: fields.attempts,
      error: fields.error,
      nextAttemptAt: fields.nextAttemptAt,
      failedAt: fields.nextAttemptAt ? null : at,
      updatedAt: at,
    })
    .where(eq(notification.id, id));
}

/** Email addresses and status for a set of recipients. */
export const listUsersForEmail = (db: DbOrTx, ids: string[]) =>
  ids.length === 0
    ? Promise.resolve([])
    : db
        .select({
          id: appUser.id,
          email: appUser.email,
          displayName: appUser.displayName,
          active: appUser.active,
        })
        .from(appUser)
        .where(inArray(appUser.id, ids));

// ── Preferences ─────────────────────────────────────────────────────────────────────────────────

/** Users (of `userIds`) who opted out of the email behind `key`. A missing row means opted in. */
export async function listEmailOptOuts(
  db: DbOrTx,
  userIds: readonly string[],
  key: string,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db
    .select({ userId: userPreference.userId, value: userPreference.value })
    .from(userPreference)
    .where(and(inArray(userPreference.userId, [...userIds]), eq(userPreference.key, key)));
  return new Set(rows.filter((r) => r.value === false).map((r) => r.userId));
}

export const listUserPreferences = (db: DbOrTx, userId: string) =>
  db
    .select({ key: userPreference.key, value: userPreference.value })
    .from(userPreference)
    .where(eq(userPreference.userId, userId));

export async function setUserPreference(
  db: DbOrTx,
  userId: string,
  key: string,
  value: unknown,
  at: Date,
  actorId: string,
) {
  await db
    .insert(userPreference)
    .values({ userId, key, value, createdAt: at, updatedAt: at, createdBy: actorId })
    .onConflictDoUpdate({
      target: [userPreference.userId, userPreference.key],
      set: { value, updatedAt: at },
    });
}

/** Quote numbers for ids (the owner alert names the quotes whose email failed). */
export async function listQuoteNumbersByIds(
  db: DbOrTx,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: quote.id, quoteNumber: quote.quoteNumber })
    .from(quote)
    .where(inArray(quote.id, [...ids]));
  return new Map(rows.map((r) => [r.id, r.quoteNumber]));
}

/** A queued email row was passed over (recipient gone, opted out, email switched off): never due again. */
export async function markEmailSkipped(db: DbOrTx, id: string, at: Date, reason: string) {
  await db
    .update(notification)
    .set({ error: `skipped: ${reason}`, nextAttemptAt: null, updatedAt: at })
    .where(eq(notification.id, id));
}
