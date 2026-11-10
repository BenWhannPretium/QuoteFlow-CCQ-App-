import { describe, expect, it } from 'vitest';

import {
  ESCALATION_ROUTES_SEED,
  LEGAL_REVIEW_TRIGGERS_SEED,
  PROCESS_OWNER_SEED,
  derivedDecisionFields,
  legalReviewReasons,
  parseCapitalNotice,
  parseEscalationRoutes,
  parseLegalReviewTriggers,
  parseMarketDevNotice,
  parsePassThrough,
  parseProcessOwner,
  passThroughEligible,
  planCapitalNotice,
  planEscalation,
  planMarketDevNotice,
  planTerms,
  planTermsExceptionDecision,
  parseCapitalTermsRequired,
  parseMilestones,
  termsExceptionOpen,
  withDerivedFields,
  CAPITAL_TERMS_REQUIRED_SEED,
  type TermsLists,
  type TermsValues,
} from '.';
import { planCapacitySignoff } from '../engineering/review';
import { DomainError } from '../errors';
import { ROI_REQUIRED_WHEN_SEED } from '../quoting-steps';
import { KAM_ID, NOW, OTHER_ID, makeActor, makeQuote, validCase } from '../test-utils';
import { evaluateTransition } from '../workflow/evaluate';
import { hybridConfig } from '../workflow/seeds';

const USER_A = '0190f0a0-0000-7000-8000-00000000000a';
const USER_B = '0190f0a0-0000-7000-8000-00000000000b';

describe('Legal review triggers (B-26, D-25)', () => {
  it('seeds all three triggers on; parses and refuses malformed config', () => {
    expect(parseLegalReviewTriggers(null)).toEqual(LEGAL_REVIEW_TRIGGERS_SEED);
    expect(
      parseLegalReviewTriggers({
        newCustomer: false,
        nonstandardTerms: true,
        toolingCommitment: true,
      }),
    ).toMatchObject({ newCustomer: false });
    expect(() => parseLegalReviewTriggers({ newCustomer: 'yes' })).toThrow(DomainError);
  });

  it('names each trigger that applies, only when it is switched on', () => {
    const quote = {
      customerStatus: 'not_yet_established',
      termsNonstandard: true,
      termsToolingCommitment: true,
    };
    expect(legalReviewReasons(LEGAL_REVIEW_TRIGGERS_SEED, quote)).toEqual([
      'new_customer',
      'nonstandard_terms',
      'tooling_commitment',
    ]);
    expect(
      legalReviewReasons(
        { newCustomer: false, nonstandardTerms: false, toolingCommitment: true },
        quote,
      ),
    ).toEqual(['tooling_commitment']);
    expect(
      legalReviewReasons(LEGAL_REVIEW_TRIGGERS_SEED, {
        customerStatus: 'existing',
        termsNonstandard: false,
        termsToolingCommitment: null,
      }),
    ).toEqual([]);
  });
});

describe('pricing pass-through (B-26, D-24)', () => {
  it('is off until Pricing sets the amount', () => {
    expect(parsePassThrough(null)).toEqual({ maxAnnualRevenueUsd: null });
    expect(passThroughEligible({ maxAnnualRevenueUsd: null }, 10)).toBe(false);
  });

  it('is strictly below the threshold, with a known revenue', () => {
    const on = { maxAnnualRevenueUsd: 50_000 };
    expect(passThroughEligible(on, 49_999)).toBe(true);
    expect(passThroughEligible(on, 50_000)).toBe(false);
    expect(passThroughEligible(on, null)).toBe(false);
    expect(() => parsePassThrough({ maxAnnualRevenueUsd: -1 })).toThrow(DomainError);
  });
});

