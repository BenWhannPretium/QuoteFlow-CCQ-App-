import { describe, expect, it } from 'vitest';

import { KAM_ID, OTHER_ID, makeActor, makeQuote } from '../test-utils';
import { availableActions } from './available-actions';
import { buildHybridConfig, hybridConfig, prd5Config } from './seeds';
import { ROLES } from '../types/roles';

const labels = (actions: ReturnType<typeof availableActions>) =>
  actions.map((a) => `${a.gateKey}/${a.outcomeKey}`);

describe('availableActions', () => {
  it('G1 offers the five outcomes to a SalesLeader', () => {
    expect(
      labels(availableActions(hybridConfig, makeQuote('INTAKE'), makeActor('SalesLeader'))),
    ).toEqual(['G1/advance', 'G1/hold', 'G1/rework', 'G1/redirect', 'G1/stop']);
  });

  it('G2 offers six outcomes to the EngLead (FB-17: "Capital required" is switched off), none to a KAM', () => {
    const actions = availableActions(hybridConfig, makeQuote('ENG_REVIEW'), makeActor('EngLead'));
    expect(labels(actions)).toEqual([
      'G2/proceed',
      'G2/proceed_with_risk',
      'G2/hold',
      'G2/rework',
      'G2/redirect',
      'G2/stop',
    ]);
    expect(availableActions(hybridConfig, makeQuote('ENG_REVIEW'), makeActor('KAM'))).toEqual([]);
  });

  it('FB-17: a switched-off outcome is not offered; switched back on, it is', () => {
    const offered = (config: typeof hybridConfig) =>
      labels(availableActions(config, makeQuote('ENG_REVIEW'), makeActor('EngLead')));
    expect(offered(hybridConfig)).not.toContain('G2/capital_required');
    const on = structuredClone(hybridConfig);
    on.outcomes.find((o) => o.gateKey === 'G2' && o.key === 'capital_required')!.active = true;
    expect(offered(on)).toContain('G2/capital_required');
    const off = structuredClone(hybridConfig);
    off.outcomes.find((o) => o.gateKey === 'G2' && o.key === 'hold')!.active = false;
    expect(offered(off)).not.toContain('G2/hold');
  });

  it('FB-17: every action carries the choice the dialog shows it under', () => {
    const groups = (stage: string, role: Parameters<typeof makeActor>[0]) =>
      availableActions(hybridConfig, makeQuote(stage), makeActor(role)).map(
        (a) => `${a.outcomeKey}:${a.outcomeGroup}`,
      );
    expect(groups('INTAKE', 'SalesLeader')).toEqual([
      'advance:advance',
      'hold:hold',
      'rework:send_back',
      'redirect:stop',
      'stop:stop',
    ]);
    expect(groups('QUOTING', 'PricingLead')).toEqual([
      'submit:advance',
      'hold:hold',
      'recost:send_back',
      'rework:send_back',
      'rework_kam:send_back',
      'redirect:send_back',
      'stop:stop',
    ]);
    // G5 is the customer's answer: no four verbs there, only its own hold.
    expect(groups('CUSTOMER_DECISION', 'SalesLeader')).toEqual([
      'awarded:customer_outcome',
      'negotiating:customer_outcome',
      'lost:customer_outcome',
      'expired:customer_outcome',
      'on_hold:hold',
      'requote:customer_outcome',
    ]);
    // A config without groups (the PRD-5 preset) reports none.
    const ungrouped = availableActions(prd5Config, makeQuote('ENG_REVIEW'), makeActor('EngLead'));
    expect(ungrouped.length).toBeGreaterThan(0);
    expect(ungrouped.every((a) => a.outcomeGroup === null)).toBe(true);
  });

  it('G4 offers approve/hold/return/decline to an Approver, with return needing a target choice', () => {
    const actions = availableActions(
      hybridConfig,
      makeQuote('FINAL_REVIEW'),
      makeActor('Approver'),
    );
    expect(labels(actions)).toEqual(['G4/approve', 'G4/hold', 'G4/return', 'G4/decline']);
    expect(actions[3]).toMatchObject({
      requiresNote: true,
      requiresReasonCode: true,
      nextStatus: 'closed',
    });
    expect(actions[3]!.reasonCodes.map((r) => r.code)).toContain('margin_below_floor');
    expect(actions[1]).toMatchObject({ nextStatus: 'on_hold', requiresReasonCode: true });
    expect(actions[2]).toMatchObject({
      targetStageKeys: ['QUOTING', 'ENG_REVIEW'],
      requiresNote: true,
    });
  });

  it('hides actions blocked by segregation of duties', () => {
    expect(
      availableActions(
        hybridConfig,
        makeQuote('FINAL_REVIEW'),
        makeActor('Approver', { userId: KAM_ID }),
      ),
    ).toEqual([]);
    expect(
      availableActions(
        hybridConfig,
        makeQuote('FINAL_REVIEW'),
        makeActor('Approver', { userId: OTHER_ID }),
      ),
    ).toHaveLength(4);
  });

  it('G5 is offered to the quote’s own KAM and to SalesLeaders, not to another KAM', () => {
    const quote = makeQuote('CUSTOMER_DECISION');
    expect(
      labels(availableActions(hybridConfig, quote, makeActor('KAM', { userId: KAM_ID }))),
    ).toEqual([
      'G5/awarded',
      'G5/negotiating',
      'G5/lost',
      'G5/expired',
      'G5/on_hold',
      'G5/requote',
    ]);
    expect(availableActions(hybridConfig, quote, makeActor('KAM', { userId: OTHER_ID }))).toEqual(
      [],
    );
    expect(availableActions(hybridConfig, quote, makeActor('SalesLeader'))).toHaveLength(6);
  });

  it('B-26: G6 (Commit & Hand Off) is offered to the own KAM and SalesLeaders', () => {
    const quote = makeQuote('COMMIT_HANDOFF');
    expect(
      labels(availableActions(hybridConfig, quote, makeActor('KAM', { userId: KAM_ID }))),
    ).toEqual(['G6/advance', 'G6/hold', 'G6/requote', 'G6/stop']);
    expect(availableActions(hybridConfig, quote, makeActor('KAM', { userId: OTHER_ID }))).toEqual(
      [],
    );
    expect(availableActions(hybridConfig, quote, makeActor('Approver'))).toEqual([]);
  });

  it('exposes required-field rules so forms can mark them up front', () => {
    const [proceed] = availableActions(hybridConfig, makeQuote('ENG_REVIEW'), makeActor('EngLead'));
    expect(proceed!.requiredFields).toContainEqual({
      field: 'capacity_evidence',
      op: 'minItems',
      value: 1,
    });
  });

  it('returns nothing for closed quotes and terminal stages', () => {
    expect(
      availableActions(
        hybridConfig,
        makeQuote('INTAKE', { status: 'closed' }),
        makeActor('SalesLeader'),
      ),
    ).toEqual([]);
    expect(availableActions(hybridConfig, makeQuote('AWARDED'), makeActor('Admin'))).toEqual([]);
  });

  it('follows the g1Enabled flag', () => {
    const off = buildHybridConfig({ g1Enabled: false });
    expect(labels(availableActions(off, makeQuote('INTAKE'), makeActor('SalesLeader')))).toEqual([
      'SUBMIT/submit',
    ]);
    expect(labels(availableActions(hybridConfig, makeQuote('INTAKE'), makeActor('Admin')))).toEqual(
      [],
    );
  });

  it('is config-driven: the prd5 preset yields different buttons from the same code', () => {
    expect(
      labels(availableActions(prd5Config, makeQuote('FINAL_REVIEW'), makeActor('Approver'))),
    ).toEqual(['P_FINAL/award', 'P_FINAL/lose', 'P_FINAL/return']);
  });

  it('only decider roles ever see actions at a gate', () => {
    for (const role of ROLES) {
      const seen = availableActions(hybridConfig, makeQuote('QUOTING'), makeActor(role)).length > 0;
      expect(seen, role).toBe(role === 'PricingLead');
    }
  });
});
