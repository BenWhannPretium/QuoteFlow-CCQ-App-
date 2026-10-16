import { describe, expect, it } from 'vitest';

import { KAM_ID, NOW, OTHER_ID, makeActor, makeQuote, validCase } from '../test-utils';
import { evaluateTransition } from './evaluate';
import type { TransitionRequest } from './evaluate';
import { buildHybridConfig, hybridConfig, prd5Config } from './seeds';
import { ROLES } from '../types/roles';
import type { Role } from '../types/roles';
import type { WorkflowConfig } from '../types/workflow-config';

/** Which roles may decide each gate (architecture §3.4), written by hand rather than read from the matrix. */
const ALLOWED: Record<string, Role[]> = {
  G1: ['SalesLeader'],
  SUBMIT: ['KAM', 'SalesLeader', 'Admin'],
  G2: ['EngLead'],
  G3: ['Pricing'],
  G4: ['Approver'],
  G5: ['SalesLeader'], // KAM only on their own quote: see "KAM records the outcome on own quote"
  P_INTAKE: ['KAM', 'SalesLeader', 'Admin'],
  P_ENG: ['EngLead'],
  P_QUOTE: ['Pricing'],
  P_FINAL: ['Approver'],
};

const PRESETS: [string, WorkflowConfig][] = [
  ['hybrid (G1 on)', hybridConfig],
  ['hybrid (G1 off)', buildHybridConfig({ g1Enabled: false })],
  ['prd5', prd5Config],
];

describe.each(PRESETS)('%s: every gate × outcome × role', (_name, config) => {
  for (const gate of config.gates) {
    for (const outcome of config.outcomes.filter((o) => o.gateKey === gate.key)) {
      describe(`${gate.key} / ${outcome.key}`, () => {
        const { request, fields, transition } = validCase(config, gate.key, outcome.key);
        const quote = makeQuote(gate.stageKey, { fields });

        for (const role of ROLES) {
          const allowed = gate.enabled && ALLOWED[gate.key]!.includes(role);
          it(`${role} ${allowed ? 'is allowed' : 'is denied'}`, () => {
            const result = evaluateTransition(config, quote, makeActor(role), request, NOW);
            if (allowed) {
              expect(result).toMatchObject({ ok: true });
              if (result.ok) {
                expect(result.effects.nextStageKey).toBe(
                  transition.targetStageKeys[0] ?? gate.stageKey,
                );
                expect(result.effects.nextStatus).toBe(transition.nextStatus);
              }
            } else {
              expect(result.ok).toBe(false);
              if (!result.ok) {
                const codes = result.errors.map((e) => e.code);
                expect(codes).toContain(gate.enabled ? 'NOT_PERMITTED' : 'GATE_DISABLED');
                // everything else about the request was valid, so permission is the only extra failure
                expect(codes.every((c) => c === 'NOT_PERMITTED' || c === 'GATE_DISABLED')).toBe(
                  true,
                );
              }
            }
          });
        }
      });
    }
  }
});

