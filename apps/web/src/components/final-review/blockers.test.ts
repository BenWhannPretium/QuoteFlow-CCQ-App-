import type { AvailableGateAction, ReviewSummary } from '@ccq/contracts';
import { describe, expect, it } from 'vitest';

import { capitalTermsUnanswered, releaseBlockers } from './blockers';

type Input = Parameters<typeof releaseBlockers>[0];
type Terms = ReviewSummary['termsAndLegal'];

/** Only what `releaseBlockers` reads; everything is done and nothing is required unless a test says so. */
const terms = (over: {
  requiredChecks?: string[];
  checkedAt?: string | null;
  legalRequired?: boolean;
  legalReviewedOn?: string | null;
  exceptionStatus?: 'pending' | 'approved' | 'rejected' | null;
  finalizedAt?: string | null;
  /** FB-25: the customer tooling commitment (answered unless a test says otherwise). */
  toolingCommitment?: boolean | null;
  /** FB-25: the capital terms; every one answered and none required unless a test says otherwise. */
  capital?: Partial<Terms['capital']>;
}): Terms =>
  ({
    requiredChecks: over.requiredChecks ?? [],
    checkedAt: over.checkedAt ?? null,
    legal: { required: over.legalRequired ?? false, reviewedOn: over.legalReviewedOn ?? null },
    exception: over.exceptionStatus ? { status: over.exceptionStatus } : null,
    termsToolingCommitment: over.toolingCommitment === undefined ? true : over.toolingCommitment,
    capital: {
      finalizedAt: over.finalizedAt ?? null,
      required: [],
      toolingFundingModel: 'COMPANY_FUNDED',
      moldOwnership: 'PRETIUM',
      amortized: false,
      amortizationMonths: null,
      minSupply: 'None',
      agreementInPlace: false,
      agreementMonths: null,
      ...over.capital,
    },
  }) as Terms;

const action = (
  outcomeKey: string,
  over: Partial<Pick<AvailableGateAction, 'releasesProposal' | 'missing'>> = {},
): AvailableGateAction =>
  ({
    gateKey: 'G4',
    outcomeKey,
    releasesProposal: false,
    missing: [],
    ...over,
  }) as AvailableGateAction;

const review = (over: Partial<Input> = {}): Input => ({
  inFinalReview: true,
  availableActions: [],
  requirement: null,
  termsAndLegal: terms({}),
  ...over,
});

const FINALIZED_KEY = 'g4_terms_finalized_check_required,terms_finalized_at';
const EXCEPTION_KEY = 'g4_terms_exception_check_required,terms_exception_open';

