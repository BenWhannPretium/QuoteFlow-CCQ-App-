import { describe, expect, it } from 'vitest';

import {
  CAPITAL_NEEDED_FILTER,
  FLAGGED_G2_OUTCOMES,
  NO_CAPITAL_READINESS,
  PRICING_QUEUE_STAGE_KEY,
  filterPricingQueue,
  flaggedForCapitalOrRisk,
  g2FilterOptions,
  planPricerAssignment,
  sortPricingQueue,
  type PricingQueueEntry,
} from './queue';
import {
  CAPITAL_READINESS_DEFAULT_SEED,
  CAPITAL_READINESS_HELP,
  CAPITAL_READINESS_LABELS,
  CAPITAL_READINESS_VALUES,
  EMPTY_PRICING_RECORD,
  MAX_PRICING_REFS,
  PRICING_REF_FORMATS_SEED,
  canEditQuoting,
  carryForwardPricingRecord,
  defaultCapitalReadiness,
  parseCapitalReadinessDefault,
  parsePricingRefFormats,
  planCapitalReadiness,
  planPricingRecord,
  priceApprovalStatus,
  quotingWarnings,
  type PricingRecordValues,
} from './record';
import { capitalNeed, capitalNeededForReadiness } from '../engineering/capital-needed';
import { redact } from '../policy/redact';
import { KAM_ID, NOW, OTHER_ID, makeActor, makeQuote, validCase } from '../test-utils';
import { asUserId } from '../types/ids';
import { evaluateTransition } from '../workflow/evaluate';
import { fieldsReferenced } from '../workflow/rules';
import { hybridConfig } from '../workflow/seeds/hybrid';

const PRICER = asUserId('user-pricer');
const PRICER_2 = asUserId('user-pricer-2');
const pricing = makeActor('Pricing', { userId: PRICER });
const quoting = makeQuote(PRICING_QUEUE_STAGE_KEY);
const ctx = {
  formats: PRICING_REF_FORMATS_SEED,
  pricingUserIds: new Set<string>([PRICER, PRICER_2]),
  now: NOW,
  costModelOnFile: true,
};

describe('pricing-app reference formats', () => {
  it('parses the seed; rejects bad patterns and examples that do not match', () => {
    expect(parsePricingRefFormats(PRICING_REF_FORMATS_SEED)).toEqual(PRICING_REF_FORMATS_SEED);
    const bad = (erf: object) => () => parsePricingRefFormats({ ...PRICING_REF_FORMATS_SEED, erf });
    expect(bad({ label: 'ERF', pattern: '(', example: '1' })).toThrow(/failed validation/);
    expect(bad({ label: 'ERF', pattern: '^\\d+$', example: 'ABC' })).toThrow(/matches its example/);
    expect(() => parsePricingRefFormats({})).toThrow(/INVALID_CONFIG|failed validation/);
  });
});

describe('who edits the Quoting tab', () => {
  it('Pricing, while the quote is in Quoting and open', () => {
    expect(canEditQuoting(pricing, quoting, hybridConfig)).toBe(true);
    expect(canEditQuoting(pricing, { ...quoting, status: 'on_hold' }, hybridConfig)).toBe(true);
    expect(canEditQuoting(pricing, { ...quoting, status: 'closed' }, hybridConfig)).toBe(false);
    expect(canEditQuoting(pricing, makeQuote('FINAL_REVIEW'), hybridConfig)).toBe(false);
    for (const role of ['KAM', 'Engineer', 'EngLead', 'Approver', 'Leadership', 'Admin'] as const) {
      expect(canEditQuoting(makeActor(role), quoting, hybridConfig), role).toBe(false);
    }
  });

  it('reports why not', () => {
    const codes = (actor = pricing, quote = quoting) => {
      const plan = planPricingRecord(actor, quote, EMPTY_PRICING_RECORD, {}, ctx);
      return plan.ok ? [] : plan.errors.map((e) => e.code);
    };
    expect(codes(makeActor('KAM', { userId: KAM_ID }))).toEqual(['NOT_PERMITTED']);
    expect(codes(pricing, { ...quoting, status: 'closed' })).toEqual(['QUOTE_CLOSED']);
    expect(codes(pricing, makeQuote('ENG_REVIEW'))).toEqual(['WRONG_STAGE']);
    const cap = planCapitalReadiness(
      makeActor('Approver'),
      quoting,
      EMPTY_PRICING_RECORD,
      { capitalReadiness: 'pending' },
      false,
    );
    expect(!cap.ok && cap.errors[0]!.code).toBe('NOT_PERMITTED');
  });
});

