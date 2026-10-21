import { describe, expect, it } from 'vitest';

import { buildHybridConfig, hybridConfig, prd5Config, SEED_REASON_CODES } from '.';
import type { WorkflowConfig } from '../../types/workflow-config';

const everyItem = (config: WorkflowConfig) => [
  ...config.stages,
  ...config.gates,
  ...config.outcomes,
  ...config.transitions,
  ...config.reasonCodes,
  ...config.segregation,
];

describe.each([
  ['hybrid', hybridConfig],
  ['hybrid (G1 off)', buildHybridConfig({ g1Enabled: false })],
  ['prd5', prd5Config],
])('%s seed', (_name, config) => {
  it('marks every item provisional until the owner approves it', () => {
    for (const item of everyItem(config)) expect(item.provisional, JSON.stringify(item)).toBe(true);
  });
});

describe('hybrid seed matches architecture §4.1', () => {
  it('has the twelve stages (B-26: six active, Commit & Hand Off last), six of them terminal', () => {
    expect(hybridConfig.stages.map((s) => s.key)).toEqual([
      'INTAKE',
      'ENG_REVIEW',
      'QUOTING',
      'FINAL_REVIEW',
      'CUSTOMER_DECISION',
      'COMMIT_HANDOFF',
      'AWARDED',
      'CLOSED_LOST',
      'DECLINED',
      'EXPIRED',
      'REDIRECTED',
      'NOT_AUTHORIZED',
    ]);
    expect(hybridConfig.stages.filter((s) => s.terminal).map((s) => s.key)).toEqual([
      'AWARDED',
      'CLOSED_LOST',
      'DECLINED',
      'EXPIRED',
      'REDIRECTED',
      'NOT_AUTHORIZED',
    ]);
  });

  it('has gates G1–G6 with the right deciders', () => {
    const decider = (key: string) =>
      hybridConfig.gates.find((g) => g.key === key)?.deciderPermission;
    expect(decider('G1')).toBe('gate.G1.decide');
    expect(decider('G2')).toBe('gate.G2.decide');
    expect(decider('G3')).toBe('gate.G3.submit');
    expect(decider('G4')).toBe('gate.G4.decide');
    expect(decider('G5')).toBe('outcome.record');
    expect(decider('G6')).toBe('gate.G6.decide');
  });

  it('has the documented outcomes per gate', () => {
    const outcomes = (gate: string) =>
      hybridConfig.outcomes.filter((o) => o.gateKey === gate).map((o) => o.key);
    expect(outcomes('G1')).toEqual(['advance', 'hold', 'rework', 'redirect', 'stop']);
    expect(outcomes('G2')).toEqual([
      'proceed',
      'proceed_with_risk',
      'capital_required',
      'hold',
      'rework',
      'redirect',
      'stop',
    ]);
    expect(outcomes('G3')).toEqual(['submit', 'hold', 'recost', 'rework', 'redirect', 'stop']);
    expect(outcomes('G4')).toEqual(['approve', 'hold', 'return', 'decline']);
    expect(outcomes('G5')).toEqual([
      'awarded',
      'negotiating',
      'lost',
      'expired',
      'on_hold',
      'requote',
    ]);
    expect(outcomes('G6')).toEqual(['advance', 'hold', 'requote', 'stop']);
  });

  it('B-26: every gate leads its labels with the standard outcome words', () => {
    const standard =
      /^(Advance|Hold|Rework|Redirect|Stop|Submit|Awarded|In negotiation|Lost|No response|On hold|Re-quote)/;
    for (const o of hybridConfig.outcomes)
      expect(o.label, `${o.gateKey}/${o.key}`).toMatch(standard);
  });

  it('B-26: every hold needs a reason, a review date and an owner', () => {
    const holds = hybridConfig.transitions.filter((t) => t.nextStatus === 'on_hold');
    expect(holds.map((t) => t.gateKey)).toEqual(['G1', 'G2', 'G3', 'G4', 'G5', 'G6']);
    for (const t of holds) {
      const o = hybridConfig.outcomes.find(
        (x) => x.gateKey === t.gateKey && x.key === t.outcomeKey,
      )!;
      expect(o.requiresReasonCode).toBe(true);
      expect(o.requiredFields).toEqual(
        expect.arrayContaining([
          { field: 'review_date', op: 'present' },
          { field: 'hold_owner_id', op: 'present' },
        ]),
      );
    }
  });

  it('B-26: an award moves to Commit & Hand Off; only G6 closes Won', () => {
    const t = (gate: string, key: string) =>
      hybridConfig.transitions.find((x) => x.gateKey === gate && x.outcomeKey === key)!;
    expect(t('G5', 'awarded')).toMatchObject({
      nextStatus: 'active',
      targetStageKeys: ['COMMIT_HANDOFF'],
    });
    expect(t('G6', 'advance')).toMatchObject({
      nextStatus: 'closed',
      closeAs: 'awarded',
      targetStageKeys: ['AWARDED'],
      closureOwner: 'kam',
    });
    expect(t('G6', 'stop')).toMatchObject({ closeAs: 'not_authorized', closureOwner: 'decider' });
    expect(
      hybridConfig.transitions.filter((x) => x.closeAs === 'awarded').map((x) => x.gateKey),
    ).toEqual(['G6']);
  });

  it('enforces the documented constraints', () => {
    const o = (gate: string, key: string) =>
      hybridConfig.outcomes.find((x) => x.gateKey === gate && x.key === key)!;
    expect(o('G2', 'proceed_with_risk').requiresNote).toBe(true);
    expect(o('G4', 'decline')).toMatchObject({ requiresNote: true, requiresReasonCode: true });
    expect(o('G5', 'lost').requiresReasonCode).toBe(true);
    expect(o('G5', 'on_hold').requiredFields).toContainEqual({
      field: 'review_date',
      op: 'present',
    });
    expect(o('G5', 'negotiating').requiresNote).toBe(true);
    expect(o('G6', 'stop')).toMatchObject({ requiresNote: true, reasonContext: 'not_authorized' });
  });

  it('G1 is enabled by default and SUBMIT is the no-G1 path', () => {
    const enabled = (config: WorkflowConfig) =>
      Object.fromEntries(config.gates.map((g) => [g.key, g.enabled]));
    expect(enabled(hybridConfig)).toMatchObject({ G1: true, SUBMIT: false });
    expect(enabled(buildHybridConfig({ g1Enabled: false }))).toMatchObject({
      G1: false,
      SUBMIT: true,
    });
  });

  it('every closing outcome has a reason code requirement (CR-39)', () => {
    const closing = hybridConfig.transitions.filter((t) => t.nextStatus === 'closed');
    for (const t of closing) {
      expect(
        hybridConfig.outcomes.find((o) => o.gateKey === t.gateKey && o.key === t.outcomeKey)!
          .requiresReasonCode,
        `${t.gateKey}/${t.outcomeKey}`,
      ).toBe(true);
    }
  });

  it('seeds reason codes for every context in use', () => {
    const contexts = new Set(SEED_REASON_CODES.map((r) => r.context));
    for (const o of hybridConfig.outcomes)
      if (o.reasonContext) expect(contexts.has(o.reasonContext)).toBe(true);
  });
});

describe('prd5 preset', () => {
  it('has the five PRD stages (Awarded and Closed Lost are the terminal pair)', () => {
    expect(prd5Config.stages.map((s) => s.key)).toEqual([
      'INTAKE',
      'ENG_REVIEW',
      'QUOTING',
      'FINAL_REVIEW',
      'AWARDED',
      'CLOSED_LOST',
    ]);
  });
});
