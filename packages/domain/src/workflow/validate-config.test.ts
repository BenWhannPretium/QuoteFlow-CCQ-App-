import { describe, expect, it } from 'vitest';

import { DomainError } from '../errors';
import { buildHybridConfig, hybridConfig, prd5Config } from './seeds';
import { parseWorkflowConfig, validateWorkflowConfig } from './validate-config';
import type { WorkflowConfig } from '../types/workflow-config';

const clone = (): WorkflowConfig => structuredClone(hybridConfig);
const messages = (config: WorkflowConfig) => validateWorkflowConfig(config).map((e) => e.message);

describe('validateWorkflowConfig', () => {
  it.each([
    ['hybrid', hybridConfig],
    ['hybrid, G1 off', buildHybridConfig({ g1Enabled: false })],
    ['prd5', prd5Config],
  ])('accepts the %s preset', (_name, config) => {
    expect(validateWorkflowConfig(config)).toEqual([]);
  });

  it('flags duplicates', () => {
    const c = clone();
    c.stages.push(c.stages[0]!);
    c.gates.push(c.gates[0]!);
    c.outcomes.push(c.outcomes[0]!);
    c.transitions.push(c.transitions[0]!);
    const out = messages(c);
    expect(out).toEqual(
      expect.arrayContaining([
        'Duplicate stage key: INTAKE',
        'Duplicate gate key: G1',
        'Duplicate outcome: G1/advance',
        'Duplicate transition: G1/advance',
      ]),
    );
  });

  it('flags gates on unknown or terminal stages', () => {
    const c = clone();
    c.gates[0]!.stageKey = 'NOPE';
    c.gates[1]!.stageKey = 'AWARDED';
    expect(messages(c)).toEqual([
      'Gate G1 is on unknown stage NOPE',
      'Gate SUBMIT is on terminal stage AWARDED',
    ]);
  });

  it('flags orphaned outcomes and transitions', () => {
    const c = clone();
    c.outcomes.push({
      gateKey: 'GX',
      key: 'x',
      label: 'X',
      requiresNote: false,
      requiresReasonCode: false,
      requiredFields: [],
      notify: [],
      helpText: null,
      provisional: true,
    });
    c.transitions.push({
      gateKey: 'G1',
      outcomeKey: 'ghost',
      targetStageKeys: [],
      nextStatus: 'active',
      versionBump: false,
      closureOwner: 'decider',
      provisional: true,
    });
    expect(messages(c)).toEqual(
      expect.arrayContaining([
        'Outcome GX/x is on unknown gate GX',
        'Outcome GX/x has no transition rule',
        'Transition G1/ghost has no matching outcome',
      ]),
    );
  });

  it('flags unknown targets', () => {
    const c = clone();
    c.transitions[0]!.targetStageKeys = ['NOWHERE'];
    expect(messages(c)).toContain('Transition G1/advance targets unknown stage NOWHERE');
  });

  it('closing transitions must target terminal stages and carry closeAs', () => {
    const c = clone();
    const stop = c.transitions.find((t) => t.gateKey === 'G1' && t.outcomeKey === 'stop')!;
    stop.targetStageKeys = ['QUOTING'];
    delete stop.closeAs;
    expect(messages(c)).toEqual(
      expect.arrayContaining([
        'Transition G1/stop closes the quote, so every target must be a terminal stage',
        'Transition G1/stop closes the quote but has no closeAs',
      ]),
    );
    const noTarget = clone();
    noTarget.transitions.find(
      (t) => t.gateKey === 'G1' && t.outcomeKey === 'stop',
    )!.targetStageKeys = [];
    expect(messages(noTarget)).toContain(
      'Transition G1/stop closes the quote, so every target must be a terminal stage',
    );
  });

  it('non-closing transitions must not reach terminal stages or set closeAs', () => {
    const c = clone();
    const advance = c.transitions.find((t) => t.gateKey === 'G1' && t.outcomeKey === 'advance')!;
    advance.targetStageKeys = ['AWARDED'];
    advance.closeAs = 'awarded';
    expect(messages(c)).toEqual(
      expect.arrayContaining([
        'Transition G1/advance targets a terminal stage but nextStatus is active',
        'Transition G1/advance sets closeAs but does not close the quote',
      ]),
    );
  });

  it('reason-code requirements need a context with active codes', () => {
    const c = clone();
    delete c.outcomes.find((o) => o.gateKey === 'G5' && o.key === 'lost')!.reasonContext;
    c.outcomes.find((o) => o.gateKey === 'G5' && o.key === 'expired')!.reasonContext =
      'no_such_context';
    expect(messages(c)).toEqual([
      'Outcome G5/lost requires a reason code but has no reasonContext',
      'Outcome G5/expired requires a reason code but context "no_such_context" has no active codes',
    ]);
  });

  it('segregation rules must refer to real gates and outcomes', () => {
    const c = clone();
    c.segregation.push({
      id: 'bad',
      gateKeys: ['G9'],
      deny: 'actor_is_kam',
      message: 'x',
      provisional: true,
    });
    c.segregation.push({
      id: 'bad2',
      gateKeys: ['G4'],
      outcomeKeys: ['bogus'],
      deny: 'actor_is_kam',
      message: 'x',
      provisional: true,
    });
    expect(messages(c)).toEqual([
      'Segregation rule bad refers to unknown gate G9',
      'Segregation rule bad2 refers to unknown outcome G4/bogus',
    ]);
  });
});

