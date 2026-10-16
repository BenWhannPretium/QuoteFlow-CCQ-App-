import { describe, expect, it } from 'vitest';

import {
  NO_CAPITAL_READINESS,
  PRICING_QUEUE_STAGE_KEY,
  filterPricingQueue,
  sortPricingQueue,
  type PricingQueueEntry,
} from './queue';
import {
  CAPITAL_READINESS_LABELS,
  EMPTY_PRICING_RECORD,
  MAX_PRICING_REFS,
  PRICING_REF_FORMATS_SEED,
  canEditQuoting,
  carryForwardPricingRecord,
  parsePricingRefFormats,
  planCapitalReadiness,
  planPricingRecord,
  priceApprovalStatus,
  quotingWarnings,
  type PricingRecordValues,
} from './record';
import { redact } from '../policy/redact';
import { KAM_ID, NOW, OTHER_ID, makeActor, makeQuote, validCase } from '../test-utils';
import { asUserId } from '../types/ids';
import { evaluateTransition } from '../workflow/evaluate';
import { hybridConfig } from '../workflow/seeds/hybrid';

const PRICER = asUserId('user-pricer');
const PRICER_2 = asUserId('user-pricer-2');
const pricing = makeActor('Pricing', { userId: PRICER });
const quoting = makeQuote(PRICING_QUEUE_STAGE_KEY);
const ctx = {
  formats: PRICING_REF_FORMATS_SEED,
  pricingUserIds: new Set<string>([PRICER, PRICER_2]),
  now: NOW,
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
    expect(canEditQuoting(pricing, quoting)).toBe(true);
    expect(canEditQuoting(pricing, { ...quoting, status: 'on_hold' })).toBe(true);
    expect(canEditQuoting(pricing, { ...quoting, status: 'closed' })).toBe(false);
    expect(canEditQuoting(pricing, makeQuote('FINAL_REVIEW'))).toBe(false);
    for (const role of ['KAM', 'Engineer', 'EngLead', 'Approver', 'Leadership', 'Admin'] as const) {
      expect(canEditQuoting(makeActor(role), quoting), role).toBe(false);
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
      null,
    );
    expect(!cap.ok && cap.errors[0]!.code).toBe('NOT_PERMITTED');
  });
});

describe('price approval record', () => {
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
        erfRefs: ['26367', ' 26367', '31061'],
        bprRefs: ['bpr-10432'],
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
      erfRefs: ['26367', '31061'],
      bprRefs: ['BPR-10432'],
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
        'bprRefs',
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
      erfRefs: ['26367'],
      costingCompleted: true,
      costingAttestedBy: PRICER_2,
      costingAttestedAt: NOW,
    };
    const cleared = planPricingRecord(pricing, quoting, current, { approvedBy: null }, ctx);
    expect(cleared.ok && cleared.next).toMatchObject({
      priceApprovedBy: null,
      priceApprovedAt: null,
      erfRefs: ['26367'],
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
        bprRefs: ['nope'],
      },
      ctx,
    );
    expect(!plan.ok && plan.errors.map((e) => [e.code, e.field])).toEqual([
      ['INVALID_VALUE', 'approvedBy'],
      ['INVALID_VALUE', 'approvedAt'],
      ['INVALID_VALUE', 'erfRefs/0'],
      ['INVALID_VALUE', 'bprRefs/0'],
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
      { erfRefs: Array.from({ length: MAX_PRICING_REFS + 1 }, (_, i) => String(10000 + i)) },
      ctx,
    );
    expect(!many.ok && many.errors[0]!.field).toBe('erfRefs');
  });

  it('a new version starts from the references only (CR-38: approvals are recorded afresh)', () => {
    const prior: PricingRecordValues = {
      ...EMPTY_PRICING_RECORD,
      priceApprovedBy: PRICER,
      priceApprovedAt: NOW,
      erfRefs: ['26367'],
      bprRefs: ['BPR-1001'],
      cerReference: 'CER-9',
      capitalReadiness: 'pre_approved',
      approvedRangeNote: 'x',
    };
    expect(carryForwardPricingRecord(prior)).toEqual({
      ...EMPTY_PRICING_RECORD,
      erfRefs: ['26367'],
      bprRefs: ['BPR-1001'],
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
      'capital_required',
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
      'capital_required',
    );
    expect(approved.ok && approved.next).toMatchObject({
      capitalReadiness: 'pre_approved',
      cerReference: 'CER-123',
      capitalNotes: 'Apex in review',
      capitalPendingJustification: null,
    });
    expect(CAPITAL_READINESS_LABELS.pre_approved).toBe('Pre-approved');
  });

  it('cannot be "not required" after a G2 "Capital required", nor an unknown value', () => {
    const run = (value: string, g2: string | null) =>
      planCapitalReadiness(pricing, quoting, EMPTY_PRICING_RECORD, { capitalReadiness: value }, g2);
    expect(run('not_required', 'capital_required').ok).toBe(false);
    expect(run('not_required', 'proceed').ok).toBe(true);
    expect(run('not_required', null).ok).toBe(true);
    const bad = run('maybe', null);
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
    expect(redact(dto, makeActor('KAM'))).toEqual({ approval: dto.approval });
    expect(redact(dto, makeActor('Engineer'))).toEqual({ approval: dto.approval });
    expect(redact(dto, makeActor('Pricing'))).toEqual(dto);
  });

  it('warnings: pending capital, capital not approved, costing not attested, no pricing-app record', () => {
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
    expect(codes({ capitalReadiness: 'not_approved' })).toEqual(['CAPITAL_NOT_APPROVED']);
    expect(codes({ costingCompleted: false })).toEqual(['COSTING_NOT_ATTESTED']);
    expect(codes({ noPricingAppRecordNote: 'new item, no ERF yet' })).toEqual([
      'NO_PRICING_APP_RECORD',
    ]);
    expect(codes({ noPricingAppRecordNote: 'n', erfRefs: ['26367'] })).toEqual([]);
  });
});

