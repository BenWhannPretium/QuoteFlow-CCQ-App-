import { toSnakeCase } from '@ccq/domain';
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import type { DbOrTx } from '../client';
import { first } from './_util';
import type { ValueListKey } from '../schema/enums';
import {
  appSetting,
  appUser,
  customer,
  engReview,
  gateDefinition,
  gateOutcomeDefinition,
  integrationRun,
  quote,
  reasonCode,
  scoringModel,
  stageDefinition,
  userRole,
  userScope,
  valueList,
} from '../schema/index';

// B-19 admin configuration console (CR-51). Thin reads and writes; the API service validates, audits
// and decides. Every write is optimistic: it names the row version it read and fails if it moved.

/** A config table the console edits: every one has `id` and the `version` from `configColumns()`. */
type VersionedTable = PgTable & { id: PgColumn; version: PgColumn; updatedAt: PgColumn };

export type VersionedUpdate<T> = { ok: true; row: T } | { ok: false; reason: 'missing' | 'stale' };

/**
 * `update … set …, version = version + 1 where id = :id and version = :expected`. Nothing updated
 * means the row is gone (`missing`) or someone else changed it first (`stale` → 409).
 */
export async function updateVersioned<T extends VersionedTable>(
  db: DbOrTx,
  table: T,
  id: string,
  expectedVersion: number,
  set: Partial<T['$inferInsert']>,
): Promise<VersionedUpdate<T['$inferSelect']>> {
  const t = table as VersionedTable;
  const rows = (await db
    .update(t)
    .set({ ...set, version: sql`${t.version} + 1`, updatedAt: new Date() })
    .where(and(eq(t.id, id), eq(t.version, expectedVersion)))
    .returning()) as T['$inferSelect'][];
  const row = first(rows);
  if (row) return { ok: true, row };
  const exists = first(await db.select({ id: t.id }).from(t).where(eq(t.id, id)));
  return { ok: false, reason: exists ? 'stale' : 'missing' };
}

export const findById = async <T extends VersionedTable>(db: DbOrTx, table: T, id: string) =>
  first(
    (await db
      .select()
      .from(table as VersionedTable)
      .where(eq((table as VersionedTable).id, id))) as T['$inferSelect'][],
  );

// ── Value lists and reason codes ────────────────────────────────────────────────────────────────

export type ValueListRow = typeof valueList.$inferSelect;
export type ReasonCodeRow = typeof reasonCode.$inferSelect;

/** Every entry, active or not, in list then display order. */
export const listAllValueLists = (db: DbOrTx) =>
  db
    .select()
    .from(valueList)
    .orderBy(asc(valueList.listKey), asc(valueList.sort), asc(valueList.code));

export const listAllReasonCodes = (db: DbOrTx) =>
  db
    .select()
    .from(reasonCode)
    .orderBy(asc(reasonCode.context), asc(reasonCode.sort), asc(reasonCode.code));

export async function insertValueListEntry(db: DbOrTx, row: typeof valueList.$inferInsert) {
  const [created] = await db.insert(valueList).values(row).returning();
  return created!;
}

export async function insertReasonCode(db: DbOrTx, row: typeof reasonCode.$inferInsert) {
  const [created] = await db.insert(reasonCode).values(row).returning();
  return created!;
}