describe('parseWorkflowConfig', () => {
  const raw = () => JSON.parse(JSON.stringify(hybridConfig)) as Record<string, unknown>;

  it('round-trips a config through JSON (as if loaded from DB rows)', () => {
    expect(parseWorkflowConfig(raw())).toEqual(hybridConfig);
  });

  it('applies defaults', () => {
    const parsed = parseWorkflowConfig({
      stages: [
        { key: 'A', label: 'A' },
        { key: 'Z', label: 'Z' },
      ],
      gates: [{ key: 'G', stageKey: 'A', label: 'G', deciderPermission: 'quote.create' }],
      outcomes: [{ gateKey: 'G', key: 'go', label: 'Go' }],
      transitions: [
        {
          gateKey: 'G',
          outcomeKey: 'go',
          targetStageKeys: ['Z'],
          nextStatus: 'active',
        },
      ],
    });
    expect(parsed.gates[0]).toMatchObject({ enabled: true, requiredFields: [], provisional: true });
    expect(parsed.outcomes[0]).toMatchObject({
      requiresNote: false,
      requiresReasonCode: false,
      notify: [],
    });
    expect(parsed.transitions[0]).toMatchObject({ versionBump: false, closureOwner: 'decider' });
    expect(parsed.reasonCodes).toEqual([]);
    expect(parsed.segregation).toEqual([]);
  });

  it('throws INVALID_CONFIG on schema errors', () => {
    const bad = raw();
    (bad.gates as Record<string, unknown>[])[0]!.deciderPermission = 'gate.G9.decide';
    expect(() => parseWorkflowConfig(bad)).toThrow(DomainError);
    expect(() => parseWorkflowConfig(bad)).toThrow(
      /schema validation.*gates\.0\.deciderPermission/,
    );
    expect(() => parseWorkflowConfig('nope')).toThrow(/\(root\)/);
    expect(() => parseWorkflowConfig({ ...raw(), surprise: 1 })).toThrow(DomainError);
  });

  it('throws INVALID_CONFIG on consistency errors', () => {
    const bad = raw();
    (bad.gates as Record<string, unknown>[])[0]!.stageKey = 'NOPE';
    try {
      parseWorkflowConfig(bad);
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_CONFIG' });
      expect((error as Error).message).toContain('unknown stage NOPE');
    }
  });
});
