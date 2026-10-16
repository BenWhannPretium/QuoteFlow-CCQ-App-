import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { DbOrTx } from '../client';
import {
  appUser,
  customer,
  engReview,
  pricingRecord,
  quote,
  sfOpportunitySnapshot,
  stageHistory,
} from '../schema/index';

/**
 * B-14 pipeline reads (F-07): the quote list, prioritization view, board and CSV export share one
 * filtered, ordered query. It runs in two phases so the policy layer can re-check scope row by row
 * without breaking paging:
 *
 * 1. `listPipelineKeys`: every matching quote (RLS applies), ordered, with only what the service
 *    needs to re-check scope (domain policy) and to apply the domain-computed filters (qualification
 *    warnings, SF mismatch). Cheap: no wide columns.
 * 2. `listPipelineRows`: the wide rows (summary joins + list extras) for the page's ids.
 */

/** Filters the SQL can apply. The service resolves `me`, value lists and the priority restriction. */
export interface PipelineSqlFilter {
  q?: string | undefined;
  stageKeys?: string[] | undefined;
  tiers?: string[] | undefined;
  kamUserIds?: string[] | undefined;
  engineerIds?: string[] | undefined;
  includeUnassigned?: boolean | undefined;
  productFamilies?: string[] | undefined;
  markets?: string[] | undefined;
  resins?: string[] | undefined;
  status?: 'open' | 'active' | 'on_hold' | 'closed' | undefined;
  /** In the current stage since before this instant. */
  enteredStageBefore?: Date | undefined;
  closeDateFrom?: string | undefined;
  closeDateTo?: string | undefined;
}

export type PipelineSortKey = 'score' | 'tier' | 'age' | 'closeDate' | 'amount' | 'updated';

export interface PipelineQueryOptions {
  filter: PipelineSqlFilter;
  sort: PipelineSortKey;
  dir: 'asc' | 'desc';
  /**
   * When set, priority (score / tier) counts only on this KAM's own quotes: peers' priority is
   * withheld (`kam_can_see_peer_scores` = false) so it must not filter or order the list either.
   */
  priorityOwnerOnly?: string | undefined;
  /** Tier keys, highest first (the scoring model's order), for `sort=tier`. */
  tierOrder: readonly string[];
}

/** When the quote entered its current stage: the open stage_history stay (falls back to updated_at). */
export const stageEnteredAtSql = sql<Date>`coalesce((
  select max(${stageHistory.enteredAt}) from ${stageHistory}
  where ${stageHistory.quoteId} = ${quote.id} and ${stageHistory.exitedAt} is null
), ${quote.updatedAt})`;

/** `%text%` for ILIKE with the user's `%`, `_` and `\` taken literally. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function visiblePriority(column: SQL | typeof quote.priorityScore, ownerOnly?: string): SQL {
  return ownerOnly
    ? sql`(case when ${quote.kamUserId} = ${ownerOnly} then ${column} end)`
    : sql`${column}`;
}

function whereFor(opts: PipelineQueryOptions): SQL | undefined {
  const f = opts.filter;
  const where: SQL[] = [];
  const q = f.q?.trim();
  if (q) {
    const p = likePattern(q);
    where.push(
      or(
        sql`${quote.quoteNumber} ilike ${p}`,
        sql`${sfOpportunitySnapshot.name} ilike ${p}`,
        sql`${sfOpportunitySnapshot.accountName} ilike ${p}`,
        sql`${customer.name} ilike ${p}`,
        sql`${quote.description} ilike ${p}`,
      )!,
    );
  }
  if (f.stageKeys?.length) where.push(inArray(quote.stageKey, f.stageKeys));
  if (f.tiers?.length) {
    where.push(
      sql`${visiblePriority(sql`${quote.priorityTier}`, opts.priorityOwnerOnly)} in (${sql.join(
        f.tiers.map((t) => sql`${t}`),
        sql`, `,
      )})`,
    );
  }
  if (f.kamUserIds?.length) where.push(inArray(quote.kamUserId, f.kamUserIds));
  if (f.engineerIds?.length || f.includeUnassigned) {
    const parts: SQL[] = [];
    if (f.engineerIds?.length) parts.push(inArray(quote.assignedEngineerId, f.engineerIds));
    if (f.includeUnassigned) parts.push(isNull(quote.assignedEngineerId));
    where.push(or(...parts)!);
  }
  if (f.productFamilies?.length) where.push(inArray(quote.productFamily, f.productFamilies));
  if (f.markets?.length) where.push(inArray(quote.market, f.markets));
  if (f.resins?.length) where.push(inArray(quote.resin, f.resins));
  if (f.status === 'open') where.push(ne(quote.status, 'closed'));
  else if (f.status) where.push(eq(quote.status, f.status));
  if (f.enteredStageBefore) {
    where.push(sql`${stageEnteredAtSql} < ${f.enteredStageBefore.toISOString()}::timestamptz`);
  }
  if (f.closeDateFrom) where.push(gte(quote.expectedCloseDate, f.closeDateFrom));
  if (f.closeDateTo) where.push(lte(quote.expectedCloseDate, f.closeDateTo));
  return where.length ? and(...where) : undefined;
}

function orderFor(opts: PipelineQueryOptions): SQL[] {
  const dir = opts.dir === 'asc' ? sql`asc` : sql`desc`;
  const owner = opts.priorityOwnerOnly;
  const score = visiblePriority(sql`${quote.priorityScore}`, owner);
  let primary: SQL[];
  switch (opts.sort) {
    case 'score':
      primary = [sql`${score} ${dir} nulls last`];
      break;
    case 'tier': {
      // Rank 1 = highest tier. "desc" (the default) means highest first.
      const order = opts.tierOrder.length ? opts.tierOrder : [''];
      const rank = sql`array_position(array[${sql.join(
        order.map((t) => sql`${t}`),
        sql`, `,
      )}]::text[], ${visiblePriority(sql`${quote.priorityTier}`, owner)})`;
      primary = [
        sql`${rank} ${opts.dir === 'asc' ? sql`desc` : sql`asc`} nulls last`,
        sql`${score} desc nulls last`,
      ];
      break;
    }
    case 'age':
      // "desc" = oldest in stage first.
      primary = [sql`${stageEnteredAtSql} ${opts.dir === 'asc' ? sql`desc` : sql`asc`}`];
      break;
    case 'closeDate':
      primary = [sql`${quote.expectedCloseDate} ${dir} nulls last`];
      break;
    case 'amount':
      primary = [sql`${sfOpportunitySnapshot.amount} ${dir} nulls last`];
      break;
    case 'updated':
      primary = [sql`${quote.updatedAt} ${dir}`];
      break;
  }
  return [...primary, asc(quote.quoteNumber)];
}

/**
 * Phase 1: every matching quote id, in order, with the facts for the policy re-check and the
 * domain-computed filters. RLS applies.
 */
