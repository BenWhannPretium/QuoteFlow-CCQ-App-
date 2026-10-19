import { and, desc, eq, gte, lt, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import type { NewAuditEvent } from './events';
import { appUser, auditEvent, quote } from '../schema/index';

// Usage audit (F-12, B-09): reads for the admin viewer, the CSV export and the adoption report.
// RLS: a ccq_app caller reads every row only as Leadership/Admin (otherwise just their own).

/** Whether the actor already has an `action` row on this quote at or after `since` (view debounce). */
export async function hasQuoteAuditSince(
  db: DbOrTx,
  actorId: string,
  quoteId: string,
  action: NewAuditEvent['action'],
  since: Date,
): Promise<boolean> {
  const rows = await db
    .select({ id: auditEvent.id })
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.actorId, actorId),
        eq(auditEvent.quoteId, quoteId),
        eq(auditEvent.action, action),
        gte(auditEvent.at, since),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Transaction-scoped advisory lock on a string key (serialises the view debounce across instances). */
export async function lockKey(db: DbOrTx, key: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

export interface AuditSearch {
  actorId?: string | undefined;
  quoteId?: string | undefined;
  action?: NewAuditEvent['action'] | undefined;
  /** B-19 decision log: one config table. */
  entity?: string | undefined;
  from?: Date | undefined;
  /** Exclusive. */
  to?: Date | undefined;
  before?: { at: Date; id: string } | undefined;
  limit: number;
}

export function searchAuditEvents(db: DbOrTx, s: AuditSearch) {
  const where: SQL[] = [];
  if (s.actorId) where.push(eq(auditEvent.actorId, s.actorId));
  if (s.quoteId) where.push(eq(auditEvent.quoteId, s.quoteId));
  if (s.action) where.push(eq(auditEvent.action, s.action));
  if (s.entity) where.push(eq(auditEvent.entity, s.entity));
  if (s.from) where.push(gte(auditEvent.at, s.from));
  if (s.to) where.push(lt(auditEvent.at, s.to));
  if (s.before) {
    const { at, id } = s.before;
    where.push(or(lt(auditEvent.at, at), and(eq(auditEvent.at, at), lt(auditEvent.id, id)))!);
  }
  return db
    .select({
      event: auditEvent,
      actorName: appUser.displayName,
      actorUpn: appUser.upn,
      quoteNumber: quote.quoteNumber,
    })
    .from(auditEvent)
    .leftJoin(appUser, eq(appUser.id, auditEvent.actorId))
    .leftJoin(quote, eq(quote.id, auditEvent.quoteId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(auditEvent.at), desc(auditEvent.id))
    .limit(s.limit);
}

export type AuditSearchRow = Awaited<ReturnType<typeof searchAuditEvents>>[number];

export interface UsageReportRows {
  dailyActiveUsers: { day: string; role: string; users: number }[];
  quotesViewed: { day: string; quotes: number; views: number }[];
  actionsByType: { action: string; count: number }[];
  totals: { activeUsers: number; quotesViewed: number; views: number; events: number };
}

/**
 * Adoption (PRD 8.2) from the audit log: daily active users by role, quotes viewed per day and actions
 * by type over [from, to). Days are calendar days in `timeZone` (an IANA name, e.g. America/Chicago).
 */
export async function usageReport(
  db: DbOrTx,
  from: Date,
  to: Date,
  timeZone: string,
): Promise<UsageReportRows> {
  const range = sql`${auditEvent.at} >= ${from.toISOString()}::timestamptz and ${auditEvent.at} < ${to.toISOString()}::timestamptz and ${auditEvent.actorId} is not null`;
  const day = sql`to_char(${auditEvent.at} at time zone ${timeZone}, 'YYYY-MM-DD')`;
  const [dau, viewed, actions, totals] = await Promise.all([
    db.execute<{ day: string; role: string; users: number }>(sql`
      select ${day} as day, r.role, count(distinct ${auditEvent.actorId})::int as users
      from ${auditEvent} cross join lateral unnest(${auditEvent.actorRoles}) as r(role)
      where ${range}
      group by 1, 2 order by 1, 2`),
    db.execute<{ day: string; quotes: number; views: number }>(sql`
      select ${day} as day, count(distinct ${auditEvent.quoteId})::int as quotes, count(*)::int as views
      from ${auditEvent}
      where ${range} and ${auditEvent.action} = 'view' and ${auditEvent.quoteId} is not null
      group by 1 order by 1`),
    db.execute<{ action: string; count: number }>(sql`
      select ${auditEvent.action} as action, count(*)::int as count
      from ${auditEvent} where ${range}
      group by 1 order by 2 desc, 1`),
    db.execute<{ active_users: number; quotes_viewed: number; views: number; events: number }>(sql`
      select count(distinct ${auditEvent.actorId})::int as active_users,
        count(distinct ${auditEvent.quoteId}) filter (where ${auditEvent.action} = 'view')::int as quotes_viewed,
        count(*) filter (where ${auditEvent.action} = 'view')::int as views,
        count(*)::int as events
      from ${auditEvent} where ${range}`),
  ]);
  const t = [...totals][0];
  return {
    dailyActiveUsers: [...dau],
    quotesViewed: [...viewed],
    actionsByType: [...actions],
    totals: {
      activeUsers: t?.active_users ?? 0,
      quotesViewed: t?.quotes_viewed ?? 0,
      views: t?.views ?? 0,
      events: t?.events ?? 0,
    },
  };
}
