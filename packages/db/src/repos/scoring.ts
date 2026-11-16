import { toSnakeCase } from '@ccq/domain';
import type { ScoreResult, ScoringFacts } from '@ccq/domain';
import { and, eq, inArray } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { first } from './_util';
import { getQuoteById } from './quotes';
import { customer, engReview, quote, quoteItem } from '../schema/index';

const snake = (row: object | undefined | null): Record<string, unknown> | null =>
  row
    ? Object.fromEntries(Object.entries(row).map(([key, value]) => [toSnakeCase(key), value]))
    : null;

/**
 * The facts the scoring engine reads for a quote, grouped by source: `quote` (its columns),
 * `customer` (status, name) and `eng_review` (process, preliminary capital, …). Pure data assembly.
 */
export async function loadScoringFacts(
  db: DbOrTx,
  quoteId: string,
): Promise<ScoringFacts | undefined> {
  const row = await getQuoteById(db, quoteId);
  if (!row) return undefined;
  const [engs, primary, cust] = await Promise.all([
    db.select().from(engReview).where(eq(engReview.quoteId, quoteId)),
    primaryItemIds(db, [quoteId]),
    row.customerId
      ? db
          .select({ status: customer.status, name: customer.name })
          .from(customer)
          .where(eq(customer.id, row.customerId))
      : Promise.resolve([]),
  ]);
  const eng = scoringReviewsByQuote(engs, primary).get(quoteId);
  return { quote: snake(row), customer: snake(first(cust)), eng_review: snake(eng) };
}

type EngReviewRow = typeof engReview.$inferSelect;

/** FB-19: the primary item's id for each quote (quote id → item id). */
export async function primaryItemIds(
  db: DbOrTx,
  quoteIds: readonly string[],
): Promise<Map<string, string>> {
  if (quoteIds.length === 0) return new Map();
  const rows = await db
    .select({ quoteId: quoteItem.quoteId, id: quoteItem.id })
    .from(quoteItem)
    .where(and(inArray(quoteItem.quoteId, [...quoteIds]), eq(quoteItem.itemNo, 1)));
  return new Map(rows.map((r) => [r.quoteId, r.id]));
}

/**
 * FB-19 (decision 6): what scoring reads as the quote's engineering review: the primary item's row, with
 * `prelim_capital_usd` the SUM of every item's preliminary capital (null when no item has a figure). A
 * quote whose items have no primary row yet but other rows still gets their capital.
 */
export function scoringReviewsByQuote(
  reviews: readonly EngReviewRow[],
  primary: ReadonlyMap<string, string>,
): Map<string, EngReviewRow> {
  const byQuote = new Map<string, EngReviewRow[]>();
  for (const r of reviews) byQuote.set(r.quoteId, [...(byQuote.get(r.quoteId) ?? []), r]);
  const out = new Map<string, EngReviewRow>();
  for (const [quoteId, rows] of byQuote) {
    const base = rows.find((r) => r.quoteItemId === primary.get(quoteId)) ?? rows[0]!;
    const figures = rows
      .map((r) => r.prelimCapitalUsd)
      .filter((v): v is number => typeof v === 'number');
    out.set(quoteId, {
      ...base,
      prelimCapitalUsd: figures.length > 0 ? figures.reduce((a, b) => a + b, 0) : null,
    });
  }
  return out;
}

/** The stored explanation (`quote.priority_breakdown`). */
export interface StoredPriority {
  breakdown: ScoreResult['breakdown'];
  unknowns: string[];
  computedTier: string;
  computedTierLabel: string;
}

/**
 * Stores a computed score on the quote. The tier column follows the score unless an approved override
 * owns it (`priority_tier_overridden`, B-09): then the computed tier is kept only in the breakdown.
 */
export async function setQuotePriority(
  db: DbOrTx,
  quoteId: string,
  result: ScoreResult,
  at: Date,
  { tierOverridden }: { tierOverridden: boolean },
) {
  const stored: StoredPriority = {
    breakdown: result.breakdown,
    unknowns: result.unknowns,
    computedTier: result.tier,
    computedTierLabel: result.tierLabel,
  };
  await db
    .update(quote)
    .set({
      priorityScore: result.total,
      scoringModelVersion: result.modelVersion,
      priorityBreakdown: stored,
      priorityScoredAt: at,
      ...(tierOverridden ? {} : { priorityTier: result.tier }),
    })
    .where(eq(quote.id, quoteId));
}
