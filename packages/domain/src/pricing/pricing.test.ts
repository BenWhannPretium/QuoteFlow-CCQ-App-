import { describe, expect, it } from 'vitest';

import {
  NO_CAPITAL_READINESS,
  PRICING_QUEUE_STAGE_KEY,
  filterPricingQueue,
  planPricerAssignment,
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
    expect(codes({ capitalReadiness: 'not_approved' })).toEqual(['CAPITAL_NOT_APPROVED']);
    expect(codes({ costingCompleted: false })).toEqual(['COSTING_NOT_ATTESTED']);
    expect(codes({ erfRefs: [] })).toEqual([]);
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
});

describe('G3 (hybrid seed)', () => {
  const approved = {
    price_approved_by: PRICER,
    price_approved_at: NOW,
    costing_completed: true,
    capital_readiness: 'not_required',
  };
  const submit = (
    record: Record<string, unknown>,
    actor = pricing,
    fields: Record<string, unknown> = {},
  ) =>
    evaluateTransition(
      hybridConfig,
      makeQuote('QUOTING', { fields: { pricing_record: record, ...fields } }),
      actor,
      { gateKey: 'G3', outcomeKey: 'submit' },
      NOW,
    );
  const missing = (r: ReturnType<typeof submit>) =>
    r.ok ? [] : r.errors.map((e) => e.field ?? e.code);

  it('Advance needs the approval, the costing attestation and a capital status (B-26: no ERF / BPR)', () => {
    expect(missing(submit({}))).toEqual([
      'pricing_record.price_approved_by,pricing_record.price_approved_at,pass_through_eligible',
      'pricing_record.costing_completed',
      'pricing_record.capital_readiness',
      'pricing_record.capital_readiness,pricing_record.capital_pending_justification',
      'capital_likely,pricing_record.capital_readiness',
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
    expect(submit(noApproval, pricing, { pass_through_eligible: true }).ok).toBe(true);
  });

  it('B-26: a "capital likely" quote needs capital readiness confirmed, not pending', () => {
    const pending = {
      ...approved,
      capital_readiness: 'pending',
      capital_pending_justification: 'board Nov 10',
    };
    expect(submit(pending, pricing, { capital_likely: false }).ok).toBe(true);
    expect(missing(submit(pending, pricing, { capital_likely: true }))).toEqual([
      'capital_likely,pricing_record.capital_readiness',
    ]);
    expect(
      submit({ ...approved, capital_readiness: 'pre_approved' }, pricing, { capital_likely: true })
        .ok,
    ).toBe(true);
  });

  it('pending capital needs a justification (D-11: warned, not blocked)', () => {
    const base = { ...approved, capital_readiness: 'pending' };
    expect(missing(submit(base, pricing, { capital_likely: false }))).toEqual([
      'pricing_record.capital_readiness,pricing_record.capital_pending_justification',
    ]);
    expect(
      submit({ ...base, capital_pending_justification: 'board Nov 10' }, pricing, {
        capital_likely: false,
      }).ok,
    ).toBe(true);
    expect(
      submit({ ...base, capital_readiness: 'not_approved' }, pricing, { capital_likely: false }).ok,
    ).toBe(true);
  });

  it('only Pricing (and the pricing lead) decides G3; Advance goes to FINAL_REVIEW and tells the Approvers', () => {
    const ok = submit(approved);
    expect(ok.ok && ok.effects.nextStageKey).toBe('FINAL_REVIEW');
    expect(ok.ok && ok.effects.notifications).toEqual([
      { type: 'quote.ready_for_final_review', recipient: { kind: 'role', role: 'Approver' } },
    ]);
    expect(submit(approved, makeActor('PricingLead')).ok).toBe(true);
    const eng = submit(approved, makeActor('EngLead'));
    expect(!eng.ok && eng.errors[0]!.code).toBe('NOT_PERMITTED');
  });

  it('Hold needs a reason + review date + owner; Rework a reason and bumps the version; Stop declines', () => {
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
    ).toEqual(['MISSING_FIELD', 'MISSING_FIELD', 'REASON_REQUIRED']);
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

    // B-26: re-cost stays in Quoting (no version bump); Redirect keeps the quote in Quoting too.
    const recost = validCase(hybridConfig, 'G3', 'recost');
    const rc = evaluateTransition(hybridConfig, makeQuote('QUOTING'), pricing, recost.request, NOW);
    expect(
      rc.ok && [rc.effects.nextStageKey, rc.effects.nextVersion, rc.effects.nextStatus],
    ).toEqual(['QUOTING', 1, 'active']);
    expect(run('redirect').ok).toBe(false);
    expect(run('redirect', { note: 'Customer-funded tooling' }).ok).toBe(true);

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
