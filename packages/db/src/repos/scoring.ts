import { toSnakeCase } from '@ccq/domain';
import type { ScoreResult, ScoringFacts } from '@ccq/domain';
import { eq } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { first } from './_util';
import { getQuoteById } from './quotes';
import { getEngReview } from './records';
import { customer, quote } from '../schema/index';

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
  const [eng, cust] = await Promise.all([
    getEngReview(db, quoteId),
    row.customerId
      ? db
          .select({ status: customer.status, name: customer.name })
          .from(customer)
          .where(eq(customer.id, row.customerId))
      : Promise.resolve([]),
  ]);
  return { quote: snake(row), customer: snake(first(cust)), eng_review: snake(eng) };
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
