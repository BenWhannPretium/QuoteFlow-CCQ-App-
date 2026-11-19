import type { ReviewSummary } from '@ccq/contracts';
import { REQUIREMENT_LABELS, termsExceptionOpen, uniqueRequirements } from '@ccq/domain';

/**
 * Where an item that blocks the release is fixed:
 * - `commercial`: the quote's Commercial terms tab (Sales, Pricing and the pricing lead record it there);
 * - `tooling-commitment`: the customer tooling commitment on that tab (FB-25);
 * - `terms-legal`: the Terms and Legal section of the review screen (the approver's own confirmation);
 * - `capital-term`: one capital term in that section (FB-25: `field` names it);
 * - `quote`: somewhere else on the full quote;
 * - `none`: nothing to fill in (another approver has to decide).
 */
export type FixAt =
  'commercial' | 'tooling-commitment' | 'terms-legal' | 'capital-term' | 'quote' | 'none';

export interface ReleaseBlocker {
  /** The rule's field key (`missing[].field`), or `approver_tier`. */
  key: string;
  /** What is open, in the server's plain words (`REQUIREMENT_LABELS`). */
  message: string;
  fixAt: FixAt;
  /** FB-25: for `capital-term`, the capital term (`capital_terms_required` key) to go to. */
  field?: string;
}

/**
 * The decision field each Final Review check reports when it is open (`hybrid.ts` OFFER_READY), and
 * where that check is done.
 */
const CHECK_FIELDS: Readonly<Record<string, FixAt>> = {
  terms_checked_at: 'commercial',
  legal_reviewed_on: 'commercial',
  terms_exception_open: 'commercial',
  terms_finalized_at: 'terms-legal',
  // FB-25 (N17-26): answered on the Commercial terms tab (or by the KAM at intake).
  terms_tooling_commitment: 'tooling-commitment',
};

/** A rule key is its fields joined by commas (`requirementKey`); the first check field it names decides. */
function fixAtFor(key: string): FixAt {
  for (const field of key.split(',')) {
    const at = CHECK_FIELDS[field];
    if (at) return at;
  }
  return 'quote';
}

const blocker = (key: string, fallback: string): ReleaseBlocker => ({
  key,
  message: REQUIREMENT_LABELS[key] ?? fallback,
  fixAt: fixAtFor(key),
});

type Terms = ReviewSummary['termsAndLegal'];

/**
 * The checks `g4_required_checks` names (`termsAndLegal.requiredChecks`), each with the key its rule
 * reports and whether the review says it is still open. The same facts the Terms and Legal section
 * shows as "(required)".
 */
const REQUIRED_CHECKS: readonly {
  check: string;
  key: string;
  /** Shown only if the rule's key ever loses its plain words in `REQUIREMENT_LABELS`. */
  fallback: string;
  open: (t: Terms) => boolean;
}[] = [
  {
    check: 'terms_checked',
    key: 'g4_terms_check_required,terms_checked_at',
    fallback: 'The terms check by Sales or Pricing',
    open: (t) => !t.checkedAt,
  },
  {
    check: 'legal_review',
    key: 'legal_review_required,g4_legal_review_check_required,legal_reviewed_on',
    fallback: 'The Legal review',
    open: (t) => t.legal.required && !t.legal.reviewedOn,
  },
  {
    check: 'terms_exception',
    key: 'g4_terms_exception_check_required,terms_exception_open',
    fallback: 'The pricing lead’s approval of the payment-terms exception',
    open: (t) => termsExceptionOpen(t.exception?.status),
  },
  {
    check: 'terms_finalized',
    key: 'g4_terms_finalized_check_required,terms_finalized_at',
    fallback: 'The approver’s confirmation of the capital terms',
    open: (t) => !t.capital.finalizedAt,
  },
  {
    check: 'tooling_commitment_answered',
    key: 'g4_tooling_commitment_check_required,terms_tooling_commitment',
    fallback: 'The customer tooling commitment answered',
    open: (t) => t.termsToolingCommitment === null,
  },
];