describe('hybrid: routing', () => {
  const run = (
    gateKey: string,
    outcomeKey: string,
    role: Role,
    extra: Partial<TransitionRequest> = {},
    overrides = {},
  ) => {
    const c = validCase(hybridConfig, gateKey, outcomeKey);
    const quote = makeQuote(c.gate.stageKey, { fields: c.fields, ...overrides });
    return evaluateTransition(
      hybridConfig,
      quote,
      makeActor(role),
      { ...c.request, ...extra },
      NOW,
    );
  };

  it.each([
    ['G1', 'advance', 'SalesLeader', 'ENG_REVIEW'],
    ['G1', 'redirect', 'SalesLeader', 'REDIRECTED'],
    ['G1', 'stop', 'SalesLeader', 'DECLINED'],
    ['G2', 'proceed', 'EngLead', 'QUOTING'],
    ['G2', 'proceed_with_risk', 'EngLead', 'QUOTING'],
    ['G2', 'capital_required', 'EngLead', 'QUOTING'],
    ['G3', 'submit', 'Pricing', 'FINAL_REVIEW'],
    ['G4', 'approve', 'Approver', 'CUSTOMER_DECISION'],
    ['G4', 'decline', 'Approver', 'DECLINED'],
    ['G5', 'awarded', 'SalesLeader', 'AWARDED'],
    ['G5', 'lost', 'SalesLeader', 'CLOSED_LOST'],
    ['G5', 'expired', 'SalesLeader', 'EXPIRED'],
  ])('%s/%s lands on %s', (gate, outcome, role, stage) => {
    const result = run(gate, outcome, role as Role);
    expect(result.ok && result.effects.nextStageKey).toBe(stage);
  });

  it('closing outcomes close the quote with a closeAs and a quote_closed event', () => {
    const result = run('G4', 'decline', 'Approver');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effects).toMatchObject({
      nextStatus: 'closed',
      closeAs: 'declined',
      versionBump: false,
    });
    expect(result.effects.activityEvents.map((e) => e.type)).toEqual([
      'gate_decided',
      'stage_changed',
      'quote_closed',
    ]);
  });

  it('non-closing outcomes carry no closeAs', () => {
    const result = run('G1', 'advance', 'SalesLeader');
    expect(result.ok && 'closeAs' in result.effects).toBe(false);
  });

  it('records stage history, the gate decision and evidence atomically-persistable', () => {
    const result = run('G2', 'proceed_with_risk', 'EngLead', { note: '  watch cavitation  ' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { effects } = result;
    expect(effects.stageHistory).toEqual({
      exit: { stageKey: 'ENG_REVIEW', exitedAt: NOW },
      enter: { stageKey: 'QUOTING', enteredAt: NOW },
    });
    expect(effects.gateDecisionRecord).toMatchObject({
      quoteId: 'quote-1',
      gateKey: 'G2',
      outcomeKey: 'proceed_with_risk',
      decidedBy: OTHER_ID,
      decidedAt: NOW,
      note: 'watch cavitation',
      reasonCode: null,
      targetStageKey: 'QUOTING',
      quoteVersion: 1,
      payload: null,
    });
    expect(effects.gateDecisionRecord.evidence).toMatchObject({
      stageKey: 'ENG_REVIEW',
      fields: { process_type: 'x', plant_code: 'x', capacity_evidence: [{}] },
    });
    expect(effects.notifications).toEqual([
      { type: 'quote.ready_for_quoting', recipient: { kind: 'role', role: 'Pricing' } },
    ]);
  });

  it('notifies the engineering lead on entry to Engineering Review (P0 alert)', () => {
    const result = run('G1', 'advance', 'SalesLeader');
    expect(result.ok && result.effects.notifications).toEqual([
      { type: 'quote.ready_for_eng_review', recipient: { kind: 'role', role: 'EngLead' } },
    ]);
  });

  it('resolves user recipients from the quote and the next stage owner', () => {
    const approve = run('G4', 'approve', 'Approver');
    expect(approve.ok && approve.effects.notifications).toEqual([
      { type: 'quote.approved_for_customer', recipient: { kind: 'user', userId: KAM_ID } },
    ]);
    const rework = run('G2', 'rework', 'EngLead');
    expect(rework.ok && rework.effects.notifications).toEqual([
      { type: 'quote.reworked', recipient: { kind: 'user', userId: KAM_ID } }, // INTAKE is owned by the KAM
    ]);
    const ret = run('G4', 'return', 'Approver', { targetStageKey: 'ENG_REVIEW' });
    expect(ret.ok && ret.effects.notifications).toEqual([
      { type: 'quote.returned', recipient: { kind: 'role', role: 'EngLead' } },
    ]);
  });

  it('skips relation recipients that are unset', () => {
    const config = structuredClone(hybridConfig);
    config.outcomes.find((o) => o.gateKey === 'G2' && o.key === 'hold')!.notify = [
      { type: 'quote.held', to: { relation: 'assignedEngineer' } },
      { type: 'quote.held', to: { stageOwner: true } }, // ENG_REVIEW owner = EngLead
    ];
    const c = validCase(config, 'G2', 'hold');
    const unassigned = evaluateTransition(
      config,
      makeQuote('ENG_REVIEW', { fields: c.fields }),
      makeActor('EngLead'),
      c.request,
      NOW,
    );
    expect(unassigned.ok && unassigned.effects.notifications).toEqual([
      { type: 'quote.held', recipient: { kind: 'role', role: 'EngLead' } },
    ]);
    const assigned = evaluateTransition(
      config,
      makeQuote('ENG_REVIEW', { fields: c.fields, assignedEngineerId: OTHER_ID }),
      makeActor('EngLead'),
      c.request,
      NOW,
    );
    expect(assigned.ok && assigned.effects.notifications[0]).toEqual({
      type: 'quote.held',
      recipient: { kind: 'user', userId: OTHER_ID },
    });
  });

  it('stageOwner with an ownerless stage yields no notification', () => {
    const config = structuredClone(hybridConfig);
    config.outcomes.find((o) => o.gateKey === 'G5' && o.key === 'awarded')!.notify = [
      { type: 'x', to: { stageOwner: true } },
    ];
    const c = validCase(config, 'G5', 'awarded');
    const result = evaluateTransition(
      config,
      makeQuote('CUSTOMER_DECISION'),
      makeActor('SalesLeader'),
      c.request,
      NOW,
    );
    expect(result.ok && result.effects.notifications).toEqual([]);
  });
});

describe('return / rework / requote', () => {
  const eval1 = (gateKey: string, outcomeKey: string, role: Role, extra = {}) => {
    const c = validCase(hybridConfig, gateKey, outcomeKey);
    const quote = makeQuote(c.gate.stageKey, { fields: c.fields, version: 3 });
    return evaluateTransition(
      hybridConfig,
      quote,
      makeActor(role),
      { ...c.request, ...extra },
      NOW,
    );
  };

  it.each([
    ['G1', 'rework', 'SalesLeader', undefined, 'INTAKE'],
    ['G2', 'rework', 'EngLead', undefined, 'INTAKE'],
    ['G3', 'rework', 'Pricing', undefined, 'ENG_REVIEW'],
    ['G4', 'return', 'Approver', 'QUOTING', 'QUOTING'],
    ['G4', 'return', 'Approver', 'ENG_REVIEW', 'ENG_REVIEW'],
    ['G5', 'requote', 'SalesLeader', 'QUOTING', 'QUOTING'],
    ['G5', 'requote', 'SalesLeader', 'ENG_REVIEW', 'ENG_REVIEW'],
  ])('%s/%s → bumps version and lands on %s', (gate, outcome, role, chosen, landing) => {
    const result = eval1(gate, outcome, role as Role, chosen ? { targetStageKey: chosen } : {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effects).toMatchObject({
      nextStageKey: landing,
      versionBump: true,
      nextVersion: 4,
      nextStatus: 'active',
    });
    expect(result.effects.stageHistory.enter?.stageKey).toBe(landing);
    expect(result.effects.activityEvents.map((e) => e.type)).toContain('version_bumped');
    // the prior decision is recorded against the version it was taken on, never rewritten
    expect(result.effects.gateDecisionRecord.quoteVersion).toBe(3);
  });

  it('prior decisions are never mutated: the engine does not touch a frozen quote', () => {
    const c = validCase(hybridConfig, 'G4', 'return');
    const quote = Object.freeze(
      makeQuote('FINAL_REVIEW', {
        fields: Object.freeze({ ...c.fields }),
        holds: Object.freeze([]),
      }),
    );
    expect(() =>
      evaluateTransition(hybridConfig, quote, makeActor('Approver'), c.request, NOW),
    ).not.toThrow();
  });

  it('requires a choice when several targets exist', () => {
    const result = eval1('G4', 'return', 'Approver', { targetStageKey: undefined });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.map((e) => e.code)).toEqual(['TARGET_REQUIRED']);
  });

  it('rejects a target outside the configured set', () => {
    const result = eval1('G4', 'return', 'Approver', { targetStageKey: 'INTAKE' });
    expect(!result.ok && result.errors.map((e) => e.code)).toEqual(['INVALID_TARGET']);
  });

  it('rejects a target choice on a fixed-target or stay-in-stage outcome', () => {
    expect(!eval1('G1', 'advance', 'SalesLeader', { targetStageKey: 'QUOTING' }).ok).toBe(true);
    const hold = eval1('G1', 'hold', 'SalesLeader', { targetStageKey: 'QUOTING' });
    expect(!hold.ok && hold.errors.map((e) => e.code)).toEqual(['INVALID_TARGET']);
    // restating the one valid target is harmless
    expect(eval1('G1', 'advance', 'SalesLeader', { targetStageKey: 'ENG_REVIEW' }).ok).toBe(true);
  });
});

describe('validation: all errors, in order', () => {
  it('returns every failure at once', () => {
    // An Engineer tries G4 decline on a quote still in QUOTING, with nothing filled in.
    const result = evaluateTransition(
      hybridConfig,
      makeQuote('QUOTING'),
      makeActor('Engineer'),
      { gateKey: 'G4', outcomeKey: 'decline' },
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.code)).toEqual([
      'WRONG_STAGE',
      'NOT_PERMITTED',
      'NOTE_REQUIRED',
      'REASON_REQUIRED',
    ]);
  });

  it('reports missing required fields, all of them', () => {
    const result = evaluateTransition(
      hybridConfig,
      makeQuote('ENG_REVIEW'),
      makeActor('EngLead'),
      { gateKey: 'G2', outcomeKey: 'proceed' },
      NOW,
    );
    expect(!result.ok && result.errors.map((e) => [e.code, e.field])).toEqual([
      ['MISSING_FIELD', 'process_type'],
      ['MISSING_FIELD', 'machine_type'],
      ['MISSING_FIELD', 'plant_code'],
      ['MISSING_FIELD', 'cavitation'],
      ['MISSING_FIELD', 'cycle_time_s'],
      ['MISSING_FIELD', 'capacity_evidence'],
    ]);
  });

  it('G2 "Capital required" needs only the preliminary capital figure (B-10)', () => {
    const run = (fields: Record<string, unknown>) =>
      evaluateTransition(
        hybridConfig,
        makeQuote('ENG_REVIEW', { fields }),
        makeActor('EngLead'),
        { gateKey: 'G2', outcomeKey: 'capital_required' },
        NOW,
      );
    const missing = run({});
    expect(!missing.ok && missing.errors.map((e) => [e.code, e.field])).toEqual([
      ['MISSING_FIELD', 'prelim_capital_usd'],
    ]);
    const ok = run({ prelim_capital_usd: 250_000 });
    expect(ok.ok && ok.effects.nextStageKey).toBe('QUOTING');
  });

  it('G2 Stop closes as DECLINED; Hold needs a reason and a review date (B-10)', () => {
    const stop = evaluateTransition(
      hybridConfig,
      makeQuote('ENG_REVIEW'),
      makeActor('EngLead'),
      { gateKey: 'G2', outcomeKey: 'stop', reasonCode: 'not_strategic', note: 'No line fits' },
      NOW,
    );
    expect(stop.ok && [stop.effects.nextStageKey, stop.effects.closeAs]).toEqual([
      'DECLINED',
      'declined',
    ]);
    const hold = evaluateTransition(
      hybridConfig,
      makeQuote('ENG_REVIEW'),
      makeActor('EngLead'),
      { gateKey: 'G2', outcomeKey: 'hold' },
      NOW,
    );
    expect(!hold.ok && hold.errors.map((e) => e.code).sort()).toEqual([
      'MISSING_FIELD',
      'REASON_REQUIRED',
    ]);
  });

  it('capacity evidence is required for G2 proceed (CR-19)', () => {
    const c = validCase(hybridConfig, 'G2', 'proceed');
    const quote = makeQuote('ENG_REVIEW', { fields: { ...c.fields, capacity_evidence: [] } });
    const result = evaluateTransition(hybridConfig, quote, makeActor('EngLead'), c.request, NOW);
    expect(!result.ok && result.errors).toMatchObject([
      { code: 'MISSING_FIELD', field: 'capacity_evidence' },
    ]);
  });

  it('anyOf: intake needs volume OR revenue', () => {
    const c = validCase(hybridConfig, 'G1', 'advance');
    const without = { ...c.fields } as Record<string, unknown>;
    delete without.est_annual_volume;
    const none = evaluateTransition(
      hybridConfig,
      makeQuote('INTAKE', { fields: without }),
      makeActor('SalesLeader'),
      c.request,
      NOW,
    );
    expect(!none.ok && none.errors).toMatchObject([
      { code: 'MISSING_FIELD', field: 'est_annual_volume,est_annual_revenue' },
    ]);
    const revenue = evaluateTransition(
      hybridConfig,
      makeQuote('INTAKE', { fields: { ...without, est_annual_revenue: 1 } }),
      makeActor('SalesLeader'),
      c.request,
      NOW,
    );
    expect(revenue.ok).toBe(true);
  });

  it('payload values count toward required fields (G5 on hold needs a review date)', () => {
    const c = validCase(hybridConfig, 'G5', 'on_hold');
    const quote = makeQuote('CUSTOMER_DECISION');
    const missing = evaluateTransition(
      hybridConfig,
      quote,
      makeActor('SalesLeader'),
      { gateKey: 'G5', outcomeKey: 'on_hold' },
      NOW,
    );
    expect(!missing.ok && missing.errors).toMatchObject([
      { code: 'MISSING_FIELD', field: 'review_date' },
    ]);
    const ok = evaluateTransition(
      hybridConfig,
      quote,
      makeActor('SalesLeader'),
      { ...c.request, payload: { review_date: '2026-11-30' } },
      NOW,
    );
    expect(ok.ok).toBe(true);
    expect(ok.ok && ok.effects.gateDecisionRecord).toMatchObject({
      payload: { review_date: '2026-11-30' },
      evidence: { fields: { review_date: '2026-11-30' } },
    });
  });

  it('note must be non-blank', () => {
    const c = validCase(hybridConfig, 'G2', 'proceed_with_risk');
    const result = evaluateTransition(
      hybridConfig,
      makeQuote('ENG_REVIEW', { fields: c.fields }),
      makeActor('EngLead'),
      { ...c.request, note: '   ' },
      NOW,
    );
    expect(!result.ok && result.errors.map((e) => e.code)).toEqual(['NOTE_REQUIRED']);
  });

  it('reason code: required, and valid for the context', () => {
    const c = validCase(hybridConfig, 'G5', 'lost');
    const quote = makeQuote('CUSTOMER_DECISION');
    const run = (reasonCode?: string) =>
      evaluateTransition(
        hybridConfig,
        quote,
        makeActor('SalesLeader'),
        { gateKey: 'G5', outcomeKey: 'lost', ...(reasonCode === undefined ? {} : { reasonCode }) },
        NOW,
      );
    expect(c.request.reasonCode).toBe('price');
    const missing = run();
    expect(!missing.ok && missing.errors.map((e) => e.code)).toEqual(['REASON_REQUIRED']);
    expect(run('price').ok).toBe(true);
    const wrongContext = run('margin_below_floor'); // a decline code, not a lost code
    expect(!wrongContext.ok && wrongContext.errors.map((e) => e.code)).toEqual(['INVALID_REASON']);
    expect(!run('nonsense').ok).toBe(true);
  });

  it('a reason code flagged requiresNote needs a note (Lost / Other)', () => {
    const run = (note?: string) =>
      evaluateTransition(
        hybridConfig,
        makeQuote('CUSTOMER_DECISION'),
        makeActor('SalesLeader'),
        { gateKey: 'G5', outcomeKey: 'lost', reasonCode: 'other', ...(note ? { note } : {}) },
        NOW,
      );
    const missing = run();
    expect(!missing.ok && missing.errors.map((e) => e.code)).toEqual(['NOTE_REQUIRED']);
    expect(run('Customer moved the program in-house').ok).toBe(true);
  });

  it('inactive reason codes are invalid', () => {
    const config = structuredClone(hybridConfig);
    config.reasonCodes.find((r) => r.context === 'lost' && r.code === 'price')!.active = false;
    const result = evaluateTransition(
      config,
      makeQuote('CUSTOMER_DECISION'),
      makeActor('SalesLeader'),
      { gateKey: 'G5', outcomeKey: 'lost', reasonCode: 'price' },
      NOW,
    );
    expect(!result.ok && result.errors.map((e) => e.code)).toEqual(['INVALID_REASON']);
  });

  it('a reason code on an outcome with no reason context is invalid', () => {
    const result = evaluateTransition(
      hybridConfig,
      makeQuote('FINAL_REVIEW'),
      makeActor('Approver'),
      { gateKey: 'G4', outcomeKey: 'approve', reasonCode: 'price' },
      NOW,
    );
    expect(!result.ok && result.errors[0]).toMatchObject({ code: 'INVALID_REASON' });
  });

  it('rejects unknown gates and outcomes', () => {
    const quote = makeQuote('INTAKE');
    const gate = evaluateTransition(
      hybridConfig,
      quote,
      makeActor('Admin'),
      { gateKey: 'G9', outcomeKey: 'x' },
      NOW,
    );
    expect(!gate.ok && gate.errors.map((e) => e.code)).toEqual(['UNKNOWN_GATE']);
    const outcome = evaluateTransition(
      hybridConfig,
      quote,
      makeActor('Admin'),
      { gateKey: 'G1', outcomeKey: 'nope' },
      NOW,
    );
    expect(!outcome.ok && outcome.errors.map((e) => e.code)).toEqual(['UNKNOWN_OUTCOME']);
    // an outcome that exists on a different gate is still unknown for this one
    const crossed = evaluateTransition(
      hybridConfig,
      quote,
      makeActor('Admin'),
      { gateKey: 'G1', outcomeKey: 'approve' },
      NOW,
    );
    expect(!crossed.ok && crossed.errors.map((e) => e.code)).toEqual(['UNKNOWN_OUTCOME']);
  });

  it('closed quotes accept no decisions', () => {
    const c = validCase(hybridConfig, 'G5', 'awarded');
    const result = evaluateTransition(
      hybridConfig,
      makeQuote('CUSTOMER_DECISION', { status: 'closed' }),
      makeActor('SalesLeader'),
      c.request,
      NOW,
    );
    expect(!result.ok && result.errors.map((e) => e.code)).toEqual(['QUOTE_CLOSED']);
  });

  it('gate-level required fields apply to every outcome of the gate', () => {
    const config = structuredClone(hybridConfig);
    config.gates.find((g) => g.key === 'G4')!.requiredFields = [
      { field: 'legal_signoff', op: 'present' },
    ];
    const result = evaluateTransition(
      config,
      makeQuote('FINAL_REVIEW'),
      makeActor('Approver'),
      { gateKey: 'G4', outcomeKey: 'approve' },
      NOW,
    );
    expect(!result.ok && result.errors).toMatchObject([
      { code: 'MISSING_FIELD', field: 'legal_signoff' },
    ]);
  });
});