export function listPipelineKeys(db: DbOrTx, opts: PipelineQueryOptions) {
  return db
    .select({
      id: quote.id,
      stageKey: quote.stageKey,
      status: quote.status,
      kamUserId: quote.kamUserId,
      assignedEngineerId: quote.assignedEngineerId,
      region: quote.region,
      accountId: customer.sfAccountId,
      estAnnualRevenue: quote.estAnnualRevenue,
      estAnnualVolume: quote.estAnnualVolume,
      processType: engReview.processType,
      sfStage: sfOpportunitySnapshot.sfStage,
      /** The board's column totals add these up without loading the wide rows. */
      amount: sfOpportunitySnapshot.amount,
    })
    .from(quote)
    .leftJoin(
      sfOpportunitySnapshot,
      eq(sfOpportunitySnapshot.sfOpportunityId, quote.sfOpportunityId),
    )
    .leftJoin(customer, eq(customer.id, quote.customerId))
    .leftJoin(engReview, eq(engReview.quoteId, quote.id))
    .where(whereFor(opts))
    .orderBy(...orderFor(opts));
}
export type PipelineKey = Awaited<ReturnType<typeof listPipelineKeys>>[number];

const engineer = alias(appUser, 'engineer');

/**
 * Phase 2: the wide rows for the given ids (any order; the caller restores phase 1's). The shape is a
 * `QuoteSummaryRow` plus the list's extras. Commercial columns are selected here and stripped by the
 * service for roles without `quote.read.commercialFields`.
 */
export function listPipelineRows(db: DbOrTx, ids: readonly string[]) {
  if (ids.length === 0) return Promise.resolve([]);
  return db
    .select({
      quote,
      opportunityName: sfOpportunitySnapshot.name,
      accountName: sfOpportunitySnapshot.accountName,
      amount: sfOpportunitySnapshot.amount,
      sfStage: sfOpportunitySnapshot.sfStage,
      customerName: customer.name,
      customerStatus: customer.status,
      kamName: appUser.displayName,
      engineerName: engineer.displayName,
      processType: engReview.processType,
      prelimCapitalUsd: engReview.prelimCapitalUsd,
      capitalReadiness: pricingRecord.capitalReadiness,
      stageEnteredAt: stageEnteredAtSql,
    })
    .from(quote)
    .leftJoin(
      sfOpportunitySnapshot,
      eq(sfOpportunitySnapshot.sfOpportunityId, quote.sfOpportunityId),
    )
    .leftJoin(customer, eq(customer.id, quote.customerId))
    .leftJoin(appUser, eq(appUser.id, quote.kamUserId))
    .leftJoin(engineer, eq(engineer.id, quote.assignedEngineerId))
    .leftJoin(engReview, eq(engReview.quoteId, quote.id))
    .leftJoin(
      pricingRecord,
      and(eq(pricingRecord.quoteId, quote.id), eq(pricingRecord.quoteVersion, quote.version)),
    )
    .where(inArray(quote.id, [...ids]));
}
export type PipelineRow = Awaited<ReturnType<typeof listPipelineRows>>[number];

/** KAMs and engineers that appear on quotes in scope (filter options). RLS applies. */
export async function listPipelinePeople(db: DbOrTx) {
  const [kams, engineers] = await Promise.all([
    db
      .selectDistinct({ id: appUser.id, displayName: appUser.displayName })
      .from(quote)
      .innerJoin(appUser, eq(appUser.id, quote.kamUserId))
      .orderBy(asc(appUser.displayName)),
    db
      .selectDistinct({ id: appUser.id, displayName: appUser.displayName })
      .from(quote)
      .innerJoin(appUser, eq(appUser.id, quote.assignedEngineerId))
      .orderBy(asc(appUser.displayName)),
  ]);
  return { kams, engineers };
}