/**
 * FB-25 (N17-26, N17-27): the capital terms `capital_terms_required` names, in the words of the review
 * screen. Mold ownership and the tooling funding model are needed here, at Final Review, not earlier.
 */
export const CAPITAL_TERM_NAMES: Readonly<Record<string, string>> = {
  funding_model: 'Tooling funding model',
  mold_ownership: 'Mold ownership',
  amortization: 'Amortized (yes or no)',
  min_supply: 'Minimum supply / shortfall terms',
  agreement: 'Agreement in place (yes or no)',
};

/**
 * FB-25: the required capital terms still unanswered (the approver cannot confirm the capital terms
 * until they are). `fundingNotAnswered`: funding codes that are not an answer ("Not discussed").
 */
export function capitalTermsUnanswered(
  t: Pick<Terms, 'capital'>,
  fundingNotAnswered: readonly string[] = [],
): string[] {
  const c = t.capital;
  const value: Record<string, unknown> = {
    funding_model:
      c.toolingFundingModel && !fundingNotAnswered.includes(c.toolingFundingModel)
        ? c.toolingFundingModel
        : null,
    mold_ownership: c.moldOwnership,
    amortization:
      c.amortized === null ? null : c.amortized && c.amortizationMonths === null ? null : true,
    min_supply: c.minSupply,
    agreement:
      c.agreementInPlace === null
        ? null
        : c.agreementInPlace && c.agreementMonths === null
          ? null
          : true,
  };
  return c.required.filter(
    (term) => value[term] === null || value[term] === '' || value[term] === undefined,
  );
}

/**
 * UX-010: what stops the offer being released right now, from what the review summary already says.
 * Nothing is guessed from the stage:
 *
 * - The viewer is offered the outcome that releases the proposal: its `missing` list is the answer (it
 *   is what the decision dialog lists under "Missing before it can move on").
 * - The viewer is not offered it (a reader, or an approver below the quote's tier): the required checks
 *   that are still open, and the tier when that is why.
 *
 * Empty when nothing blocks, and for a quote that is no longer waiting in Final Review.
 */
export function releaseBlockers(
  s: Pick<ReviewSummary, 'inFinalReview' | 'availableActions' | 'requirement' | 'termsAndLegal'>,
  fundingNotAnswered: readonly string[] = [],
): ReleaseBlocker[] {
  if (!s.inFinalReview) return [];
  const release = s.availableActions.find((a) => a.releasesProposal);
  if (release) {
    return withCapitalTerms(
      uniqueRequirements(release.missing).map((m) => blocker(m.field, m.message)),
      s.termsAndLegal,
      fundingNotAnswered,
    );
  }
  const out: ReleaseBlocker[] = [];
  if (s.requirement && !s.requirement.satisfied) {
    out.push({
      key: 'approver_tier',
      message: `An approver in the “${s.requirement.tierLabel}” tier has to approve this quote`,
      fixAt: 'none',
    });
  }
  const t = s.termsAndLegal;
  for (const c of REQUIRED_CHECKS) {
    if (t.requiredChecks.includes(c.check) && c.open(t)) {
      out.push(blocker(c.key, c.fallback));
    }
  }
  return withCapitalTerms(out, t, fundingNotAnswered);
}

/**
 * FB-25 (N17-26, N17-27): when the capital-terms confirmation blocks, each required capital term still
 * unanswered is listed after it, with a way to that field.
 */
function withCapitalTerms(
  list: ReleaseBlocker[],
  t: Terms,
  fundingNotAnswered: readonly string[],
): ReleaseBlocker[] {
  const at = list.findIndex((b) => b.fixAt === 'terms-legal');
  if (at < 0 || t.capital.finalizedAt) return list;
  const terms = capitalTermsUnanswered(t, fundingNotAnswered).map((term): ReleaseBlocker => ({
    key: `capital_term:${term}`,
    message: `${CAPITAL_TERM_NAMES[term] ?? term} (needed to confirm the capital terms)`,
    fixAt: 'capital-term',
    field: term,
  }));
  return [...list.slice(0, at + 1), ...terms, ...list.slice(at + 1)];
}