describe('derived decision fields', () => {
  // FB-01 (F-069): both G4 checks switched on here; `g4-checks.test.ts` covers the seeded `[]`.
  const settings = {
    legalReviewTriggers: LEGAL_REVIEW_TRIGGERS_SEED,
    passThrough: { maxAnnualRevenueUsd: 100_000 },
    g4RequiredChecks: ['terms_checked', 'legal_review'] as const,
    roiRequiredWhen: ROI_REQUIRED_WHEN_SEED,
  };

  it('derives legal_review_required and pass_through_eligible from config', () => {
    expect(
      derivedDecisionFields(
        { terms_nonstandard: true, est_annual_revenue: 90_000, customer_status: 'existing' },
        settings,
      ),
    ).toEqual({
      legal_review_required: true,
      legal_review_reasons: ['nonstandard_terms'],
      pass_through_eligible: true,
      g4_terms_check_required: true,
      g4_legal_review_check_required: true,
      g4_terms_exception_check_required: false,
      g4_terms_finalized_check_required: false,
      terms_exception_open: false,
      roi_required: false,
      roi_required_reasons: [],
    });
    // FB-08 (T-007): a pending or rejected exception is open.
    expect(
      derivedDecisionFields({ terms_exception_status: 'rejected' }, settings).terms_exception_open,
    ).toBe(true);
  });

  it('FB-07: derives roi_required from roi_required_when (capital required, $0 CER included)', () => {
    const roi = (fields: Record<string, unknown>) => {
      const d = derivedDecisionFields(fields, settings);
      return [d.roi_required, d.roi_required_reasons.map((r) => r.code)];
    };
    expect(roi({ g2_outcome: 'capital_required' })).toEqual([true, ['g2_outcome']]);
    expect(roi({ g2_outcome: 'proceed', capital_likely: true })).toEqual([
      true,
      ['capital_likely'],
    ]);
    expect(roi({ tooling_funding_model: 'ZERO_CER' })).toEqual([true, ['funding_model']]);
    expect(roi({ tooling_funding_model: 'CUSTOMER_FUNDED' })).toEqual([true, ['funding_model']]);
    expect(roi({ tooling_funding_model: 'COMPANY_FUNDED', g2_outcome: 'proceed' })).toEqual([
      false,
      [],
    ]);
  });

  it('G4 Advance needs the terms check, and the Legal review only when triggered (both checks on)', () => {
    const c = validCase(hybridConfig, 'G4', 'approve');
    const decide = (fields: Record<string, unknown>, customerStatus: string | null) =>
      evaluateTransition(
        hybridConfig,
        withDerivedFields(
          makeQuote('FINAL_REVIEW', { fields: { ...fields, customer_status: customerStatus } }),
          settings,
        ),
        makeActor('Approver'),
        c.request,
        NOW,
      );
    const checked = { terms_checked_at: NOW };
    expect(decide({}, 'existing').ok).toBe(false);
    expect(decide(checked, 'existing').ok).toBe(true);
    const newCustomer = decide(checked, 'not_yet_established');
    expect(!newCustomer.ok && newCustomer.errors.map((e) => e.field)).toEqual([
      'legal_review_required,g4_legal_review_check_required,legal_reviewed_on',
    ]);
    expect(decide({ ...checked, legal_reviewed_on: '2026-10-19' }, 'not_yet_established').ok).toBe(
      true,
    );
  });
});