describe('segregation of duties', () => {
  it('a KAM who is also an Approver cannot approve their own quote', () => {
    const c = validCase(hybridConfig, 'G4', 'approve');
    const actor = makeActor(['KAM', 'Approver'], { userId: KAM_ID });
    const own = evaluateTransition(
      hybridConfig,
      makeQuote('FINAL_REVIEW', { fields: c.fields }),
      actor,
      c.request,
      NOW,
    );
    expect(own.ok).toBe(false);
    expect(!own.ok && own.errors.map((e) => e.code)).toEqual(['SEGREGATION']);
    expect(!own.ok && own.errors[0]!.message).toContain('KAM');
    // …but can approve someone else's
    const other = evaluateTransition(
      hybridConfig,
      makeQuote('FINAL_REVIEW', { fields: c.fields, kamUserId: OTHER_ID }),
      actor,
      c.request,
      NOW,
    );
    expect(other.ok).toBe(true);
  });

  it('applies to every outcome of the gate, including decline and return', () => {
    const actor = makeActor('Approver', { userId: KAM_ID });
    for (const outcomeKey of ['approve', 'decline', 'return']) {
      const c = validCase(hybridConfig, 'G4', outcomeKey);
      const result = evaluateTransition(
        hybridConfig,
        makeQuote('FINAL_REVIEW', { fields: c.fields }),
        actor,
        c.request,
        NOW,
      );
      expect(!result.ok && result.errors.map((e) => e.code), outcomeKey).toEqual(['SEGREGATION']);
    }
  });

  it('a KAM-SalesLeader cannot qualify their own opportunity at G1', () => {
    const c = validCase(hybridConfig, 'G1', 'advance');
    const result = evaluateTransition(
      hybridConfig,
      makeQuote('INTAKE', { fields: c.fields }),
      makeActor('SalesLeader', { userId: KAM_ID }),
      c.request,
      NOW,
    );
    expect(!result.ok && result.errors.map((e) => e.code)).toEqual(['SEGREGATION']);
  });

  it('outcome-scoped and assigned-engineer rules come from config', () => {
    const config = structuredClone(hybridConfig);
    config.segregation = [
      {
        id: 'eng-no-self-proceed',
        gateKeys: ['G2'],
        outcomeKeys: ['proceed'],
        deny: 'actor_is_assigned_engineer',
        message: 'No self review',
        provisional: true,
      },
    ];
    const run = (outcomeKey: string) => {
      const c = validCase(config, 'G2', outcomeKey);
      return evaluateTransition(
        config,
        makeQuote('ENG_REVIEW', { fields: c.fields, assignedEngineerId: OTHER_ID }),
        makeActor('EngLead'),
        c.request,
        NOW,
      );
    };
    expect(!run('proceed').ok).toBe(true);
    expect(run('proceed_with_risk').ok).toBe(true); // rule only covers `proceed`
  });

  it('KAM records the outcome on their own quote (G5), not on another KAM’s', () => {
    const c = validCase(hybridConfig, 'G5', 'awarded');
    const kam = makeActor('KAM', { userId: KAM_ID });
    expect(
      evaluateTransition(hybridConfig, makeQuote('CUSTOMER_DECISION'), kam, c.request, NOW).ok,
    ).toBe(true);
    const stranger = evaluateTransition(
      hybridConfig,
      makeQuote('CUSTOMER_DECISION', { kamUserId: OTHER_ID }),
      kam,
      c.request,
      NOW,
    );
    expect(!stranger.ok && stranger.errors.map((e) => e.code)).toEqual(['NOT_PERMITTED']);
  });

  it('data scope is enforced on the decider check', () => {
    const c = validCase(hybridConfig, 'G2', 'proceed');
    const quote = makeQuote('ENG_REVIEW', { fields: c.fields, region: 'EU' });
    const scoped = makeActor('EngLead', { scope: { type: 'region', values: ['NA'] } });
    const result = evaluateTransition(hybridConfig, quote, scoped, c.request, NOW);
    expect(!result.ok && result.errors.map((e) => e.code)).toEqual(['NOT_PERMITTED']);
  });
});