describe('price approval record', () => {
  it('DR-pricing-finance-16: refuses an approval time before the quote existed', () => {
    const plan = planPricingRecord(
      pricing,
      quoting,
      EMPTY_PRICING_RECORD,
      { approvedBy: PRICER_2, approvedAt: new Date('1990-01-01T00:00:00Z') },
      { ...ctx, quoteCreatedAt: new Date('2026-10-01T15:00:00Z') },
    );
    expect(!plan.ok && plan.errors.map((e) => [e.field, e.message])).toEqual([
      ['approvedAt', 'The approval time cannot be before the quote was created'],
    ]);
    const ok = planPricingRecord(
      pricing,
      quoting,
      EMPTY_PRICING_RECORD,
      { approvedBy: PRICER_2, approvedAt: new Date('2026-10-02T15:00:00Z') },
      { ...ctx, quoteCreatedAt: new Date('2026-10-01T15:00:00Z') },
    );
    expect(ok.ok).toBe(true);
  });

  it('records approver, time, basis, range, refs and the costing attestation', () => {
    const at = new Date('2026-10-20T14:00:00Z');
    const plan = planPricingRecord(
      pricing,
      quoting,
      EMPTY_PRICING_RECORD,
      {
        approvedBy: PRICER_2,
        approvedAt: at,
        pricingBasisNote: '  March CDI, FOB Chicago ',
        approvedRangeNote: 'Within the approved range',
        erfRefs: ['ERF25-367', ' ERF25-367', 'ERF24-061'],
        costingCompleted: true,
      },
      ctx,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.next).toMatchObject({
      priceApprovedBy: PRICER_2,
      priceApprovedAt: at,
      pricingBasisNote: 'March CDI, FOB Chicago',
      erfRefs: ['ERF25-367', 'ERF24-061'],
      costingCompleted: true,
      costingAttestedBy: PRICER,
      costingAttestedAt: NOW,
    });
    expect(plan.changed).toEqual(
      expect.arrayContaining([
        'priceApprovedBy',
        'priceApprovedAt',
        'pricingBasisNote',
        'approvedRangeNote',
        'erfRefs',
        'costingCompleted',
      ]),
    );
  });

  it('defaults the time to now; clearing the approver clears the time; only keys sent change', () => {
    const named = planPricingRecord(
      pricing,
      quoting,
      EMPTY_PRICING_RECORD,
      { approvedBy: PRICER },
      ctx,
    );
    expect(named.ok && named.next.priceApprovedAt).toEqual(NOW);
    const current: PricingRecordValues = {
      ...EMPTY_PRICING_RECORD,
      priceApprovedBy: PRICER,
      priceApprovedAt: NOW,
      erfRefs: ['ERF25-367'],
      costingCompleted: true,
      costingAttestedBy: PRICER_2,
      costingAttestedAt: NOW,
    };
    const cleared = planPricingRecord(pricing, quoting, current, { approvedBy: null }, ctx);
    expect(cleared.ok && cleared.next).toMatchObject({
      priceApprovedBy: null,
      priceApprovedAt: null,
      erfRefs: ['ERF25-367'],
      costingAttestedBy: PRICER_2,
    });
    const same = planPricingRecord(pricing, quoting, current, { costingCompleted: true }, ctx);
    expect(same.ok && same.changed).toEqual([]);
    const untick = planPricingRecord(pricing, quoting, current, { costingCompleted: false }, ctx);
    expect(untick.ok && untick.next).toMatchObject({
      costingCompleted: false,
      costingAttestedBy: null,
      costingAttestedAt: null,
    });
  });

  it('rejects a non-Pricing approver, a future time and malformed references, all at once', () => {
    const plan = planPricingRecord(
      pricing,
      quoting,
      EMPTY_PRICING_RECORD,
      {
        approvedBy: KAM_ID,
        approvedAt: new Date(NOW.getTime() + 60 * 60_000),
        erfRefs: ['ERF 12', ''],
      },
      ctx,
    );
    expect(!plan.ok && plan.errors.map((e) => [e.code, e.field])).toEqual([
      ['INVALID_VALUE', 'approvedBy'],
      ['INVALID_VALUE', 'approvedAt'],
      ['INVALID_VALUE', 'erfRefs/0'],
    ]);
    const skew = planPricingRecord(
      pricing,
      quoting,
      EMPTY_PRICING_RECORD,
      { approvedBy: PRICER, approvedAt: new Date(NOW.getTime() + 60_000) },
      ctx,
    );
    expect(skew.ok).toBe(true);
    const many = planPricingRecord(
      pricing,
      quoting,
      EMPTY_PRICING_RECORD,
      { erfRefs: Array.from({ length: MAX_PRICING_REFS + 1 }, (_, i) => `ERF25-${10000 + i}`) },
      ctx,
    );
    expect(!many.ok && many.errors[0]!.field).toBe('erfRefs');
  });

  it('a new version starts from the references only (CR-38: approvals are recorded afresh)', () => {
    const prior: PricingRecordValues = {
      ...EMPTY_PRICING_RECORD,
      priceApprovedBy: PRICER,
      priceApprovedAt: NOW,
      erfRefs: ['ERF25-367'],
      cerReference: 'CER-9',
      capitalReadiness: 'pre_approved',
      approvedRangeNote: 'x',
    };
    expect(carryForwardPricingRecord(prior)).toEqual({
      ...EMPTY_PRICING_RECORD,
      erfRefs: ['ERF25-367'],
      cerReference: 'CER-9',
    });
    expect(carryForwardPricingRecord(null)).toEqual(EMPTY_PRICING_RECORD);
  });
});