/** Next sort value at the end of a list (sorts step by 10, like the seeds). */
export async function nextSort(
  db: DbOrTx,
  table: typeof valueList | typeof reasonCode,
  where: SQL,
): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${table.sort})` })
    .from(table)
    .where(where);
  return (row?.max ?? 0) + 10;
}

/** Where each value list is stored on an open quote (quote columns, or the engineering review). */
function usageCondition(listKey: ValueListKey, code: string): SQL {
  switch (listKey) {
    case 'product_family':
      return eq(quote.productFamily, code);
    case 'market':
      return eq(quote.market, code);
    case 'resin':
      return eq(quote.resin, code);
    case 'component':
      return sql`${code} = any(${quote.components})`;
    case 'drawing_status':
      return eq(quote.drawingStatus, code);
    case 'neck_finish':
      return eq(quote.neckFinish, code);
    case 'packaging_type':
      return eq(quote.packagingType, code);
    case 'request_class':
      return eq(quote.requestClass, code);
    case 'process_type':
      return eq(engReview.processType, code);
    case 'machine_type':
      return eq(engReview.machineType, code);
    case 'plant':
      return eq(engReview.plantCode, code);
    case 'tooling_funding_model':
      return eq(quote.toolingFundingModel, code);
  }
}

/** Open (not closed) quotes that carry `code` for `listKey`: the count and up to 10 quote numbers. */
export async function openQuotesUsingValue(
  db: DbOrTx,
  listKey: ValueListKey,
  code: string,
): Promise<{ count: number; quoteNumbers: string[] }> {
  const rows = await db
    .select({ quoteNumber: quote.quoteNumber })
    .from(quote)
    .leftJoin(engReview, eq(engReview.quoteId, quote.id))
    .where(and(ne(quote.status, 'closed'), usageCondition(listKey, code)))
    .orderBy(asc(quote.quoteNumber));
  return { count: rows.length, quoteNumbers: rows.slice(0, 10).map((r) => r.quoteNumber) };
}

// ── Workflow labels and rules ───────────────────────────────────────────────────────────────────

export const listStageRows = (db: DbOrTx) =>
  db.select().from(stageDefinition).orderBy(asc(stageDefinition.sort));
export const listGateRows = (db: DbOrTx) =>
  db.select().from(gateDefinition).orderBy(asc(gateDefinition.sort));
export const listOutcomeRows = (db: DbOrTx) =>
  db
    .select()
    .from(gateOutcomeDefinition)
    .orderBy(asc(gateOutcomeDefinition.gateKey), asc(gateOutcomeDefinition.sort));

export const findGateByKey = async (db: DbOrTx, key: string) =>
  first(await db.select().from(gateDefinition).where(eq(gateDefinition.key, key)));

/** Open quotes sitting in `stageKey` that were submitted (e.g. waiting at G1). */
export async function countSubmittedOpenQuotesInStage(
  db: DbOrTx,
  stageKey: string,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(quote)
    .where(
      and(eq(quote.stageKey, stageKey), ne(quote.status, 'closed'), isNotNull(quote.submittedAt)),
    );
  return row?.n ?? 0;
}

// ── App settings ────────────────────────────────────────────────────────────────────────────────

export type AppSettingRow = typeof appSetting.$inferSelect;
export const findSettingByKey = async (db: DbOrTx, key: string) =>
  first(await db.select().from(appSetting).where(eq(appSetting.key, key)));

// ── Scoring model versions ──────────────────────────────────────────────────────────────────────

export type ScoringModelVersionRow = typeof scoringModel.$inferSelect;

/** Every version, newest first (the draft, if any, has no effective_from). */
export const listScoringModels = (db: DbOrTx) =>
  db.select().from(scoringModel).orderBy(desc(scoringModel.modelVersion));

export const findScoringDraft = async (db: DbOrTx) =>
  first(await db.select().from(scoringModel).where(isNull(scoringModel.effectiveFrom)));

export async function nextScoringModelVersion(db: DbOrTx): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${scoringModel.modelVersion})` })
    .from(scoringModel);
  return (row?.max ?? 0) + 1;
}

export async function insertScoringModel(db: DbOrTx, row: typeof scoringModel.$inferInsert) {
  const [created] = await db.insert(scoringModel).values(row).returning();
  return created!;
}

/** Discard the draft (a draft never scored anything, so nothing refers to it). */
export async function deleteScoringDraft(db: DbOrTx, id: string, expectedVersion: number) {
  const rows = await db
    .delete(scoringModel)
    .where(
      and(
        eq(scoringModel.id, id),
        eq(scoringModel.version, expectedVersion),
        isNull(scoringModel.effectiveFrom),
      ),
    )
    .returning({ id: scoringModel.id });
  return rows.length > 0;
}

/** Ids of every open (not closed) quote: what a new scoring model rescores. */
export async function openQuoteIds(db: DbOrTx): Promise<string[]> {
  const rows = await db
    .select({ id: quote.id })
    .from(quote)
    .where(ne(quote.status, 'closed'))
    .orderBy(asc(quote.quoteNumber));
  return rows.map((r) => r.id);
}

/** The most recently created quotes, newest first, for the scoring preview. */
export const recentQuotesForPreview = (db: DbOrTx, limit: number) =>
  db
    .select({
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      stageKey: quote.stageKey,
      status: quote.status,
      priorityScore: quote.priorityScore,
      priorityTier: quote.priorityTier,
    })
    .from(quote)
    .orderBy(desc(quote.createdAt), desc(quote.id))
    .limit(limit);

const snake = (row: object | undefined | null): Record<string, unknown> | null =>
  row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [toSnakeCase(k), v])) : null;

/**
 * `loadScoringFacts` for many quotes in three queries (the preview scores 50 at a time). Same shape:
 * `{ quote, customer, eng_review }` with snake_case keys.
 */
