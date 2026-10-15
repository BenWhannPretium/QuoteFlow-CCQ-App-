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

  it('G2 offers six outcomes to the EngLead, none to a KAM', () => {
    expect(
      availableActions(hybridConfig, makeQuote('ENG_REVIEW'), makeActor('EngLead')),
    ).toHaveLength(6);
    expect(availableActions(hybridConfig, makeQuote('ENG_REVIEW'), makeActor('KAM'))).toEqual([]);
  });

  it('G4 offers approve/decline/return to an Approver, with return needing a target choice', () => {
    const actions = availableActions(
      hybridConfig,
      makeQuote('FINAL_REVIEW'),
      makeActor('Approver'),
    );
    expect(labels(actions)).toEqual(['G4/approve', 'G4/decline', 'G4/return']);
    expect(actions[1]).toMatchObject({
      requiresNote: true,
      requiresReasonCode: true,
      nextStatus: 'closed',
    });
    expect(actions[1]!.reasonCodes.map((r) => r.code)).toContain('margin_below_floor');
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
    ).toHaveLength(3);
  });

  it('G5 is offered to the quote’s own KAM and to SalesLeaders, not to another KAM', () => {
    const quote = makeQuote('CUSTOMER_DECISION');
    expect(
      labels(availableActions(hybridConfig, quote, makeActor('KAM', { userId: KAM_ID }))),
    ).toEqual(['G5/awarded', 'G5/lost', 'G5/expired', 'G5/on_hold', 'G5/requote']);
    expect(availableActions(hybridConfig, quote, makeActor('KAM', { userId: OTHER_ID }))).toEqual(
      [],
    );
    expect(availableActions(hybridConfig, quote, makeActor('SalesLeader'))).toHaveLength(5);
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
      expect(seen, role).toBe(role === 'Pricing');
    }
  });
});
