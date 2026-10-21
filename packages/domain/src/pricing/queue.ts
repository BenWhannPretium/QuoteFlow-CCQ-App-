import { UNASSIGNED } from '../engineering/queue';
import { DomainError } from '../errors';
import { can, type PolicyResource } from '../policy/can';
import type { Actor } from '../types/actor';
import type { Role } from '../types/roles';

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
  /** B-26: the pricer the pricing lead assigned it to; null = unassigned. */
  assignedPricerId: string | null;
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
  /** B-26: one pricer's work; `unassigned` = nobody yet. */
  pricerId?: string;
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
    if (filter.pricerId) {
      const want = filter.pricerId === UNASSIGNED ? null : filter.pricerId;
      if (e.assignedPricerId !== want) return false;
    }
    if (q && !e.searchText.includes(q)) return false;
    return true;
  });
}

// ── B-26: Quoting assignment (the pricing lead triages the pricing queue) ───────────────────────────

/** Roles Quoting work can be assigned to (the picker offers users holding one of them). */
export const PRICING_ASSIGNABLE_ROLES: readonly Role[] = ['Pricing', 'PricingLead'];

export interface PricerAssignee {
  id: string;
  roles: readonly Role[];
  active: boolean;
}

export type PricerAssignmentPlan =
  | { ok: true; changed: boolean; from: string | null; to: string }
  | { ok: false; errors: DomainError[] };

/**
 * Assign or reassign the pricer on a quote in Quoting (on hold is fine). Needs `pricingQueue.assign`
 * (PricingLead, Admin); the assignee must be an active user holding Pricing or PricingLead. The same
 * pricer again is a no-op (`changed: false`), so a bulk reassign can include them.
 */
export function planPricerAssignment(
  actor: Actor,
  quote: PolicyResource & { stageKey: string; status: string; assignedPricerId: string | null },
  assignee: PricerAssignee | undefined,
): PricerAssignmentPlan {
  if (!can(actor, 'pricingQueue.assign', quote)) {
    return {
      ok: false,
      errors: [new DomainError('NOT_PERMITTED', 'Requires pricingQueue.assign')],
    };
  }
  const errors: DomainError[] = [];
  if (quote.status === 'closed')
    errors.push(new DomainError('QUOTE_CLOSED', 'The quote is closed'));
  else if (quote.stageKey !== PRICING_QUEUE_STAGE_KEY) {
    errors.push(
      new DomainError('WRONG_STAGE', `The quote is in ${quote.stageKey}, not in Quoting`),
    );
  }
  if (
    !assignee ||
    !assignee.active ||
    !assignee.roles.some((r) => PRICING_ASSIGNABLE_ROLES.includes(r))
  ) {
    errors.push(
      new DomainError(
        'INVALID_ASSIGNEE',
        'Assign an active user with the Pricing or PricingLead role',
        'pricerId',
      ),
    );
  }
  if (errors.length > 0) return { ok: false, errors };
  const from = quote.assignedPricerId;
  return { ok: true, changed: from !== assignee!.id, from, to: assignee!.id };
}
