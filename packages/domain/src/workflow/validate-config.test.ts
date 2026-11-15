import { describe, expect, it } from 'vitest';

import { DomainError } from '../errors';
import { buildHybridConfig, hybridConfig, prd5Config } from './seeds';
import { parseWorkflowConfig, validateWorkflowConfig } from './validate-config';
import type { OutcomeGroup, WorkflowConfig } from '../types/workflow-config';

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
      resumeAt: 'intake',
      active: true,
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

// FB-17 (W13-22, W13-23): outcomes can be switched off, and each sits under one choice in the dialog.
describe('FB-17: switching outcomes off, and their groups', () => {
  const setActive = (config: WorkflowConfig, gate: string, key: string, active: boolean) => {
    config.outcomes.find((o) => o.gateKey === gate && o.key === key)!.active = active;
    return config;
  };
  const ADVANCE_NEEDED = (gate: string) =>
    `Gate ${gate} needs at least one active Advance outcome: switch another one on first`;

  it('the seed switches "Advance – capital required" off and nothing else', () => {
    expect(
      hybridConfig.outcomes.filter((o) => !o.active).map((o) => `${o.gateKey}/${o.key}`),
    ).toEqual(['G2/capital_required']);
  });

  it("any outcome but a gate's last active Advance can be switched off", () => {
    for (const o of hybridConfig.outcomes.filter((x) => x.active)) {
      const advances = hybridConfig.outcomes.filter(
        (x) => x.gateKey === o.gateKey && x.outcomeGroup === 'advance' && x.active,
      );
      const last = o.outcomeGroup === 'advance' && advances.length === 1;
      const c = setActive(clone(), o.gateKey, o.key, false);
      expect(messages(c), `${o.gateKey}/${o.key}`).toEqual(last ? [ADVANCE_NEEDED(o.gateKey)] : []);
    }
  });

  it('G2 keeps a way forward: one Advance may go, not both', () => {
    const one = setActive(clone(), 'G2', 'proceed', false);
    expect(messages(one)).toEqual([]);
    const both = setActive(one, 'G2', 'proceed_with_risk', false);
    expect(messages(both)).toEqual([ADVANCE_NEEDED('G2')]);
    // Switching the retired outcome back on is a way forward again.
    expect(messages(setActive(both, 'G2', 'capital_required', true))).toEqual([]);
  });

  it('G5 has no Advance group (the customer answers), so none is asked for there', () => {
    const c = clone();
    for (const o of c.outcomes.filter((x) => x.gateKey === 'G5')) o.active = false;
    expect(messages(c)).toEqual([]);
  });

  it('before a config has groups: the last outcome that moves the quote on stays active', () => {
    const c = structuredClone(prd5Config);
    expect(c.outcomes.some((o) => o.outcomeGroup !== undefined)).toBe(false);
    // P_ENG: "accept" goes to Quoting and "return" back to Intake. One of them must stay.
    expect(messages(setActive(c, 'P_ENG', 'accept', false))).toEqual([]);
    expect(messages(setActive(c, 'P_ENG', 'return', false))).toEqual([
      'Gate P_ENG needs at least one active outcome that moves the quote on: switch another one on first',
    ]);
  });

  it('the other checks keep applying to active outcomes; a switched-off one holds no reason codes', () => {
    const c = clone();
    for (const r of c.reasonCodes.filter((x) => x.context === 'not_authorized')) r.active = false;
    expect(messages(c)).toEqual([
      'Outcome G6/stop requires a reason code but context "not_authorized" has no active codes',
    ]);
    expect(messages(setActive(c, 'G6', 'stop', false))).toEqual([]);
    // Structure is still checked on a switched-off outcome.
    const orphan = clone();
    orphan.transitions = orphan.transitions.filter(
      (t) => !(t.gateKey === 'G2' && t.outcomeKey === 'capital_required'),
    );
    expect(messages(orphan)).toEqual(['Outcome G2/capital_required has no transition rule']);
  });

  it('a group must match what the transition does', () => {
    const group = (gate: string, key: string, outcomeGroup: OutcomeGroup) => {
      const c = clone();
      c.outcomes.find((o) => o.gateKey === gate && o.key === key)!.outcomeGroup = outcomeGroup;
      return messages(c);
    };
    // A send-back is never offered as a Hold, and a Hold is nothing else.
    expect(group('G2', 'rework', 'hold')).toEqual([
      'Outcome G2/rework is in the hold group but does not put the quote on hold',
    ]);
    expect(group('G2', 'hold', 'send_back')).toEqual([
      'Outcome G2/hold puts the quote on hold, so its group must be hold',
    ]);
    expect(group('G2', 'rework', 'stop')).toEqual([
      'Outcome G2/rework is in the stop group but does not close the quote',
    ]);
    expect(group('G2', 'stop', 'send_back')).toEqual([
      'Outcome G2/stop is in the send_back group but does not keep the quote active',
    ]);
    // G1 "not CCQ work" closes the quote, so Stop is a valid home for it.
    expect(group('G1', 'redirect', 'stop')).toEqual([]);
  });

  it('every seeded send-back asks for a reason code and a note', () => {
    const sendBacks = hybridConfig.outcomes.filter((o) => o.outcomeGroup === 'send_back');
    expect(sendBacks.map((o) => `${o.gateKey}/${o.key}`)).toEqual([
      'G1/rework',
      'G2/rework',
      'G2/redirect',
      'G3/recost',
      'G3/rework',
      'G3/rework_kam',
      'G3/redirect',
      'G4/return',
      'G6/requote',
    ]);
    for (const o of sendBacks) {
      expect([o.requiresNote, o.requiresReasonCode], `${o.gateKey}/${o.key}`).toEqual([true, true]);
      expect(o.label, `${o.gateKey}/${o.key}`).toMatch(/^Send back to /);
    }
    // The two that had no reason context before FB-17 take the rework codes, not G1's not-CCQ codes.
    for (const gate of ['G2', 'G3']) {
      const redirect = hybridConfig.outcomes.find(
        (o) => o.gateKey === gate && o.key === 'redirect',
      );
      expect(redirect?.reasonContext).toBe('rework');
    }
  });

  it('parsing defaults an outcome to active and refuses an unknown group', () => {
    const raw = JSON.parse(JSON.stringify(hybridConfig)) as {
      outcomes: Record<string, unknown>[];
    };
    for (const o of raw.outcomes) delete o.active;
    delete raw.outcomes[0]!.outcomeGroup;
    const parsed = parseWorkflowConfig(raw);
    expect(parsed.outcomes.every((o) => o.active)).toBe(true);
    expect(parsed.outcomes[0]!.outcomeGroup).toBeUndefined();
    raw.outcomes[0]!.outcomeGroup = 'rework';
    expect(() => parseWorkflowConfig(raw)).toThrow(DomainError);
  });
});