describe('pricing queue', () => {
  const entry = (overrides: Partial<PricingQueueEntry>): PricingQueueEntry => ({
    quoteNumber: 'CCQ-2026-00001',
    tier: 'STANDARD',
    score: 50,
    activeMsInStage: 1000,
    g2Outcome: 'proceed',
    capitalReadiness: null,
    priceApproved: false,
    productFamily: 'BOTTLE',
    kamUserId: KAM_ID,
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
});

describe('G3 (hybrid seed)', () => {
  const approved = {
    price_approved_by: PRICER,
    price_approved_at: NOW,
    pricing_refs: { erf: [], bpr: [] },
    capital_readiness: 'not_required',
  };
  const submit = (record: Record<string, unknown>, actor = pricing) =>
    evaluateTransition(
      hybridConfig,
      makeQuote('QUOTING', { fields: { pricing_record: record } }),
      actor,
      { gateKey: 'G3', outcomeKey: 'submit' },
      NOW,
    );
  const missing = (r: ReturnType<typeof submit>) =>
    r.ok ? [] : r.errors.map((e) => e.field ?? e.code);

  it('Submit needs the approval, a reference or the "no record yet" note, and a capital status', () => {
    expect(missing(submit({}))).toEqual([
      'pricing_record.price_approved_by',
      'pricing_record.price_approved_at',
      'pricing_record.pricing_refs.erf,pricing_record.pricing_refs.bpr,pricing_record.no_pricing_app_record_note',
      'pricing_record.capital_readiness',
      'pricing_record.capital_readiness,pricing_record.capital_pending_justification',
    ]);
    expect(submit({ ...approved, pricing_refs: { erf: ['26367'], bpr: [] } }).ok).toBe(true);
    expect(submit({ ...approved, pricing_refs: { erf: [], bpr: ['BPR-1'] } }).ok).toBe(true);
    expect(submit({ ...approved, no_pricing_app_record_note: 'New item' }).ok).toBe(true);
  });

  it('pending capital needs a justification (D-11: warned, not blocked)', () => {
    const base = { ...approved, no_pricing_app_record_note: 'n', capital_readiness: 'pending' };
    expect(missing(submit(base))).toEqual([
      'pricing_record.capital_readiness,pricing_record.capital_pending_justification',
    ]);
    expect(submit({ ...base, capital_pending_justification: 'board Nov 10' }).ok).toBe(true);
    expect(submit({ ...base, capital_readiness: 'not_approved' }).ok).toBe(true);
  });

  it('only Pricing decides G3; Submit goes to FINAL_REVIEW and tells the Approvers', () => {
    const ok = submit({ ...approved, no_pricing_app_record_note: 'n' });
    expect(ok.ok && ok.effects.nextStageKey).toBe('FINAL_REVIEW');
    expect(ok.ok && ok.effects.notifications).toEqual([
      { type: 'quote.ready_for_final_review', recipient: { kind: 'role', role: 'Approver' } },
    ]);
    const eng = submit({ ...approved, no_pricing_app_record_note: 'n' }, makeActor('EngLead'));
    expect(!eng.ok && eng.errors[0]!.code).toBe('NOT_PERMITTED');
  });

  it('Hold needs a reason + review date; Rework a reason and bumps the version; Stop declines', () => {
    const run = (outcomeKey: string, extra: object = {}) =>
      evaluateTransition(
        hybridConfig,
        makeQuote('QUOTING'),
        pricing,
        { gateKey: 'G3', outcomeKey, ...extra },
        NOW,
      );
    expect(
      !run('hold').ok && (run('hold') as { errors: { code: string }[] }).errors.map((e) => e.code),
    ).toEqual(['MISSING_FIELD', 'REASON_REQUIRED']);
    const hold = validCase(hybridConfig, 'G3', 'hold');
    expect(
      evaluateTransition(
        hybridConfig,
        makeQuote('QUOTING', { fields: hold.fields }),
        pricing,
        hold.request,
        NOW,
      ).ok,
    ).toBe(true);

    const rework = validCase(hybridConfig, 'G3', 'rework');
    expect(rework.request.note).toBeUndefined();
    const r = evaluateTransition(hybridConfig, makeQuote('QUOTING'), pricing, rework.request, NOW);
    expect(r.ok && [r.effects.nextStageKey, r.effects.nextVersion]).toEqual(['ENG_REVIEW', 2]);
    expect(run('rework').ok).toBe(false);

    const stop = validCase(hybridConfig, 'G3', 'stop');
    expect(stop.request.note).toBeDefined();
    const s = evaluateTransition(hybridConfig, makeQuote('QUOTING'), pricing, stop.request, NOW);
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