export async function loadScoringFactsMany(
  db: DbOrTx,
  quoteIds: readonly string[],
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  if (quoteIds.length === 0) return out;
  const ids = [...quoteIds];
  const quotes = await db.select().from(quote).where(inArray(quote.id, ids));
  const customerIds = [...new Set(quotes.map((q) => q.customerId).filter((c) => c !== null))];
  const [reviews, customers] = await Promise.all([
    db.select().from(engReview).where(inArray(engReview.quoteId, ids)),
    customerIds.length
      ? db
          .select({ id: customer.id, status: customer.status, name: customer.name })
          .from(customer)
          .where(inArray(customer.id, customerIds))
      : Promise.resolve([]),
  ]);
  const reviewBy = new Map(reviews.map((r) => [r.quoteId, r]));
  const customerBy = new Map(customers.map((c) => [c.id, c]));
  for (const q of quotes) {
    const cust = q.customerId ? customerBy.get(q.customerId) : undefined;
    out.set(q.id, {
      quote: snake(q),
      customer: cust ? { status: cust.status, name: cust.name } : null,
      eng_review: snake(reviewBy.get(q.id)),
    });
  }
  return out;
}

// ── Users and scope ─────────────────────────────────────────────────────────────────────────────

export interface AdminUserRow {
  id: string;
  displayName: string;
  upn: string;
  email: string | null;
  region: string | null;
  active: boolean;
  lastSeenAt: Date | null;
  roles: string[];
  scopeType: string | null;
  scopeValues: string[] | null;
  scopeVersion: number | null;
}

/** Every user with their (token-synced) roles and their scope row, if any. */
export async function listUsersForAdmin(db: DbOrTx): Promise<AdminUserRow[]> {
  const rows = await db
    .select({
      id: appUser.id,
      displayName: appUser.displayName,
      upn: appUser.upn,
      email: appUser.email,
      region: appUser.region,
      active: appUser.active,
      lastSeenAt: appUser.lastSeenAt,
      roles: sql<
        string[]
      >`coalesce(array_agg(${userRole.role} order by ${userRole.role}) filter (where ${userRole.role} is not null), '{}')`,
      scopeType: userScope.scopeType,
      scopeValues: userScope.values,
      scopeVersion: userScope.version,
    })
    .from(appUser)
    .leftJoin(userRole, eq(userRole.userId, appUser.id))
    .leftJoin(userScope, eq(userScope.userId, appUser.id))
    .groupBy(appUser.id, userScope.id)
    .orderBy(asc(appUser.displayName));
  return rows;
}

export const findUserScopeRow = async (db: DbOrTx, userId: string) =>
  first(await db.select().from(userScope).where(eq(userScope.userId, userId)));

/**
 * Write a user's scope. `expectedVersion` null = the user has no row yet (insert; a concurrent insert
 * loses on the unique user_id and reports stale).
 */
export async function writeUserScope(
  db: DbOrTx,
  userId: string,
  expectedVersion: number | null,
  scope: { scopeType: string; values: string[] },
  actorId: string,
): Promise<'ok' | 'stale'> {
  if (expectedVersion === null) {
    const rows = await db
      .insert(userScope)
      .values({ userId, ...scope, createdBy: actorId })
      .onConflictDoNothing({ target: userScope.userId })
      .returning({ id: userScope.id });
    return rows.length ? 'ok' : 'stale';
  }
  const rows = await db
    .update(userScope)
    .set({ ...scope, version: sql`${userScope.version} + 1`, updatedAt: new Date() })
    .where(and(eq(userScope.userId, userId), eq(userScope.version, expectedVersion)))
    .returning({ id: userScope.id });
  return rows.length ? 'ok' : 'stale';
}

// ── Connector health ────────────────────────────────────────────────────────────────────────────

/** Per integration source: the latest run and the latest successful one. */
export async function integrationHealth(db: DbOrTx) {
  const latest = await db.execute<{
    source: string;
    status: string;
    started_at: Date;
    finished_at: Date | null;
    error: string | null;
    last_success_at: Date | null;
    failures_24h: number;
  }>(sql`
    select distinct on (r.source)
      r.source, r.status, r.started_at, r.finished_at, r.error,
      (select max(s.finished_at) from ${integrationRun} s
        where s.source = r.source and s.status = 'succeeded') as last_success_at,
      (select count(*)::int from ${integrationRun} f
        where f.source = r.source and f.status = 'failed'
          and f.started_at > now() - interval '24 hours') as failures_24h
    from ${integrationRun} r
    order by r.source, r.started_at desc`);
  return [...latest];
}