describe('capital readiness', () => {
  it('sets status, CER reference and notes; clears the pending justification when not pending', () => {
    const pending = planCapitalReadiness(
      pricing,
      quoting,
      EMPTY_PRICING_RECORD,
      {
        capitalReadiness: 'pending',
        cerReference: ' CER-123 ',
        capitalNotes: 'Apex in review',
        capitalPendingJustification: 'CER goes to the board on Nov 10',
      },
      true,
    );
    expect(pending.ok && pending.next).toMatchObject({
      capitalReadiness: 'pending',
      cerReference: 'CER-123',
      capitalPendingJustification: 'CER goes to the board on Nov 10',
    });
    const approved = planCapitalReadiness(
      pricing,
      quoting,
      (pending as { next: PricingRecordValues }).next,
      { capitalReadiness: 'pre_approved' },
      true,
    );
    expect(approved.ok && approved.next).toMatchObject({
      capitalReadiness: 'pre_approved',
      cerReference: 'CER-123',
      capitalNotes: 'Apex in review',
      capitalPendingJustification: null,
    });
    expect(CAPITAL_READINESS_LABELS.pre_approved).toBe('Capital pre-approved (budgetary)');
  });

  it('cannot be "not required" when Engineering says capital is needed, nor an unknown value', () => {
    // FB-17 (W13-22): "capital needed" is the preliminary capital above the threshold, or a quote
    // decided "Advance – capital required" before that outcome was switched off.
    const run = (value: string, fields: Record<string, unknown>) =>
      planCapitalReadiness(
        pricing,
        quoting,
        EMPTY_PRICING_RECORD,
        { capitalReadiness: value },
        capitalNeed(fields).byEngineering,
      );
    const refused = run('not_required', { g2_outcome: 'capital_required' });
    expect(!refused.ok && refused.errors.map((e) => [e.code, e.field, e.message])).toEqual([
      [
        'INVALID_VALUE',
        'capitalReadiness',
        'Engineering said capital is needed, so capital readiness cannot be "Not required"',
      ],
    ]);
    expect(run('not_required', { g2_outcome: 'proceed', prelim_capital_usd: 250_000 }).ok).toBe(
      false,
    );
    expect(run('pending', { g2_outcome: 'proceed', prelim_capital_usd: 250_000 }).ok).toBe(true);
    expect(run('not_required', { g2_outcome: 'proceed', prelim_capital_usd: 0 }).ok).toBe(true);
    expect(run('not_required', { g2_outcome: 'proceed' }).ok).toBe(true);
    expect(run('not_required', {}).ok).toBe(true);
    // "Capital likely" alone (Sales can set it at intake) is not Engineering's evidence: the G3 rule
    // lets Pricing answer it with "Not required" after all.
    expect(run('not_required', { capital_likely: true, prelim_capital_usd: 0 }).ok).toBe(true);
    const bad = run('maybe', {});
    expect(!bad.ok && bad.errors[0]!.field).toBe('capitalReadiness');
  });
});

describe('what other roles see', () => {
  it('approval status: who and when, only when both are recorded', () => {
    expect(priceApprovalStatus(null)).toEqual({
      approved: false,
      approvedAt: null,
      approvedById: null,
    });
    expect(priceApprovalStatus({ priceApprovedBy: PRICER, priceApprovedAt: null }).approved).toBe(
      false,
    );
    expect(priceApprovalStatus({ priceApprovedBy: PRICER, priceApprovedAt: NOW })).toEqual({
      approved: true,
      approvedAt: NOW,
      approvedById: PRICER,
    });
  });

  it('the record, its history and capital readiness are commercial; the status is not', () => {
    const dto = {
      approval: { approved: true, approvedAt: NOW.toISOString(), approvedByName: 'Gemma' },
      pricingRecord: { approvedRangeNote: 'x', capitalNotes: 'y' },
      pricingRecords: [{ approvedRangeNote: 'old' }],
      capitalReadiness: 'pending',
    };
    expect(redact(dto, makeActor([]))).toEqual({ approval: dto.approval });
    // Since 2026-10-30 every role sees the whole record.
    expect(redact(dto, makeActor('KAM'))).toEqual(dto);
    expect(redact(dto, makeActor('Engineer'))).toEqual(dto);
    expect(redact(dto, makeActor('Pricing'))).toEqual(dto);
  });

  it('warnings: pending capital, capital not approved, costing not attested (B-26: no BPR / no-record note)', () => {
    expect(quotingWarnings(null)).toEqual([]);
    const codes = (r: Partial<PricingRecordValues>) =>
      quotingWarnings({ ...EMPTY_PRICING_RECORD, costingCompleted: true, ...r }).map((w) => w.code);
    expect(codes({ capitalReadiness: 'pending' })).toEqual(['CAPITAL_PENDING']);
    expect(
      quotingWarnings({
        ...EMPTY_PRICING_RECORD,
        costingCompleted: true,
        capitalReadiness: 'pending',
        capitalPendingJustification: 'board date',
      })[0]!.message,
    ).toContain('board date');
    // FB-21: pending is a warning that says it is normal, never a request for a justification.
    const pendingMessage = quotingWarnings({
      ...EMPTY_PRICING_RECORD,
      costingCompleted: true,
      capitalReadiness: 'pending',
    })[0]!.message;
    expect(pendingMessage).toContain('normal before award');
    expect(pendingMessage).not.toMatch(/justification/i);
    expect(codes({ capitalReadiness: 'not_approved' })).toEqual(['CAPITAL_NOT_APPROVED']);
    expect(codes({ costingCompleted: false })).toEqual(['COSTING_NOT_ATTESTED']);
    expect(codes({ erfRefs: [] })).toEqual([]);
    // FB-07: a grandfathered record without a model says so; with one on file it does not.
    expect(codes({ costModelRequirement: 'grandfathered' })).toEqual([]);
    expect(
      quotingWarnings(
        { ...EMPTY_PRICING_RECORD, costingCompleted: true, costModelRequirement: 'grandfathered' },
        false,
      ).map((w) => w.code),
    ).toEqual(['NO_COST_MODEL_ON_FILE']);
  });
});

