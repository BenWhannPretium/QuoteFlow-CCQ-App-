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
  withDerivedFields,
  type TermsValues,
} from '.';
import { planCapacitySignoff } from '../engineering/review';
import { DomainError } from '../errors';
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
  const settings = {
    legalReviewTriggers: LEGAL_REVIEW_TRIGGERS_SEED,
    passThrough: { maxAnnualRevenueUsd: 100_000 },
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
    });
  });

  it('G4 Advance needs the terms check, and the Legal review only when triggered', () => {
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
      'legal_review_required,legal_reviewed_on',
    ]);
    expect(decide({ ...checked, legal_reviewed_on: '2026-10-19' }, 'not_yet_established').ok).toBe(
      true,
    );
  });
});

describe('terms (B-26)', () => {
  const empty: TermsValues = {
    toolingFundingModel: null,
    termsToolingCommitment: null,
    termsMoq: null,
    termsPaymentTerms: null,
    termsNonstandard: false,
    termsNotes: null,
    termsCheckedAt: null,
    termsCheckedBy: null,
    legalReviewedOn: null,
    legalReviewerName: null,
    legalReviewNote: null,
    legalRecordedBy: null,
  };
  const plan = (edit: Parameters<typeof planTerms>[0]['edit'], current = empty, closed = false) =>
    planTerms({
      current,
      edit,
      fundingModelCodes: ['COMPANY_FUNDED', 'CUSTOMER_FUNDED'],
      actorId: KAM_ID,
      now: NOW,
      closed,
    });

  it('records the funding model and terms; only the keys sent change', () => {
    const r = plan({ toolingFundingModel: 'CUSTOMER_FUNDED', termsMoq: ' 50k / release ' });
    expect(r.ok && r.values).toMatchObject({
      toolingFundingModel: 'CUSTOMER_FUNDED',
      termsMoq: '50k / release',
      termsPaymentTerms: null,
    });
    expect(r.ok && r.changed.sort()).toEqual(['termsMoq', 'toolingFundingModel']);
    const bad = plan({ toolingFundingModel: 'BARTER' });
    expect(!bad.ok && bad.errors.map((e) => e.field)).toEqual(['toolingFundingModel']);
  });

  it('the terms check needs payment terms and the tooling-commitment answer, and records who and when', () => {
    const missing = plan({ checked: true });
    expect(!missing.ok && missing.errors.map((e) => e.field).sort()).toEqual([
      'termsPaymentTerms',
      'termsToolingCommitment',
    ]);
    const r = plan({ checked: true, termsPaymentTerms: 'Net 45', termsToolingCommitment: false });
    expect(r.ok && [r.values.termsCheckedAt, r.values.termsCheckedBy]).toEqual([NOW, KAM_ID]);
  });

  it('changing a term after the check clears it (no silent edits)', () => {
    const checked = {
      ...empty,
      termsPaymentTerms: 'Net 45',
      termsToolingCommitment: false,
      termsCheckedAt: new Date('2026-10-01T00:00:00Z'),
      termsCheckedBy: OTHER_ID,
    };
    const r = plan({ termsPaymentTerms: 'Net 60' }, checked);
    expect(r.ok && [r.values.termsCheckedAt, r.checkCleared]).toEqual([null, true]);
    const notes = plan({ termsNotes: 'context only' }, checked);
    expect(notes.ok && notes.values.termsCheckedAt).toEqual(checked.termsCheckedAt);
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
    const cleared = plan({ legal: null }, (r as { values: TermsValues }).values);
    expect(cleared.ok && cleared.values.legalReviewedOn).toBeNull();
    expect(plan({ termsMoq: 'x' }, empty, true).ok).toBe(false);
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
