import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { activityEvent, auditEvent, notification } from '../schema/index';

export type NewAuditEvent = typeof auditEvent.$inferInsert;

/** Append-only: there is deliberately no update or delete function for audit or activity rows. */
export async function insertAuditEvent(db: DbOrTx, values: NewAuditEvent) {
  const [row] = await db.insert(auditEvent).values(values).returning();
  return row!;
}

export const listAuditForQuote = (db: DbOrTx, quoteId: string, limit = 200) =>
  db
    .select()
    .from(auditEvent)
    .where(eq(auditEvent.quoteId, quoteId))
    .orderBy(desc(auditEvent.at))
    .limit(limit);

export async function insertActivityEvent(db: DbOrTx, values: typeof activityEvent.$inferInsert) {
  const [row] = await db.insert(activityEvent).values(values).returning();
  return row!;
}

export const listActivity = (db: DbOrTx, quoteId: string) =>
  db
    .select()
    .from(activityEvent)
    .where(eq(activityEvent.quoteId, quoteId))
    .orderBy(asc(activityEvent.at));

export async function insertNotification(db: DbOrTx, values: typeof notification.$inferInsert) {
  const [row] = await db.insert(notification).values(values).returning();
  return row!;
}

export const listUnreadNotifications = (db: DbOrTx, userId: string) =>
  db
    .select()
    .from(notification)
    .where(and(eq(notification.userId, userId), isNull(notification.readAt)))
    .orderBy(desc(notification.createdAt));

export const markNotificationRead = (db: DbOrTx, id: string, at: Date) =>
  db.update(notification).set({ readAt: at }).where(eq(notification.id, id));