describe('FB-07 costing attestation needs the costing model (F-032)', () => {
  it('refuses "costing completed" without a current costing model', () => {
    const plan = planPricingRecord(
      pricing,
      quoting,
      EMPTY_PRICING_RECORD,
      { costingCompleted: true },
      { ...ctx, costModelOnFile: false },
    );
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.errors.map((e) => [e.code, e.field])).toEqual([
      ['COST_MODEL_REQUIRED', 'costingCompleted'],
    ]);
  });

  it('accepts it with the model on file, or when the record is grandfathered', () => {
    expect(
      planPricingRecord(pricing, quoting, EMPTY_PRICING_RECORD, { costingCompleted: true }, ctx).ok,
    ).toBe(true);
    expect(
      planPricingRecord(
        pricing,
        quoting,
        { ...EMPTY_PRICING_RECORD, costModelRequirement: 'grandfathered' },
        { costingCompleted: true },
        { ...ctx, costModelOnFile: false },
      ).ok,
    ).toBe(true);
  });

  it('still lets Pricing clear the attestation without a model', () => {
    const current = { ...EMPTY_PRICING_RECORD, costingCompleted: true };
    const plan = planPricingRecord(
      pricing,
      quoting,
      current,
      { costingCompleted: false },
      { ...ctx, costModelOnFile: false },
    );
    expect(plan.ok && plan.next.costingCompleted).toBe(false);
  });

  it('a new version starts "required" (carry-forward never grandfathers)', () => {
    expect(
      carryForwardPricingRecord({ ...EMPTY_PRICING_RECORD, costModelRequirement: 'grandfathered' })
        .costModelRequirement,
    ).toBe('required');
  });
});