describe('terms (B-26, FB-08)', () => {
  const empty: TermsValues = {
    toolingFundingModel: null,
    termsToolingCommitment: null,
    termsMoq: null,
    termsPaymentTermsCode: null,
    termsPaymentTerms: null,
    termsNonstandard: false,
    termsToolingPayment: null,
    termsMilestoneNote: null,
    termsNotes: null,
    termsCheckedAt: null,
    termsCheckedBy: null,
    legalReviewedOn: null,
    legalReviewerName: null,
    legalReviewNote: null,
    legalRecordedBy: null,
    termsMoldOwnership: null,
    termsAmortized: null,
    termsAmortizationMonths: null,
    termsMinSupply: null,
    termsAgreementInPlace: null,
    termsAgreementMonths: null,
    termsFinalizedAt: null,
    termsFinalizedBy: null,
  };
  const lists: TermsLists = {
    fundingModelCodes: ['COMPANY_FUNDED', 'CUSTOMER_FUNDED', 'ZERO_CER'],
    paymentTerms: [
      { code: 'NET_15', freeText: false },
      { code: 'NET_30', freeText: false },
      { code: 'NET_45', freeText: false },
      { code: 'NET_60', freeText: false },
      { code: 'OTHER', freeText: true },
    ],
    standardPaymentTerms: ['NET_15', 'NET_30'],
    toolingPaymentCodes: ['UPFRONT', 'SPLIT_50_50', 'AMORTIZED_PER_PIECE'],
    moldOwnershipCodes: ['PRETIUM', 'CUSTOMER'],
    capitalTermsRequired: CAPITAL_TERMS_REQUIRED_SEED,
  };
  const plan = (
    edit: Parameters<typeof planTerms>[0]['edit'],
    current = empty,
    extra: Partial<Parameters<typeof planTerms>[0]> = {},
  ) => planTerms({ current, edit, lists, actorId: KAM_ID, now: NOW, closed: false, ...extra });
  const values = (r: ReturnType<typeof planTerms>) => (r as { values: TermsValues }).values;

  it('records the funding model and terms; only the keys sent change', () => {
    const r = plan({ toolingFundingModel: 'CUSTOMER_FUNDED', termsMoq: ' 50k / release ' });
    expect(r.ok && r.values).toMatchObject({
      toolingFundingModel: 'CUSTOMER_FUNDED',
      termsMoq: '50k / release',
      termsPaymentTermsCode: null,
    });
    expect(r.ok && r.changed.sort()).toEqual(['termsMoq', 'toolingFundingModel']);
    const bad = plan({ toolingFundingModel: 'BARTER', termsMoldOwnership: 'NOBODY' });
    expect(!bad.ok && bad.errors.map((e) => e.field)).toEqual([
      'toolingFundingModel',
      'termsMoldOwnership',
    ]);
  });

  it('F-021: each route edits only its own fields (MOQ and funding are Engineering’s)', () => {
    const kam = plan({ termsMoq: '10k' }, empty, { scope: 'sales' });
    expect(!kam.ok && kam.errors.map((e) => e.code)).toEqual(['NOT_PERMITTED']);
    expect(plan({ termsMoq: '10k' }, empty, { scope: 'engineering' }).ok).toBe(true);
    const eng = plan({ termsPaymentTermsCode: 'NET_30' }, empty, { scope: 'engineering' });
    expect(!eng.ok && eng.errors[0]!.message).toMatch(/terms\.engineering\.edit/);
    expect(plan({ finalized: false }, empty, { scope: 'sales' }).ok).toBe(false);
    expect(plan({ termsMinSupply: 'none' }, empty, { scope: 'sales' }).ok).toBe(true);
    expect(plan({ toolingFundingModel: 'ZERO_CER' }, empty, { scope: 'finalize' }).ok).toBe(true);
  });

  it('F-021: a non-standard payment term is flagged and opens an exception; a standard one is not', () => {
    const std = plan({ termsPaymentTermsCode: 'NET_30' });
    expect(std.ok && [std.values.termsNonstandard, std.exception]).toEqual([false, null]);
    const net60 = plan({ termsPaymentTermsCode: 'NET_60' });
    expect(net60.ok && [net60.values.termsNonstandard, net60.exception]).toEqual([true, 'open']);
    const unflag = plan({ termsNonstandard: false }, values(net60));
    expect(!unflag.ok && unflag.errors.map((e) => e.field)).toEqual(['termsNonstandard']);
    // Back to standard: the flag clears and the request is withdrawn.
    const back = plan({ termsPaymentTermsCode: 'NET_15' }, values(net60), {
      exceptionStatus: 'pending',
    });
    expect(back.ok && [back.values.termsNonstandard, back.exception]).toEqual([false, 'withdraw']);
    // Another non-standard term: a new request.
    const net45 = plan({ termsPaymentTermsCode: 'NET_45' }, values(net60), {
      exceptionStatus: 'approved',
    });
    expect(net45.ok && net45.exception).toBe('open');
    // No change to the terms: nothing happens to the request.
    const notes = plan({ termsNotes: 'x' }, values(net60), { exceptionStatus: 'pending' });
    expect(notes.ok && notes.exception).toBeNull();
  });

  it('"Other" needs the detail; picking a listed term clears it; an unknown code is refused', () => {
    const other = plan({ termsPaymentTermsCode: 'OTHER' });
    expect(!other.ok && other.errors.map((e) => e.field)).toEqual(['termsPaymentTerms']);
    const ok = plan({ termsPaymentTermsCode: 'OTHER', termsPaymentTerms: '2% 10 Net 30' });
    expect(ok.ok && [ok.values.termsNonstandard, ok.exception]).toEqual([true, 'open']);
    const reworded = plan({ termsPaymentTerms: '1% 10 Net 30' }, values(ok));
    expect(reworded.ok && reworded.exception).toBe('open');
    const listed = plan({ termsPaymentTermsCode: 'NET_30' }, values(ok));
    expect(listed.ok && listed.values.termsPaymentTerms).toBeNull();
    expect(plan({ termsPaymentTermsCode: 'NET_7' }).ok).toBe(false);
  });

  it('D-029: the tooling payment milestone and a short note', () => {
    const r = plan({ termsToolingPayment: 'SPLIT_50_50', termsMilestoneNote: ' at PPAP ' });
    expect(r.ok && r.values).toMatchObject({
      termsToolingPayment: 'SPLIT_50_50',
      termsMilestoneNote: 'at PPAP',
    });
    expect(plan({ termsToolingPayment: 'QUARTERLY' }).ok).toBe(false);
    expect(plan({ termsMilestoneNote: 'x'.repeat(301) }).ok).toBe(false);
  });

  it('D-029: milestone meta parses only when the percents add up to 100', () => {
    expect(
      parseMilestones({
        milestones: [
          { percent: 50, trigger: 'At the order' },
          { percent: 50, trigger: 'At qualification' },
        ],
      }),
    ).toHaveLength(2);
    expect(parseMilestones({})).toEqual([]);
    expect(parseMilestones({ milestones: [] })).toEqual([]);
    expect(parseMilestones({ milestones: [{ percent: 60, trigger: 'x' }] })).toBeNull();
  });

  it('the terms check needs the payment terms and the tooling-commitment answer, and records who and when', () => {
    const missing = plan({ checked: true });
    expect(!missing.ok && missing.errors.map((e) => e.field).sort()).toEqual([
      'termsPaymentTermsCode',
      'termsToolingCommitment',
    ]);
    const r = plan({
      checked: true,
      termsPaymentTermsCode: 'NET_30',
      termsToolingCommitment: false,
    });
    expect(r.ok && [r.values.termsCheckedAt, r.values.termsCheckedBy]).toEqual([NOW, KAM_ID]);
  });

  it('changing a term after the check clears it (no silent edits)', () => {
    const checked = {
      ...empty,
      termsPaymentTermsCode: 'NET_30',
      termsToolingCommitment: false,
      termsCheckedAt: new Date('2026-10-01T00:00:00Z'),
      termsCheckedBy: OTHER_ID,
    };
    const r = plan({ termsPaymentTermsCode: 'NET_15' }, checked);
    expect(r.ok && [r.values.termsCheckedAt, r.checkCleared]).toEqual([null, true]);
    const notes = plan({ termsNotes: 'context only' }, checked);
    expect(notes.ok && notes.values.termsCheckedAt).toEqual(checked.termsCheckedAt);
  });

  it('F-068: the capital terms; months go with a "yes" and are cleared by a "no"', () => {
    const r = plan({
      termsAmortized: true,
      termsAmortizationMonths: 36,
      termsAgreementInPlace: true,
      termsAgreementMonths: 60,
    });
    expect(r.ok && r.values.termsAmortizationMonths).toBe(36);
    const no = plan({ termsAmortized: false }, values(r));
    expect(no.ok && no.values.termsAmortizationMonths).toBeNull();
    expect(plan({ termsAmortized: true, termsAmortizationMonths: 0 }).ok).toBe(false);
    expect(plan({ termsAgreementInPlace: true, termsAgreementMonths: 241 }).ok).toBe(false);
    expect(plan({ termsMinSupply: 'x'.repeat(301) }).ok).toBe(false);
  });

  it('F-068 (T-031): the approver confirms the capital terms only when the required ones are there', () => {
    const missing = plan({ finalized: true });
    expect(!missing.ok && missing.errors.map((e) => e.field)).toEqual([
      'toolingFundingModel',
      'termsMoldOwnership',
      'termsAmortized',
      'termsMinSupply',
      'termsAgreementInPlace',
    ]);
    const months = plan({
      finalized: true,
      toolingFundingModel: 'ZERO_CER',
      termsMoldOwnership: 'CUSTOMER',
      termsAmortized: true,
      termsMinSupply: 'None',
      termsAgreementInPlace: false,
    });
    expect(!months.ok && months.errors.map((e) => e.field)).toEqual(['termsAmortizationMonths']);
    const r = plan({
      finalized: true,
      toolingFundingModel: 'ZERO_CER',
      termsMoldOwnership: 'CUSTOMER',
      termsAmortized: false,
      termsMinSupply: 'None',
      termsAgreementInPlace: false,
    });
    expect(r.ok && [r.values.termsFinalizedAt, r.values.termsFinalizedBy]).toEqual([NOW, KAM_ID]);
    // FB-11's intake default "Not discussed" is not an answer.
    const notDiscussed = plan(
      { finalized: true, toolingFundingModel: 'COMPANY_FUNDED' },
      { ...values(r), termsFinalizedAt: null, termsFinalizedBy: null },
      { lists: { ...lists, fundingNotAnswered: ['COMPANY_FUNDED'] } },
    );
    expect(!notDiscussed.ok && notDiscussed.errors.map((e) => e.field)).toEqual([
      'toolingFundingModel',
    ]);
    // A configured-down required set confirms with less.
    expect(
      plan({ finalized: true, toolingFundingModel: 'ZERO_CER' }, empty, {
        lists: { ...lists, capitalTermsRequired: ['funding_model'] },
      }).ok,
    ).toBe(true);
    // Changing a capital term afterwards clears the confirmation; other terms do not.
    const changed = plan({ termsMinSupply: '80% of forecast' }, values(r));
    expect(changed.ok && [changed.values.termsFinalizedAt, changed.finalizeCleared]).toEqual([
      null,
      true,
    ]);
    const other = plan({ termsPaymentTermsCode: 'NET_30' }, values(r));
    expect(other.ok && other.values.termsFinalizedAt).toEqual(NOW);
  });

  it('records and clears the Legal review; refuses a future date or no reviewer', () => {
    const r = plan({ legal: { reviewedOn: '2026-10-19', reviewerName: ' J. Legal ', note: 'ok' } });
    expect(r.ok && r.values).toMatchObject({
      legalReviewedOn: '2026-10-19',
      legalReviewerName: 'J. Legal',
      legalRecordedBy: KAM_ID,
    });
    const bad = plan({ legal: { reviewedOn: '2026-12-01', reviewerName: ' ' } });
    expect(!bad.ok && bad.errors.map((e) => e.field).sort()).toEqual([
      'legal.reviewedOn',
      'legal.reviewerName',
    ]);
    const cleared = plan({ legal: null }, values(r));
    expect(cleared.ok && cleared.values.legalReviewedOn).toBeNull();
    expect(plan({ termsMoq: 'x' }, empty, { closed: true }).ok).toBe(false);
  });

  it('capital_terms_required parses and refuses malformed config', () => {
    expect(parseCapitalTermsRequired(null)).toEqual(CAPITAL_TERMS_REQUIRED_SEED);
    expect(parseCapitalTermsRequired(['min_supply', 'min_supply'])).toEqual(['min_supply']);
    expect(() => parseCapitalTermsRequired(['mold'])).toThrow(DomainError);
  });
});