describe('hold accounting', () => {
  const hold = (
    stage: string,
    outcome: string,
    role: Role,
    status: 'active' | 'on_hold',
    extra = {},
  ) => {
    const c = validCase(hybridConfig, stage, outcome);
    const quote = makeQuote(c.gate.stageKey, { fields: c.fields, status });
    return evaluateTransition(
      hybridConfig,
      quote,
      makeActor(role),
      { ...c.request, ...extra },
      NOW,
    );
  };

  it('entering on_hold starts a hold interval and keeps the quote in its stage', () => {
    const result = hold('G2', 'hold', 'EngLead', 'active', {
      reasonCode: 'awaiting_customer_info',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effects).toMatchObject({
      nextStageKey: 'ENG_REVIEW',
      nextStatus: 'on_hold',
      hold: { action: 'start', at: NOW },
    });
    expect(result.effects.stageHistory).toEqual({ exit: null, enter: null });
    expect(result.effects.activityEvents.map((e) => e.type)).toEqual([
      'gate_decided',
      'hold_started',
    ]);
  });

  it('a decision from on_hold that resumes work closes the interval', () => {
    const result = hold('G2', 'proceed', 'EngLead', 'on_hold');
    expect(result.ok && result.effects.hold).toEqual({ action: 'end', at: NOW });
    expect(result.ok && result.effects.activityEvents.map((e) => e.type)).toContain('hold_ended');
  });

  it('closing from on_hold also closes the interval', () => {
    const result = hold('G2', 'stop', 'EngLead', 'on_hold');
    expect(result.ok && result.effects.hold.action).toBe('end');
    expect(result.ok && result.effects.nextStatus).toBe('closed');
  });

  it('holding an already-held quote opens no second interval', () => {
    const result = hold('G2', 'hold', 'EngLead', 'on_hold');
    expect(result.ok && result.effects.hold.action).toBe('none');
  });

  it('ordinary transitions leave holds alone', () => {
    const result = hold('G2', 'proceed', 'EngLead', 'active');
    expect(result.ok && result.effects.hold.action).toBe('none');
  });
});

describe('G1 can be disabled (g1Enabled=false)', () => {
  const off = buildHybridConfig({ g1Enabled: false });

  it('submit goes straight to ENG_REVIEW', () => {
    const c = validCase(off, 'SUBMIT', 'submit');
    const result = evaluateTransition(
      off,
      makeQuote('INTAKE', { fields: c.fields }),
      makeActor('KAM'),
      c.request,
      NOW,
    );
    expect(result.ok && result.effects.nextStageKey).toBe('ENG_REVIEW');
    expect(result.ok && result.effects.notifications).toEqual([
      { type: 'quote.ready_for_eng_review', recipient: { kind: 'role', role: 'EngLead' } },
    ]);
  });

  it('G1 is then unusable, and SUBMIT is unusable when G1 is on', () => {
    const g1 = validCase(off, 'G1', 'advance');
    const blocked = evaluateTransition(
      off,
      makeQuote('INTAKE', { fields: g1.fields }),
      makeActor('SalesLeader'),
      g1.request,
      NOW,
    );
    expect(!blocked.ok && blocked.errors.map((e) => e.code)).toEqual(['GATE_DISABLED']);
    const s = validCase(hybridConfig, 'SUBMIT', 'submit');
    const on = evaluateTransition(
      hybridConfig,
      makeQuote('INTAKE', { fields: s.fields }),
      makeActor('KAM'),
      s.request,
      NOW,
    );
    expect(!on.ok && on.errors.map((e) => e.code)).toEqual(['GATE_DISABLED']);
  });

  it('default options mean G1 on', () => {
    expect(buildHybridConfig().gates.find((g) => g.key === 'G1')!.enabled).toBe(true);
  });
});