describe('pricing queue', () => {
  const entry = (overrides: Partial<PricingQueueEntry>): PricingQueueEntry => ({
    quoteNumber: 'CCQ-2026-00001',
    tier: 'STANDARD',
    score: 50,
    activeMsInStage: 1000,
    g2Outcome: 'proceed',
    capitalNeeded: false,
    capitalReadiness: null,
    priceApproved: false,
    productFamily: 'BOTTLE',
    kamUserId: KAM_ID,
    assignedPricerId: null,
    searchText: '',
    ...overrides,
  });
  const tiers = ['CRITICAL', 'HIGH', 'STANDARD', 'LOW'];

  it('orders tier → score → longest in Quoting → quote number', () => {
    const sorted = sortPricingQueue(
      [
        entry({ quoteNumber: 'A', tier: 'LOW', score: 99 }),
        entry({ quoteNumber: 'B', tier: 'HIGH', score: 60 }),
        entry({ quoteNumber: 'C', tier: 'HIGH', score: 70 }),
        entry({ quoteNumber: 'D', tier: 'HIGH', score: 60, activeMsInStage: 5000 }),
        entry({ quoteNumber: 'E', tier: null, score: null }),
        entry({ quoteNumber: 'F', tier: 'HIGH', score: 60, activeMsInStage: 5000 }),
        entry({ quoteNumber: 'G', tier: 'MYSTERY', score: 10 }),
        entry({ quoteNumber: 'H', tier: 'HIGH', score: null }),
      ],
      tiers,
    );
    expect(sorted.map((e) => e.quoteNumber)).toEqual(['C', 'D', 'F', 'B', 'H', 'A', 'G', 'E']);
  });

  it('filters by tier, G2 outcome, capital readiness, approval, family, KAM and text', () => {
    const all = [
      entry({
        quoteNumber: 'A',
        tier: 'HIGH',
        g2Outcome: 'capital_required',
        capitalReadiness: 'pending',
        searchText: 'acme',
      }),
      entry({
        quoteNumber: 'B',
        g2Outcome: 'proceed_with_risk',
        priceApproved: true,
        productFamily: 'JAR',
      }),
      entry({ quoteNumber: 'C', g2Outcome: null, kamUserId: OTHER_ID }),
    ];
    const keys = (f: Parameters<typeof filterPricingQueue>[1]) =>
      filterPricingQueue(all, f).map((e) => e.quoteNumber);
    expect(keys({})).toEqual(['A', 'B', 'C']);
    expect(keys({ tiers: ['HIGH'] })).toEqual(['A']);
    expect(keys({ g2Outcomes: ['capital_required', 'proceed_with_risk'] })).toEqual(['A', 'B']);
    expect(keys({ capitalReadiness: ['pending'] })).toEqual(['A']);
    expect(keys({ capitalReadiness: [NO_CAPITAL_READINESS] })).toEqual(['B', 'C']);
    expect(keys({ priceApproved: true })).toEqual(['B']);
    expect(keys({ priceApproved: false })).toEqual(['A', 'C']);
    expect(keys({ productFamilies: ['JAR'] })).toEqual(['B']);
    expect(keys({ kamUserId: OTHER_ID })).toEqual(['C']);
    expect(keys({ q: ' ACME ' })).toEqual(['A']);
    expect(keys({ tiers: ['NONE'], g2Outcomes: [] })).toEqual([]);
  });

  it('FB-17: "capital needed" flags and filters a quote whatever its G2 outcome', () => {
    const need = (fields: Record<string, unknown>) => capitalNeed(fields).needed;
    const all = [
      // Decided before FB-17 with the retired outcome: still capital, still flagged.
      entry({
        quoteNumber: 'OLD',
        g2Outcome: 'capital_required',
        capitalNeeded: need({ g2_outcome: 'capital_required' }),
      }),
      // A plain Advance whose preliminary capital is above $0.
      entry({
        quoteNumber: 'FIGURE',
        g2Outcome: 'proceed',
        capitalNeeded: need({ g2_outcome: 'proceed', prelim_capital_usd: 250_000 }),
      }),
      // Flagged "capital likely" (the G2 advance sets it; Sales can too).
      entry({
        quoteNumber: 'LIKELY',
        g2Outcome: 'proceed',
        capitalNeeded: need({ g2_outcome: 'proceed', prelim_capital_usd: 0, capital_likely: true }),
      }),
      entry({
        quoteNumber: 'RISK',
        g2Outcome: 'proceed_with_risk',
        capitalNeeded: need({ g2_outcome: 'proceed_with_risk', prelim_capital_usd: 0 }),
      }),
      entry({
        quoteNumber: 'PLAIN',
        g2Outcome: 'proceed',
        capitalNeeded: need({ g2_outcome: 'proceed', prelim_capital_usd: 0 }),
      }),
      // No figure on an old quote is unknown, not capital.
      entry({ quoteNumber: 'BLANK', g2Outcome: 'proceed', capitalNeeded: need({}) }),
    ];
    const keys = (g2Outcomes: string[]) =>
      filterPricingQueue(all, { g2Outcomes }).map((e) => e.quoteNumber);
    expect(all.filter(flaggedForCapitalOrRisk).map((e) => e.quoteNumber)).toEqual([
      'OLD',
      'FIGURE',
      'LIKELY',
      'RISK',
    ]);
    expect(keys([CAPITAL_NEEDED_FILTER])).toEqual(['OLD', 'FIGURE', 'LIKELY']);
    expect(keys([CAPITAL_NEEDED_FILTER, 'proceed_with_risk'])).toEqual([
      'OLD',
      'FIGURE',
      'LIKELY',
      'RISK',
    ]);
    // The outcome keys still filter as before, the retired one included.
    expect(keys(['capital_required'])).toEqual(['OLD']);
    expect(keys(['proceed'])).toEqual(['FIGURE', 'LIKELY', 'PLAIN', 'BLANK']);
    expect(FLAGGED_G2_OUTCOMES).toEqual(['capital_required', 'proceed_with_risk']);
  });

  it('FB-17: the filter offers "Capital needed" first and keeps the switched-off outcome', () => {
    expect(g2FilterOptions(hybridConfig)).toEqual([
      { key: 'capital_needed', label: 'Capital needed' },
      { key: 'proceed', label: 'Advance' },
      { key: 'proceed_with_risk', label: 'Advance with risk' },
      { key: 'capital_required', label: 'Advance – capital required' },
      { key: 'hold', label: 'Hold' },
      { key: 'rework', label: 'Send back to the KAM (fix the intake)' },
      { key: 'redirect', label: 'Send back to Engineering (try another platform or site)' },
      { key: 'stop', label: 'Stop' },
    ]);
  });
});

