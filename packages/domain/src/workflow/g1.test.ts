import { describe, expect, it } from 'vitest';

import { availableActions } from './available-actions';
import { evaluateTransition } from './evaluate';
import { buildHybridConfig, hybridConfig } from './seeds';
import { KAM_ID, NOW, makeActor, makeQuote } from '../test-utils';

/** B-08: the G1 Qualify & prioritize outcomes and their constraints (hybrid seed, provisional). */
const leader = makeActor('SalesLeader');
const intake = makeQuote('INTAKE', {
  fields: {
    sf_opportunity_id: '006x',
    customer_id: 'c1',
    product_family: 'BOTTLE',
    resin: 'HDPE',
    est_annual_volume: 500_000,
    submitted_at: '2026-10-19T10:00:00Z',
  },
});
const decide = (request: Parameters<typeof evaluateTransition>[3]) =>
  evaluateTransition(hybridConfig, intake, leader, request, NOW);
const codes = (r: ReturnType<typeof decide>) => (r.ok ? [] : r.errors.map((e) => e.code));

describe('G1 outcomes', () => {
  it('offers exactly Advance, Hold, Rework, Redirect and Stop to a SalesLeader', () => {
    expect(availableActions(hybridConfig, intake, leader).map((a) => a.outcomeKey)).toEqual([
      'advance',
      'hold',
      'rework',
      'redirect',
      'stop',
    ]);
  });

  it('nobody else may decide G1, and a SalesLeader may not qualify their own opportunity', () => {
    for (const role of [
      'KAM',
      'EngLead',
      'Engineer',
      'Pricing',
      'Approver',
      'Leadership',
      'Admin',
    ] as const) {
      expect(availableActions(hybridConfig, intake, makeActor(role))).toEqual([]);
    }
    const ownLeader = makeActor('SalesLeader', { userId: KAM_ID });
    expect(
      codes(
        evaluateTransition(
          hybridConfig,
          intake,
          ownLeader,
          { gateKey: 'G1', outcomeKey: 'advance' },
          NOW,
        ),
      ),
    ).toEqual(['SEGREGATION']);
  });

  it('a quote returned for rework (not resubmitted) cannot be decided', () => {
    const returned = makeQuote('INTAKE', { fields: { ...intake.fields, submitted_at: null } });
    const r = evaluateTransition(
      hybridConfig,
      returned,
      leader,
      { gateKey: 'G1', outcomeKey: 'advance' },
      NOW,
    );
    expect(r.ok ? [] : r.errors.map((e) => e.field)).toEqual(['submitted_at']);
  });

  it('Advance: note optional, lands in ENG_REVIEW', () => {
    const r = decide({ gateKey: 'G1', outcomeKey: 'advance' });
    expect(r.ok && r.effects.nextStageKey).toBe('ENG_REVIEW');
  });

  it('Hold: needs a reason and a review date, stays in INTAKE on hold', () => {
    expect(codes(decide({ gateKey: 'G1', outcomeKey: 'hold' }))).toEqual([
      'MISSING_FIELD',
      'REASON_REQUIRED',
    ]);
    const r = decide({
      gateKey: 'G1',
      outcomeKey: 'hold',
      reasonCode: 'awaiting_customer_info',
      payload: { review_date: '2026-11-02' },
    });
    expect(r.ok && [r.effects.nextStageKey, r.effects.nextStatus, r.effects.hold.action]).toEqual([
      'INTAKE',
      'on_hold',
      'start',
    ]);
  });

  it('Rework: needs a reason and a note, back to INTAKE with a version bump', () => {
    expect(codes(decide({ gateKey: 'G1', outcomeKey: 'rework' }))).toEqual([
      'NOTE_REQUIRED',
      'REASON_REQUIRED',
    ]);
    const r = decide({
      gateKey: 'G1',
      outcomeKey: 'rework',
      reasonCode: 'missing_information',
      note: 'Add the drawing',
    });
    expect(r.ok && [r.effects.nextStageKey, r.effects.nextVersion]).toEqual(['INTAKE', 2]);
  });

  it('Redirect: needs a reason, closes as REDIRECTED', () => {
    expect(codes(decide({ gateKey: 'G1', outcomeKey: 'redirect' }))).toEqual(['REASON_REQUIRED']);
    const r = decide({ gateKey: 'G1', outcomeKey: 'redirect', reasonCode: 'stock_item' });
    expect(r.ok && [r.effects.nextStageKey, r.effects.nextStatus, r.effects.closeAs]).toEqual([
      'REDIRECTED',
      'closed',
      'redirected',
    ]);
  });

  it('Stop: needs a reason code and a note, closes as DECLINED', () => {
    expect(codes(decide({ gateKey: 'G1', outcomeKey: 'stop' }))).toEqual([
      'NOTE_REQUIRED',
      'REASON_REQUIRED',
    ]);
    const r = decide({
      gateKey: 'G1',
      outcomeKey: 'stop',
      reasonCode: 'not_strategic',
      note: 'Outside where to play',
    });
    expect(r.ok && [r.effects.nextStageKey, r.effects.closeAs]).toEqual(['DECLINED', 'declined']);
  });

  it('with g1_enabled=false the gate is off and the KAM submit goes to ENG_REVIEW', () => {
    const off = buildHybridConfig({ g1Enabled: false });
    expect(availableActions(off, intake, leader).map((a) => a.gateKey)).toEqual(['SUBMIT']);
    expect(
      codes(evaluateTransition(off, intake, leader, { gateKey: 'G1', outcomeKey: 'advance' }, NOW)),
    ).toContain('GATE_DISABLED');
  });
});
