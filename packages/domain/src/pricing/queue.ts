/**
 * The pricing queue (B-11, DEC-19/20): every open quote in Quoting, for the Pricing team. Pricing is a
 * required gate ("all pricing requests and decisions reviewed and approved through the Pricing team"),
 * so the queue only orders and filters what Pricing sees; it never prices anything.
 */

/** The stage the pricing queue lists (hybrid seed: Quoting). */
export const PRICING_QUEUE_STAGE_KEY = 'QUOTING';

/** The G2 outcomes the queue flags for Pricing. */
export const FLAGGED_G2_OUTCOMES = ['capital_required', 'proceed_with_risk'] as const;

/** What the queue orders and filters on (the API builds one per quote). */
export interface PricingQueueEntry {
  quoteNumber: string;
  /** Displayed tier key; null when not scored. */
  tier: string | null;
  score: number | null;
  /** Time in Quoting so far, excluding holds (ms). */
  activeMsInStage: number;
  /** The latest G2 outcome key (proceed, proceed_with_risk, capital_required…); null if none. */
  g2Outcome: string | null;
  /** not_required | pending | pre_approved | not_approved; null when not recorded yet. */
  capitalReadiness: string | null;
  /** The price approval is recorded for the current version. */
  priceApproved: boolean;
  productFamily: string | null;
  kamUserId: string;
  /** Lower-cased text the search box matches: quote number, customer, opportunity, KAM, engineer, refs. */
  searchText: string;
}

/**
 * Default order: tier (highest first, in the scoring model's tier order), then score (desc), then the
 * longest time in Quoting first, then quote number. An unknown or missing tier sorts after known ones.
 */
export function comparePricingQueue(tierOrder: readonly string[]) {
  const rank = (tier: string | null) => {
    const i = tier ? tierOrder.indexOf(tier) : -1;
    return i === -1 ? tierOrder.length : i;
  };
  return (a: PricingQueueEntry, b: PricingQueueEntry): number => {
    const ta = rank(a.tier);
    const tb = rank(b.tier);
    if (ta !== tb) return ta - tb;
    const sa = a.score ?? Number.NEGATIVE_INFINITY;
    const sb = b.score ?? Number.NEGATIVE_INFINITY;
    if (sa !== sb) return sb > sa ? 1 : -1;
    if (a.activeMsInStage !== b.activeMsInStage) return b.activeMsInStage - a.activeMsInStage;
    return a.quoteNumber.localeCompare(b.quoteNumber);
  };
}

export function sortPricingQueue<T extends PricingQueueEntry>(
  entries: readonly T[],
  tierOrder: readonly string[],
): T[] {
  return [...entries].sort(comparePricingQueue(tierOrder));
}

/** `none` in `capitalReadiness` matches quotes with no status recorded yet. */
export const NO_CAPITAL_READINESS = 'none';

export interface PricingQueueFilter {
  tiers?: readonly string[];
  g2Outcomes?: readonly string[];
  capitalReadiness?: readonly string[];
  /** true: approval recorded; false: not yet. */
  priceApproved?: boolean;
  productFamilies?: readonly string[];
  kamUserId?: string;
  /** Free text, matched case-insensitively against `searchText`. */
  q?: string;
}

export function filterPricingQueue<T extends PricingQueueEntry>(
  entries: readonly T[],
  filter: PricingQueueFilter,
): T[] {
  const q = filter.q?.trim().toLowerCase();
  return entries.filter((e) => {
    if (filter.tiers?.length && !(e.tier && filter.tiers.includes(e.tier))) return false;
    if (filter.g2Outcomes?.length && !(e.g2Outcome && filter.g2Outcomes.includes(e.g2Outcome)))
      return false;
    if (
      filter.capitalReadiness?.length &&
      !filter.capitalReadiness.includes(e.capitalReadiness ?? NO_CAPITAL_READINESS)
    )
      return false;
    if (filter.priceApproved !== undefined && e.priceApproved !== filter.priceApproved)
      return false;
    if (
      filter.productFamilies?.length &&
      !(e.productFamily && filter.productFamilies.includes(e.productFamily))
    )
      return false;
    if (filter.kamUserId && e.kamUserId !== filter.kamUserId) return false;
    if (q && !e.searchText.includes(q)) return false;
    return true;
  });
}