describe('G3 (hybrid seed)', () => {
  // 2026-10-30: the pricing lead decides G3 (the pricer submits to them first).
  const lead = makeActor('PricingLead');
  const approved = {
    price_approved_by: PRICER,
    price_approved_at: NOW,
    costing_completed: true,
    capital_readiness: 'not_required',
  };
  const submit = (
    record: Record<string, unknown>,
    actor = lead,
    fields: Record<string, unknown> = {},
  ) =>
    evaluateTransition(
      hybridConfig,
      makeQuote('QUOTING', {
        // FB-07: the models are on file and no ROI is needed unless a test says otherwise. FB-21:
        // `capital_not_approved` is derived by the server from the record, as here.
        fields: {
          cost_model_on_file: true,
          roi_required: false,
          capital_not_approved: record.capital_readiness === 'not_approved',
          pricing_record: record,
          ...fields,
        },
      }),
      actor,
      { gateKey: 'G3', outcomeKey: 'submit' },
      NOW,
    );
  const missing = (r: ReturnType<typeof submit>) =>
    r.ok ? [] : r.errors.map((e) => e.field ?? e.code);

  it('FB-07 / FB-21: the costing model, then the payback model only while one is asked for', () => {
    const noModels = { cost_model_on_file: false, roi_model_on_file: false };
    expect(missing(submit(approved, lead, noModels))).toEqual([
      'cost_model_on_file,pricing_record.cost_model_requirement',
    ]);
    // FB-21: an open request (roi_required) needs a payback model uploaded after it (payback_received).
    expect(missing(submit(approved, lead, { ...noModels, roi_required: true }))).toEqual([
      'cost_model_on_file,pricing_record.cost_model_requirement',
      'roi_required,payback_received',
    ]);
    // A payback model on file from before the request does not count.
    expect(
      missing(
        submit(approved, lead, {
          roi_required: true,
          roi_model_on_file: true,
          payback_received: false,
        }),
      ),
    ).toEqual(['roi_required,payback_received']);
    expect(submit(approved, lead, { roi_required: true, payback_received: true }).ok).toBe(true);
    // Grandfathered (in Quoting with costing attested before FB-07): no costing model needed.
    expect(
      submit({ ...approved, cost_model_requirement: 'grandfathered' }, lead, noModels).ok,
    ).toBe(true);
    // A missing derived field fails closed.
    expect(
      missing(
        evaluateTransition(
          hybridConfig,
          makeQuote('QUOTING', { fields: { pricing_record: approved } }),
          lead,
          { gateKey: 'G3', outcomeKey: 'submit' },
          NOW,
        ),
      ),
    ).toEqual([
      'capital_not_approved',
      'cost_model_on_file,pricing_record.cost_model_requirement',
      'roi_required,payback_received',
    ]);
  });

  it('Advance needs the approval, the costing attestation and a capital status (B-26: no ERF / BPR)', () => {
    expect(missing(submit({}))).toEqual([
      'pricing_record.price_approved_by,pricing_record.price_approved_at,pass_through_eligible',
      'pricing_record.costing_completed',
      'pricing_record.capital_readiness',
    ]);
    expect(submit(approved).ok).toBe(true);
    expect(submit({ ...approved, pricing_refs: { erf: ['ERF25-367'] } }).ok).toBe(true);
  });

  it('B-26: cost before price: an unattested cost sheet blocks Advance', () => {
    expect(missing(submit({ ...approved, costing_completed: false }))).toEqual([
      'pricing_record.costing_completed',
    ]);
  });

  it('B-26: below the pass-through threshold the price needs no formal approval', () => {
    const noApproval = { ...approved, price_approved_by: null, price_approved_at: null };
    expect(submit(noApproval).ok).toBe(false);
    expect(submit(noApproval, lead, { pass_through_eligible: true }).ok).toBe(true);
  });

  it('FB-21 (N17-19, N17-20): pending needs no note and never blocks, capital likely or not', () => {
    const pending = { ...approved, capital_readiness: 'pending' };
    expect(submit(pending, lead, { capital_likely: false }).ok).toBe(true);
    expect(submit(pending, lead, { capital_likely: true }).ok).toBe(true);
    // The note is optional and still accepted.
    expect(
      submit({ ...pending, capital_pending_justification: 'board Nov 10' }, lead, {
        capital_likely: true,
      }).ok,
    ).toBe(true);
    for (const readiness of ['pre_approved', 'not_required']) {
      expect(
        submit({ ...approved, capital_readiness: readiness }, lead, { capital_likely: true }).ok,
      ).toBe(true);
    }
  });

  it('FB-21 (N17-20): "not approved" refuses Advance with plain words; Stop is still open', () => {
    const notApproved = { ...approved, capital_readiness: 'not_approved' };
    const r = submit(notApproved, lead, { capital_likely: true });
    expect(missing(r)).toEqual(['capital_not_approved']);
    expect(!r.ok && r.errors[0]!.message).toBe(
      'Capital is marked not approved: stop the quote, or change capital readiness',
    );
    const stop = validCase(hybridConfig, 'G3', 'stop');
    expect(
      evaluateTransition(
        hybridConfig,
        makeQuote('QUOTING', { fields: { pricing_record: notApproved } }),
        lead,
        stop.request,
        NOW,
      ).ok,
    ).toBe(true);
  });

  it('only the pricing lead decides G3; Advance goes to FINAL_REVIEW and tells the Approvers', () => {
    const ok = submit(approved);
    expect(ok.ok && ok.effects.nextStageKey).toBe('FINAL_REVIEW');
    expect(ok.ok && ok.effects.notifications).toEqual([
      { type: 'quote.ready_for_final_review', recipient: { kind: 'role', role: 'Approver' } },
    ]);
    const pricer = submit(approved, pricing);
    expect(!pricer.ok && pricer.errors[0]!.code).toBe('NOT_PERMITTED');
    const eng = submit(approved, makeActor('EngLead'));
    expect(!eng.ok && eng.errors[0]!.code).toBe('NOT_PERMITTED');
  });

  it('Hold needs a reason + review date + owner; Rework a reason and bumps the version; Stop declines', () => {
    const run = (outcomeKey: string, extra: object = {}) =>
      evaluateTransition(
        hybridConfig,
        makeQuote('QUOTING'),
        lead,
        { gateKey: 'G3', outcomeKey, ...extra },
        NOW,
      );
    expect(
      !run('hold').ok && (run('hold') as { errors: { code: string }[] }).errors.map((e) => e.code),
    ).toEqual(['MISSING_FIELD', 'MISSING_FIELD', 'NOTE_REQUIRED', 'REASON_REQUIRED']);
    const hold = validCase(hybridConfig, 'G3', 'hold');
    expect(
      evaluateTransition(
        hybridConfig,
        makeQuote('QUOTING', { fields: hold.fields }),
        lead,
        hold.request,
        NOW,
      ).ok,
    ).toBe(true);

    // FB-01 (F-027): every rework needs a note.
    const rework = validCase(hybridConfig, 'G3', 'rework');
    expect(rework.request.note).toBeDefined();
    const r = evaluateTransition(hybridConfig, makeQuote('QUOTING'), lead, rework.request, NOW);
    expect(r.ok && [r.effects.nextStageKey, r.effects.nextVersion]).toEqual(['ENG_REVIEW', 2]);
    expect(run('rework').ok).toBe(false);

    // B-26: re-cost stays in Quoting (no version bump); Redirect keeps the quote in Quoting too.
    const recost = validCase(hybridConfig, 'G3', 'recost');
    const rc = evaluateTransition(hybridConfig, makeQuote('QUOTING'), lead, recost.request, NOW);
    expect(
      rc.ok && [rc.effects.nextStageKey, rc.effects.nextVersion, rc.effects.nextStatus],
    ).toEqual(['QUOTING', 1, 'active']);
    // FB-17 (W13-23): it is a send-back to Pricing now, so it needs a rework reason code as well.
    expect(run('redirect').ok).toBe(false);
    const noReason = run('redirect', { note: 'Customer-funded tooling' });
    expect(!noReason.ok && noReason.errors.map((e) => e.code)).toEqual(['REASON_REQUIRED']);
    const redirect = validCase(hybridConfig, 'G3', 'redirect');
    expect(redirect.request.note).toBe('because');
    expect(redirect.outcome.reasonContext).toBe('rework');
    expect(typeof redirect.request.reasonCode).toBe('string');
    const rd = evaluateTransition(hybridConfig, makeQuote('QUOTING'), lead, redirect.request, NOW);
    expect(
      rd.ok && [rd.effects.nextStageKey, rd.effects.nextVersion, rd.effects.nextStatus],
    ).toEqual(['QUOTING', 1, 'active']);

    const stop = validCase(hybridConfig, 'G3', 'stop');
    expect(stop.request.note).toBeDefined();
    const s = evaluateTransition(hybridConfig, makeQuote('QUOTING'), lead, stop.request, NOW);
    expect(s.ok && [s.effects.nextStageKey, s.effects.nextStatus, s.effects.closeAs]).toEqual([
      'DECLINED',
      'closed',
      'declined',
    ]);
  });

  it('segregation: whoever approved the price or submitted G3 cannot decide G4', () => {
    const approver = makeActor(['Pricing', 'Approver'], { userId: PRICER });
    const g4 = validCase(hybridConfig, 'G4', 'approve');
    const run = (ids: string[]) =>
      evaluateTransition(
        hybridConfig,
        makeQuote('FINAL_REVIEW', {
          fields: g4.fields,
          priceApproverIds: ids.map(asUserId),
        }),
        approver,
        g4.request,
        NOW,
      );
    const denied = run([PRICER]);
    expect(!denied.ok && denied.errors.map((e) => e.code)).toEqual(['SEGREGATION']);
    expect(run([PRICER_2]).ok).toBe(true);
    expect(run([]).ok).toBe(true);
  });
});