describe('the payment-terms exception decision (T-007)', () => {
  const decide = (over: Partial<Parameters<typeof planTermsExceptionDecision>[0]> = {}) =>
    planTermsExceptionDecision({
      status: 'pending',
      decision: 'approve',
      rationale: ' strategic account ',
      closed: false,
      ...over,
    });

  it('approves or rejects a pending request, always with a rationale', () => {
    expect(decide()).toEqual({ ok: true, status: 'approved', rationale: 'strategic account' });
    expect(decide({ decision: 'reject' })).toMatchObject({ ok: true, status: 'rejected' });
    const none = decide({ rationale: '  ' });
    expect(!none.ok && none.errors.map((e) => e.field)).toEqual(['rationale']);
    expect(decide({ rationale: 'x'.repeat(1001) }).ok).toBe(false);
  });

  it('refuses when nothing is pending or the quote is closed', () => {
    for (const status of [null, 'approved', 'rejected']) {
      const r = decide({ status });
      expect(!r.ok && r.errors.map((e) => e.code)).toEqual(['NO_PENDING_EXCEPTION']);
    }
    expect(decide({ closed: true }).ok).toBe(false);
  });

  it('only pending and rejected keep the exception open', () => {
    expect(['pending', 'rejected', 'approved', null].map(termsExceptionOpen)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});

describe('early notices (B-26)', () => {
  it('Capital Management hears once, when the flag is set', () => {
    const setting = parseCapitalNotice({ recipientUserIds: [USER_A] });
    expect(planCapitalNotice(setting, { capitalLikely: true, capitalNoticeSentAt: null })).toEqual([
      { type: 'quote.capital_likely', recipient: { kind: 'user', userId: USER_A } },
    ]);
    expect(planCapitalNotice(setting, { capitalLikely: true, capitalNoticeSentAt: NOW })).toEqual(
      [],
    );
    expect(planCapitalNotice(setting, { capitalLikely: false, capitalNoticeSentAt: null })).toEqual(
      [],
    );
    expect(parseCapitalNotice(null)).toEqual({ recipientUserIds: [] });
    expect(() => parseCapitalNotice({ recipientUserIds: [USER_A, USER_A] })).toThrow(DomainError);
  });

  it('Market Development hears at or above the threshold, once; off while the threshold is unset', () => {
    const on = parseMarketDevNotice({ minAnnualRevenueUsd: 1_000_000, recipientUserIds: [USER_B] });
    const quote = { estAnnualRevenue: 1_000_000, marketDevNoticeSentAt: null };
    expect(planMarketDevNotice(on, quote)).toHaveLength(1);
    expect(planMarketDevNotice(on, { ...quote, estAnnualRevenue: 999_999 })).toEqual([]);
    expect(planMarketDevNotice(on, { ...quote, marketDevNoticeSentAt: NOW })).toEqual([]);
    expect(planMarketDevNotice(parseMarketDevNotice(null), quote)).toEqual([]);
  });
});

describe('escalations and the Process Owner (B-26)', () => {
  const routes = parseEscalationRoutes(null);
  const owner = parseProcessOwner({ userId: USER_A, label: 'CCQ Process Owner (interim)' });

  it('seeds the deck’s escalation paths and validates config', () => {
    expect(routes.map((r) => r.code)).toEqual(ESCALATION_ROUTES_SEED.map((r) => r.code));
    expect(parseProcessOwner(null)).toEqual(PROCESS_OWNER_SEED);
    expect(() => parseEscalationRoutes([])).toThrow(DomainError);
    expect(() => parseEscalationRoutes([{ ...routes[0]!, roles: ['Nobody'] }])).toThrow(
      DomainError,
    );
    expect(() => parseEscalationRoutes([routes[0], routes[0]])).toThrow(/duplicate/);
  });

  it('routes to the roles, the named users and the Process Owner', () => {
    const r = planEscalation({
      routes,
      processOwner: owner,
      code: 'queue_priority',
      note: ' stuck ',
      closed: false,
    });
    expect(r.ok && r.note).toBe('stuck');
    expect(r.ok && r.notifications).toEqual([
      { type: 'quote.escalated', recipient: { kind: 'role', role: 'EngLead' } },
      { type: 'quote.escalated', recipient: { kind: 'user', userId: USER_A } },
    ]);
  });

  it('needs a known type and a note, an open quote, and somebody to tell', () => {
    const bad = planEscalation({
      routes,
      processOwner: owner,
      code: 'nope',
      note: ' ',
      closed: true,
    });
    expect(!bad.ok && bad.errors.map((e) => e.code)).toEqual([
      'QUOTE_CLOSED',
      'INVALID_VALUE',
      'NOTE_REQUIRED',
    ]);
    const nobody = planEscalation({
      routes,
      processOwner: PROCESS_OWNER_SEED,
      code: 'capacity',
      note: 'line full',
      closed: false,
    });
    expect(!nobody.ok && nobody.errors.map((e) => e.code)).toEqual(['NO_RECIPIENTS']);
  });
});

describe('capacity sign-off (B-26, slide 11)', () => {
  const quote = makeQuote('ENG_REVIEW');

  it('the capacity owner (EngLead, provisional) approves or blocks; blocking needs a note', () => {
    expect(planCapacitySignoff(makeActor('EngLead'), quote, { status: 'approved' })).toEqual({
      ok: true,
      status: 'approved',
      note: null,
    });
    const blocked = planCapacitySignoff(makeActor('EngLead'), quote, { status: 'blocked' });
    expect(!blocked.ok && blocked.errors.map((e) => e.code)).toEqual(['NOTE_REQUIRED']);
    expect(
      planCapacitySignoff(makeActor('EngLead'), quote, { status: 'blocked', note: 'Line full' }).ok,
    ).toBe(true);
    expect(planCapacitySignoff(makeActor('EngLead'), quote, { status: null })).toMatchObject({
      ok: true,
      status: null,
    });
  });

  it('only in Engineering Review, and only by the capacity owner', () => {
    const engineer = planCapacitySignoff(
      makeActor('Engineer'),
      makeQuote('ENG_REVIEW', { assignedEngineerId: OTHER_ID }),
      { status: 'approved' },
    );
    expect(!engineer.ok && engineer.errors.map((e) => e.code)).toEqual(['NOT_PERMITTED']);
    const wrong = planCapacitySignoff(makeActor('EngLead'), makeQuote('QUOTING'), {
      status: 'approved',
    });
    expect(!wrong.ok && wrong.errors.map((e) => e.code)).toEqual(['WRONG_STAGE']);
    const bad = planCapacitySignoff(makeActor('EngLead'), quote, { status: 'maybe' });
    expect(!bad.ok && bad.errors.map((e) => e.field)).toEqual(['status']);
  });
});
