/**
 * The Final Review queue (B-12): every open quote waiting for the G4 decision, for Approvers (decide)
 * and Leadership (read). It only orders and filters what the approver sees; it decides nothing.
 */

import { matchesG2Filter } from '../pricing/queue';

/**
 * The G2 outcomes the queue flags as risk for the approver. FB-17 (W13-22): `capital_required` is
 * switched off and stays here for the quotes decided with it; a quote that needs capital is flagged by
 * `capitalNeeded` (`flaggedForCapitalOrRisk` in the pricing queue module), whatever its G2 outcome.
 */
export const FINAL_REVIEW_FLAGGED_G2 = ['capital_required', 'proceed_with_risk'] as const;

/** What the queue orders and filters on (the API builds one per quote). */
export interface FinalReviewEntry {
  quoteNumber: string;
  /** Displayed tier key; null when not scored. */
  tier: string | null;
  score: number | null;
  /** Time waiting in Final Review so far (ms). */
  waitingMs: number;
  g2Outcome: string | null;
  /** FB-17 (W13-22): the quote needs capital (`capitalNeed`). */
  capitalNeeded: boolean;
  /** not_required | pending | pre_approved | not_approved; null when not recorded. */
  capitalReadiness: string | null;
  kamUserId: string;
  /** Lower-cased text the search box matches: quote number, customer, opportunity, KAM, approvers, refs. */
  searchText: string;
}

/** Tier (highest first, in the scoring model's order) → score (desc) → longest waiting → quote number. */
export function compareFinalReviewQueue(tierOrder: readonly string[]) {
  const rank = (tier: string | null) => {
    const i = tier ? tierOrder.indexOf(tier) : -1;
    return i === -1 ? tierOrder.length : i;
  };
  return (a: FinalReviewEntry, b: FinalReviewEntry): number => {
    const ta = rank(a.tier);
    const tb = rank(b.tier);
    if (ta !== tb) return ta - tb;
    const sa = a.score ?? Number.NEGATIVE_INFINITY;
    const sb = b.score ?? Number.NEGATIVE_INFINITY;
    if (sa !== sb) return sb > sa ? 1 : -1;
    if (a.waitingMs !== b.waitingMs) return b.waitingMs - a.waitingMs;
    return a.quoteNumber.localeCompare(b.quoteNumber);
  };
}

export function sortFinalReviewQueue<T extends FinalReviewEntry>(
  entries: readonly T[],
  tierOrder: readonly string[],
): T[] {
  return [...entries].sort(compareFinalReviewQueue(tierOrder));
}

/** `none` in `capitalReadiness` matches quotes with no status recorded. */
export const FINAL_REVIEW_NO_CAPITAL = 'none';

export interface FinalReviewFilter {
  tiers?: readonly string[];
  /** Latest G2 outcome keys; `capital_needed` (FB-17) matches every quote that needs capital. */
  g2Outcomes?: readonly string[];
  capitalReadiness?: readonly string[];
  kamUserId?: string;
  q?: string;
}

export function filterFinalReviewQueue<T extends FinalReviewEntry>(
  entries: readonly T[],
  filter: FinalReviewFilter,
): T[] {
  const q = filter.q?.trim().toLowerCase();
  return entries.filter((e) => {
    if (filter.tiers?.length && !(e.tier && filter.tiers.includes(e.tier))) return false;
    if (filter.g2Outcomes?.length && !matchesG2Filter(e, filter.g2Outcomes)) return false;
    if (
      filter.capitalReadiness?.length &&
      !filter.capitalReadiness.includes(e.capitalReadiness ?? FINAL_REVIEW_NO_CAPITAL)
    )
      return false;
    if (filter.kamUserId && e.kamUserId !== filter.kamUserId) return false;
    if (q && !e.searchText.includes(q)) return false;
    return true;
  });
}