describe('B-26: Quoting assignment (the pricing lead triages)', () => {
  const quote = makeQuote('QUOTING');
  const pricer = { id: 'user-pricer', roles: ['Pricing'] as const, active: true };
  const plan = (
    actor = makeActor('PricingLead'),
    q = { ...quote, assignedPricerId: null as string | null },
    a: typeof pricer | undefined = pricer,
  ) => planPricerAssignment(actor, q, a ? { ...a, roles: [...a.roles] } : undefined);

  it('the pricing lead and Admin assign; Pricing and others cannot', () => {
    expect(plan()).toEqual({ ok: true, changed: true, from: null, to: 'user-pricer' });
    expect(plan(makeActor('Admin')).ok).toBe(true);
    for (const role of ['Pricing', 'EngLead', 'KAM', 'Approver'] as const) {
      const r = plan(makeActor(role));
      expect(!r.ok && r.errors.map((e) => e.code), role).toEqual(['NOT_PERMITTED']);
    }
  });

  it('only in Quoting, to an active Pricing / PricingLead user; the same pricer is a no-op', () => {
    const wrong = plan(makeActor('PricingLead'), {
      ...makeQuote('FINAL_REVIEW'),
      assignedPricerId: null,
    });
    expect(!wrong.ok && wrong.errors.map((e) => e.code)).toEqual(['WRONG_STAGE']);
    const engineer = plan(makeActor('PricingLead'), undefined, {
      ...pricer,
      roles: ['Engineer'] as never,
    });
    expect(!engineer.ok && engineer.errors.map((e) => e.field)).toEqual(['pricerId']);
    const inactive = plan(makeActor('PricingLead'), undefined, { ...pricer, active: false });
    expect(inactive.ok).toBe(false);
    expect(
      plan(makeActor('PricingLead'), { ...quote, assignedPricerId: 'user-pricer' }),
    ).toMatchObject({
      ok: true,
      changed: false,
      from: 'user-pricer',
    });
  });

  it('the queue filters by pricer, including unassigned', () => {
    const e = (n: string, assignedPricerId: string | null): PricingQueueEntry => ({
      quoteNumber: n,
      tier: null,
      score: null,
      activeMsInStage: 0,
      g2Outcome: null,
      capitalNeeded: false,
      capitalReadiness: null,
      priceApproved: false,
      productFamily: null,
      kamUserId: KAM_ID,
      assignedPricerId,
      searchText: '',
    });
    const all = [e('A', 'p1'), e('B', null), e('C', 'p2')];
    expect(filterPricingQueue(all, { pricerId: 'p1' }).map((x) => x.quoteNumber)).toEqual(['A']);
    expect(filterPricingQueue(all, { pricerId: 'unassigned' }).map((x) => x.quoteNumber)).toEqual([
      'B',
    ]);
  });
});

