import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { excludedSet } from './_util';
import { pricingHistoryRecord } from '../schema/index';

/**
 * B-15 (revised): the imported legacy pricing-app history. Reads run under the caller's RLS context
 * (commercial roles only); writes are the Admin import. Rows are never deleted.
 */

export type PricingHistoryRecordRow = typeof pricingHistoryRecord.$inferSelect;
export type NewPricingHistoryRecord = typeof pricingHistoryRecord.$inferInsert;
export type PricingHistoryKindKey = 'erf' | 'bpr' | 'spr';

const t = pricingHistoryRecord;

const WRITTEN = [
  'requestNumber',
  'requestNumberKey',
  'fiscalYear',
  'status',
  'displayStatus',
  'isOpen',
  'customer',
  'customerKey',
  'productDescription',
  'itemNumber',
  'salesPerson',
  'market',
  'process',
  'resin',
  'plantCode',
  'plantName',
  'submittedOn',
  'estRevenueUsd',
  'estVolume',
  'comments',
  'fields',
  'importRunId',
] as const;

/** `xmax = 0` is true for a row the statement inserted, false for one it updated. */
const wasInserted = sql<boolean>`(xmax = 0)`;

/**
 * Insert or refresh rows by (kind, request id). A row whose export values and derived columns are
 * unchanged is left alone, so re-importing the same file writes nothing.
 */
export async function upsertPricingHistory(
  db: DbOrTx,
  rows: NewPricingHistoryRecord[],
): Promise<{ inserted: number; updated: number; unchanged: number }> {
  if (rows.length === 0) return { inserted: 0, updated: 0, unchanged: 0 };
  const written = await db
    .insert(t)
    .values(rows)
    .onConflictDoUpdate({
      target: [t.kind, t.requestId],
      set: { ...excludedSet(t, WRITTEN), updatedAt: new Date() },
      setWhere: sql`${t.fields} is distinct from excluded.fields
        or ${t.status} is distinct from excluded.status
        or ${t.customerKey} is distinct from excluded.customer_key
        or ${t.submittedOn} is distinct from excluded.submitted_on
        or ${t.estRevenueUsd} is distinct from excluded.est_revenue_usd
        or ${t.estVolume} is distinct from excluded.est_volume`,
    })
    .returning({ inserted: wasInserted });
  const inserted = written.filter((r) => r.inserted).length;
  return { inserted, updated: written.length - inserted, unchanged: rows.length - written.length };
}

/** Which of these request ids are already stored for `kind` (the import check's new / existing). */
export async function existingPricingHistoryIds(
  db: DbOrTx,
  kind: PricingHistoryKindKey,
  requestIds: number[],
): Promise<Set<number>> {
  if (requestIds.length === 0) return new Set();
  const rows = await db
    .select({ id: t.requestId })
    .from(t)
    .where(and(eq(t.kind, kind), inArray(t.requestId, requestIds)));
  return new Set(rows.map((r) => r.id));
}

/** Rows with this request number key, newest first (numbers repeat in the export). */
export const getPricingHistoryByNumber = (
  db: DbOrTx,
  kind: PricingHistoryKindKey,
  requestNumberKey: string,
) =>
  db
    .select()
    .from(t)
    .where(and(eq(t.kind, kind), eq(t.requestNumberKey, requestNumberKey)))
    .orderBy(desc(t.submittedOn), desc(t.requestId));

/** Rows for any of these number keys (the quote context resolves several at once). */
export const listPricingHistoryByNumbers = (
  db: DbOrTx,
  kind: PricingHistoryKindKey,
  requestNumberKeys: string[],
) =>
  requestNumberKeys.length === 0
    ? Promise.resolve([] as PricingHistoryRecordRow[])
    : db
        .select()
        .from(t)
        .where(and(eq(t.kind, kind), inArray(t.requestNumberKey, requestNumberKeys)))
        .orderBy(desc(t.submittedOn), desc(t.requestId));

/** A customer's records of `kind`, newest first, without the given number keys. */
export const listPricingHistoryForCustomer = (
  db: DbOrTx,
  kind: PricingHistoryKindKey,
  customerKey: string,
  limit: number,
  excludeNumberKeys: string[] = [],
) =>
  db
    .select()
    .from(t)
    .where(
      and(
        eq(t.kind, kind),
        eq(t.customerKey, customerKey),
        excludeNumberKeys.length ? notInArray(t.requestNumberKey, excludeNumberKeys) : undefined,
      ),
    )
    .orderBy(sql`${t.submittedOn} desc nulls last`, desc(t.requestId))
    .limit(limit);

const like = (text: string) => `%${text.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

export interface PricingHistorySearch {
  kind: PricingHistoryKindKey;
  /** Customer contains this. */
  customer?: string | undefined;
  /** Request number, product description, item number or customer contains this. */
  q?: string | undefined;
  fiscalYearFrom?: number | undefined;
  fiscalYearTo?: number | undefined;
  limit: number;
}

/** The Pricing history search: every filter given must match; newest first. */
export function searchPricingHistory(db: DbOrTx, p: PricingHistorySearch) {
  const where: (SQL | undefined)[] = [eq(t.kind, p.kind)];
  if (p.customer?.trim()) where.push(ilike(t.customer, like(p.customer)));
  if (p.q?.trim()) {
    const q = like(p.q);
    where.push(
      or(
        ilike(t.requestNumber, q),
        ilike(t.productDescription, q),
        ilike(t.itemNumber, q),
        ilike(t.customer, q),
      ),
    );
  }
  if (p.fiscalYearFrom !== undefined) where.push(gte(t.fiscalYear, p.fiscalYearFrom));
  if (p.fiscalYearTo !== undefined) where.push(lte(t.fiscalYear, p.fiscalYearTo));
  return db
    .select()
    .from(t)
    .where(and(...where))
    .orderBy(sql`${t.submittedOn} desc nulls last`, desc(t.requestId))
    .limit(p.limit);
}

/** How many records of each kind are stored (what the caller may see under RLS). */
export async function countPricingHistory(
  db: DbOrTx,
): Promise<Record<PricingHistoryKindKey, number>> {
  const rows = await db
    .select({ kind: t.kind, n: sql<number>`count(*)::int` })
    .from(t)
    .groupBy(t.kind);
  const out = { erf: 0, bpr: 0, spr: 0 };
  for (const r of rows) out[r.kind as PricingHistoryKindKey] = r.n;
  return out;
}
