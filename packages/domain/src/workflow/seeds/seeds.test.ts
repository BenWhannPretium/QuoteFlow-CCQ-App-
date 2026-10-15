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
  it('has the ten stages, five of them terminal', () => {
    expect(hybridConfig.stages.map((s) => s.key)).toEqual([
      'INTAKE',
      'ENG_REVIEW',
      'QUOTING',
      'FINAL_REVIEW',
      'CUSTOMER_DECISION',
      'AWARDED',
      'CLOSED_LOST',
      'DECLINED',
      'EXPIRED',
      'REDIRECTED',
    ]);
    expect(hybridConfig.stages.filter((s) => s.terminal).map((s) => s.key)).toEqual([
      'AWARDED',
      'CLOSED_LOST',
      'DECLINED',
      'EXPIRED',
      'REDIRECTED',
    ]);
  });

  it('has gates G1–G5 with the right deciders', () => {
    const decider = (key: string) =>
      hybridConfig.gates.find((g) => g.key === key)?.deciderPermission;
    expect(decider('G1')).toBe('gate.G1.decide');
    expect(decider('G2')).toBe('gate.G2.decide');
    expect(decider('G3')).toBe('gate.G3.submit');
    expect(decider('G4')).toBe('gate.G4.decide');
    expect(decider('G5')).toBe('outcome.record');
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
      'stop',
    ]);
    expect(outcomes('G3')).toEqual(['submit', 'hold', 'rework', 'stop']);
    expect(outcomes('G4')).toEqual(['approve', 'decline', 'return']);
    expect(outcomes('G5')).toEqual(['awarded', 'lost', 'expired', 'on_hold', 'requote']);
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

  it('every closing outcome has a reason code requirement (CR-39), except Awarded and Approve', () => {
    const closing = hybridConfig.transitions.filter(
      (t) => t.nextStatus === 'closed' && t.closeAs !== 'awarded',
    );
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