describe('releaseBlockers (UX-010)', () => {
  it('nothing blocks when the release outcome is offered with nothing missing', () => {
    expect(
      releaseBlockers(
        review({
          availableActions: [
            action('approve', { releasesProposal: true }),
            action('hold'),
            action('decline'),
          ],
          // An open check that is not required is a warning only.
          termsAndLegal: terms({ requiredChecks: [], checkedAt: null }),
        }),
      ),
    ).toEqual([]);
  });

  it('the release outcome’s missing list is what blocks, in the server’s words, with where to fix it', () => {
    const blockers = releaseBlockers(
      review({
        availableActions: [
          action('approve', {
            releasesProposal: true,
            missing: [
              { field: FINALIZED_KEY, message: 'server text for the capital terms' },
              { field: EXCEPTION_KEY, message: 'server text for the exception' },
              { field: 'g4_terms_check_required,terms_checked_at', message: 'terms check' },
              {
                field: 'legal_review_required,g4_legal_review_check_required,legal_reviewed_on',
                message: 'legal',
              },
            ],
          }),
          action('hold'),
        ],
      }),
    );
    expect(blockers.map((b) => [b.key.split(',').at(-1), b.fixAt])).toEqual([
      ['terms_finalized_at', 'terms-legal'],
      ['terms_exception_open', 'commercial'],
      ['terms_checked_at', 'commercial'],
      ['legal_reviewed_on', 'commercial'],
    ]);
    expect(blockers[0]!.message).toBe("The approver's confirmation of the capital terms");
    expect(blockers[2]!.message).toBe(
      'The terms check by Sales or Pricing (tooling commitment, MOQ, payment terms)',
    );
  });

  it('a missing item that is not one of the Final Review checks points at the full quote, with the server’s message', () => {
    expect(
      releaseBlockers(
        review({
          availableActions: [
            action('approve', {
              releasesProposal: true,
              missing: [{ field: 'some_new_rule', message: 'A rule an Admin added' }],
            }),
          ],
        }),
      ),
    ).toEqual([{ key: 'some_new_rule', message: 'A rule an Admin added', fixAt: 'quote' }]);
  });

  it('lists a requirement once when two rules share its plain words', () => {
    expect(
      releaseBlockers(
        review({
          availableActions: [
            action('approve', {
              releasesProposal: true,
              missing: [
                { field: 'legal_review_required,legal_reviewed_on', message: 'x' },
                {
                  field: 'legal_review_required,g4_legal_review_check_required,legal_reviewed_on',
                  message: 'x',
                },
              ],
            }),
          ],
        }),
      ),
    ).toHaveLength(1);
  });

  it('only the outcome that releases the proposal counts: a hold’s missing fields do not block the release', () => {
    expect(
      releaseBlockers(
        review({
          availableActions: [
            action('approve', { releasesProposal: true }),
            action('hold', { missing: [{ field: 'review_date', message: 'A review date' }] }),
          ],
        }),
      ),
    ).toEqual([]);
  });

  describe('a viewer who is not offered the release (a reader, or an approver below the tier)', () => {
    it('a required check that is still open blocks; one that is done, or not required, does not', () => {
      const open = terms({
        requiredChecks: ['terms_exception', 'terms_finalized'],
        exceptionStatus: 'pending',
        finalizedAt: null,
        // Open but not required: warnings only.
        checkedAt: null,
        legalRequired: true,
        legalReviewedOn: null,
      });
      expect(releaseBlockers(review({ termsAndLegal: open })).map((b) => [b.key, b.fixAt])).toEqual(
        [
          [EXCEPTION_KEY, 'commercial'],
          [FINALIZED_KEY, 'terms-legal'],
        ],
      );
      const done = terms({
        requiredChecks: ['terms_checked', 'legal_review', 'terms_exception', 'terms_finalized'],
        checkedAt: '2026-11-01T10:00:00.000Z',
        legalRequired: true,
        legalReviewedOn: '2026-11-02',
        exceptionStatus: 'approved',
        finalizedAt: '2026-11-03T10:00:00.000Z',
      });
      expect(releaseBlockers(review({ termsAndLegal: done }))).toEqual([]);
    });

    it('every required check, each with its own state', () => {
      const all = ['terms_checked', 'legal_review', 'terms_exception', 'terms_finalized'];
      const keys = (t: Terms) =>
        releaseBlockers(review({ termsAndLegal: t })).map((b) => b.key.split(',').at(-1));
      expect(
        keys(terms({ requiredChecks: all, legalRequired: true, exceptionStatus: 'rejected' })),
      ).toEqual([
        'terms_checked_at',
        'legal_reviewed_on',
        'terms_exception_open',
        'terms_finalized_at',
      ]);
      // No Legal trigger and no exception request: neither is open.
      expect(keys(terms({ requiredChecks: all }))).toEqual([
        'terms_checked_at',
        'terms_finalized_at',
      ]);
    });

    it('the approver tier blocks an approver who does not meet it, and names the tier', () => {
      const blockers = releaseBlockers(
        review({
          // The server leaves the release out for this approver; the other outcomes stay.
          availableActions: [action('hold'), action('return'), action('decline')],
          requirement: { tierKey: 't2', tierLabel: 'Tier 2', satisfied: false },
        }),
      );
      expect(blockers).toEqual([
        {
          key: 'approver_tier',
          message: 'An approver in the “Tier 2” tier has to approve this quote',
          fixAt: 'none',
        },
      ]);
      expect(
        releaseBlockers(
          review({
            availableActions: [action('approve', { releasesProposal: true })],
            requirement: { tierKey: 't2', tierLabel: 'Tier 2', satisfied: true },
          }),
        ),
      ).toEqual([]);
    });
  });

  describe('FB-25 (N17-26, N17-27): the tooling commitment and each required capital term', () => {
    const TOOLING_KEY = 'g4_tooling_commitment_check_required,terms_tooling_commitment';

    it('the tooling commitment from the missing list goes to the Commercial terms tab', () => {
      const blockers = releaseBlockers(
        review({
          availableActions: [
            action('approve', {
              releasesProposal: true,
              missing: [{ field: TOOLING_KEY, message: 'x' }],
            }),
          ],
        }),
      );
      expect(blockers.map((b) => [b.key, b.fixAt])).toEqual([[TOOLING_KEY, 'tooling-commitment']]);
      expect(blockers[0]!.message).toMatch(/customer tooling commitment/);
    });

    it('a reader sees it as a required check while unanswered', () => {
      const t = terms({ requiredChecks: ['tooling_commitment_answered'], toolingCommitment: null });
      expect(releaseBlockers(review({ termsAndLegal: t })).map((b) => b.key)).toEqual([
        TOOLING_KEY,
      ]);
      const answered = terms({
        requiredChecks: ['tooling_commitment_answered'],
        toolingCommitment: false,
      });
      expect(releaseBlockers(review({ termsAndLegal: answered }))).toEqual([]);
    });

    it('lists each unanswered required capital term after the confirmation, with its field', () => {
      const t = terms({
        requiredChecks: ['terms_finalized'],
        capital: {
          required: ['funding_model', 'mold_ownership', 'amortization', 'min_supply', 'agreement'],
          toolingFundingModel: 'NOT_DISCUSSED',
          moldOwnership: null,
          amortized: true,
          amortizationMonths: null,
        },
      });
      const blockers = releaseBlockers(review({ termsAndLegal: t }), ['NOT_DISCUSSED']);
      expect(blockers.map((b) => [b.key, b.fixAt, b.field])).toEqual([
        [FINALIZED_KEY, 'terms-legal', undefined],
        ['capital_term:funding_model', 'capital-term', 'funding_model'],
        ['capital_term:mold_ownership', 'capital-term', 'mold_ownership'],
        ['capital_term:amortization', 'capital-term', 'amortization'],
      ]);
      expect(blockers[2]!.message).toBe('Mold ownership (needed to confirm the capital terms)');
      // A term not in capital_terms_required is never listed.
      expect(
        capitalTermsUnanswered({ capital: { ...t.capital, required: ['min_supply'] } }),
      ).toEqual([]);
      // Once confirmed, nothing more is listed.
      expect(
        releaseBlockers(
          review({
            termsAndLegal: { ...t, capital: { ...t.capital, finalizedAt: '2026-11-03T10:00:00Z' } },
          }),
        ),
      ).toEqual([]);
    });
  });

  it('a quote that is no longer waiting in Final Review has nothing to release, so nothing blocks', () => {
    expect(
      releaseBlockers(
        review({
          inFinalReview: false,
          requirement: { tierKey: 't2', tierLabel: 'Tier 2', satisfied: false },
          termsAndLegal: terms({ requiredChecks: ['terms_finalized'], finalizedAt: null }),
        }),
      ),
    ).toEqual([]);
  });
});