describe('FB-21 (N17-19): the capital readiness a quote starts on in Quoting', () => {
  const needed = (fields: Record<string, unknown>, above = 0) =>
    capitalNeededForReadiness(fields, above);

  it('$0 is not needed; above the threshold or blank is needed', () => {
    expect(needed({ prelim_capital_usd: 0 })).toBe(false);
    expect(needed({ prelim_capital_usd: '0.00' })).toBe(false);
    expect(needed({ prelim_capital_usd: 20_000 })).toBe(true);
    expect(needed({ prelim_capital_usd: null })).toBe(true);
    expect(needed({})).toBe(true);
    // The threshold is config (capital_needed_above_usd): at or below it is not needed.
    expect(needed({ prelim_capital_usd: 50_000 }, 50_000)).toBe(false);
    expect(needed({ prelim_capital_usd: 50_001 }, 50_000)).toBe(true);
  });

  it('multi-item: needed when any item is above the threshold or blank; not needed when all are $0', () => {
    expect(needed({ items: [{ prelim_capital_usd: 0 }, { prelim_capital_usd: 0 }] })).toBe(false);
    expect(needed({ items: [{ prelim_capital_usd: 0 }, { prelim_capital_usd: 5_000 }] })).toBe(
      true,
    );
    expect(needed({ items: [{ prelim_capital_usd: 0 }, { prelim_capital_usd: null }] })).toBe(true);
    // The items win over a quote-level figure.
    expect(needed({ prelim_capital_usd: 0, items: [{ prelim_capital_usd: 1 }] })).toBe(true);
  });

  it('the retired "Advance – capital required" outcome is needed whatever the figure', () => {
    expect(needed({ prelim_capital_usd: 0, g2_outcome: 'capital_required' })).toBe(true);
  });

  it('maps through capital_readiness_default (seed: pending / not required)', () => {
    expect(CAPITAL_READINESS_DEFAULT_SEED).toEqual({
      whenNeeded: 'pending',
      whenNotNeeded: 'not_required',
    });
    expect(defaultCapitalReadiness(true)).toBe('pending');
    expect(defaultCapitalReadiness(false)).toBe('not_required');
    const custom = { whenNeeded: 'pre_approved', whenNotNeeded: 'pending' } as const;
    expect(defaultCapitalReadiness(true, custom)).toBe('pre_approved');
    expect(defaultCapitalReadiness(false, custom)).toBe('pending');
  });

  it('the setting refuses "not required" when capital is needed, and anything malformed', () => {
    expect(parseCapitalReadinessDefault(null)).toEqual(CAPITAL_READINESS_DEFAULT_SEED);
    expect(parseCapitalReadinessDefault(CAPITAL_READINESS_DEFAULT_SEED)).toEqual(
      CAPITAL_READINESS_DEFAULT_SEED,
    );
    for (const bad of [
      { whenNeeded: 'not_required', whenNotNeeded: 'not_required' },
      { whenNeeded: 'pending' },
      { whenNeeded: 'pending', whenNotNeeded: 'maybe' },
      { whenNeeded: 'pending', whenNotNeeded: 'not_required', extra: 1 },
      'pending',
    ]) {
      expect(() => parseCapitalReadinessDefault(bad)).toThrow(/capital_readiness_default/);
    }
  });

  it('every status has help words; none asks for a justification', () => {
    for (const v of CAPITAL_READINESS_VALUES) {
      expect(CAPITAL_READINESS_HELP[v].length).toBeGreaterThan(0);
      expect(CAPITAL_READINESS_HELP[v]).not.toMatch(/justif/i);
    }
  });
});

describe('FB-21 (Ben, 2026-11-18): nothing after G3 blocks on pending capital', () => {
  it('no G4, G5 or G6 rule reads capital readiness', () => {
    const later = hybridConfig.outcomes.filter((o) => ['G4', 'G5', 'G6'].includes(o.gateKey));
    expect(later.length).toBeGreaterThan(0);
    for (const o of later) {
      const read = o.requiredFields.flatMap(fieldsReferenced);
      expect(read, `${o.gateKey} ${o.key}`).not.toContain('pricing_record.capital_readiness');
      expect(read, `${o.gateKey} ${o.key}`).not.toContain('capital_not_approved');
      expect(read, `${o.gateKey} ${o.key}`).not.toContain(
        'pricing_record.capital_pending_justification',
      );
    }
  });
});