describe('FB-31 (N19-08): an extra Final Review sign-off still missing blocks the release', () => {
  const signoff = (signedAt: string | null) =>
    ({
      ruleKey: 'amortized_finance_review',
      ruleLabel: 'Customer funded (amortized): finance review',
      signoffKey: 'finance_review',
      signoffLabel: 'Finance review (Leadership)',
      signedByName: null,
      signedAt,
      note: null,
      canSign: false,
    }) as Terms['additionalApprovals'][number];

  it('is listed in the server’s words until it is given, for the approver and for a reader', () => {
    const t = { ...terms({}), additionalApprovals: [signoff(null)] };
    const expected = [
      {
        key: 'signoff:amortized_finance_review:finance_review',
        message: 'Final Review also needs: Finance review (Leadership)',
        fixAt: 'terms-legal',
      },
    ];
    expect(releaseBlockers(review({ termsAndLegal: t }))).toEqual(expected);
    expect(
      releaseBlockers(
        review({
          termsAndLegal: t,
          availableActions: [action('approve', { releasesProposal: true })],
        }),
      ),
    ).toEqual(expected);
    const given = { ...t, additionalApprovals: [signoff('2026-11-20T10:00:00.000Z')] };
    expect(releaseBlockers(review({ termsAndLegal: given }))).toEqual([]);
  });
});
