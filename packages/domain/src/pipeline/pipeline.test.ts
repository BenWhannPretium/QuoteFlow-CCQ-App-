import { describe, expect, it } from 'vitest';

import {
  CLOSED_LANE_KEY,
  boardMoves,
  dropDenialReason,
  droppableColumns,
  planDrop,
  type BoardMove,
} from './board';
import { daysSince, exportColumnsFor, personInitials, seesPeerPriority } from './list';
import { KAM_ID, OTHER_ID, makeActor, makeQuote } from '../test-utils';
import { ROLES, type Role } from '../types/roles';
import { availableActions } from '../workflow/available-actions';
import { hybridConfig } from '../workflow/seeds';

const TERMINAL = hybridConfig.stages.filter((s) => s.terminal).map((s) => s.key);
const OPEN_STAGES = hybridConfig.stages.filter((s) => !s.terminal).map((s) => s.key);
const label = (key: string) => hybridConfig.stages.find((s) => s.key === key)?.label ?? key;

/** The columns a role may drop a quote in `stageKey` on (what the board computes from availableActions). */
function droppable(role: Role, stageKey: string, quote = makeQuote(stageKey)): string[] {
  const actions = availableActions(hybridConfig, quote, makeActor(role, { userId: OTHER_ID }));
  return [...droppableColumns(boardMoves(actions, stageKey), TERMINAL).keys()].sort();
}

describe('board: availableActions → droppable columns', () => {
  it('EngLead may drag ENG_REVIEW → QUOTING (G2), back to INTAKE (Rework) or to Declined (Stop)', () => {
    expect(droppable('EngLead', 'ENG_REVIEW')).toEqual(
      ['DECLINED', 'INTAKE', 'QUOTING', CLOSED_LANE_KEY].sort(),
    );
  });

  it('the forward outcome is the one a drop on QUOTING preselects (Proceed, not With risk)', () => {
    const moves = boardMoves(
      availableActions(hybridConfig, makeQuote('ENG_REVIEW'), makeActor('EngLead')),
      'ENG_REVIEW',
    );
    expect(planDrop(moves, TERMINAL, 'QUOTING')).toEqual({
      gateKey: 'G2',
      outcomeKey: 'proceed',
      targetStageKey: 'QUOTING',
    });
    expect(planDrop(moves, TERMINAL, 'INTAKE')?.outcomeKey).toBe('rework');
    expect(planDrop(moves, TERMINAL, 'FINAL_REVIEW')).toBeNull();
  });

  it('holds are not moves: they keep the quote in its column', () => {
    const moves = boardMoves(
      availableActions(hybridConfig, makeQuote('ENG_REVIEW'), makeActor('EngLead')),
      'ENG_REVIEW',
    );
    expect(moves.some((m) => m.outcomeKey === 'hold')).toBe(false);
    expect(moves.some((m) => m.targetStageKey === 'ENG_REVIEW')).toBe(false);
  });

  it('G4 Return offers both targets, and the drop preselects the column it landed on', () => {
    const moves = boardMoves(
      availableActions(hybridConfig, makeQuote('FINAL_REVIEW'), makeActor('Approver')),
      'FINAL_REVIEW',
    );
    expect(planDrop(moves, TERMINAL, 'ENG_REVIEW')).toEqual({
      gateKey: 'G4',
      outcomeKey: 'return',
      targetStageKey: 'ENG_REVIEW',
    });
    expect(planDrop(moves, TERMINAL, 'QUOTING')?.targetStageKey).toBe('QUOTING');
    expect(planDrop(moves, TERMINAL, 'CUSTOMER_DECISION')?.outcomeKey).toBe('approve');
  });

  it('the collapsed Closed lane preselects only when one closing outcome is possible', () => {
    const g2 = boardMoves(
      availableActions(hybridConfig, makeQuote('ENG_REVIEW'), makeActor('EngLead')),
      'ENG_REVIEW',
    );
    expect(planDrop(g2, TERMINAL, CLOSED_LANE_KEY)).toEqual({
      gateKey: 'G2',
      outcomeKey: 'stop',
      targetStageKey: 'DECLINED',
    });
    const g5 = boardMoves(
      availableActions(
        hybridConfig,
        makeQuote('CUSTOMER_DECISION', { kamUserId: KAM_ID }),
        makeActor('KAM', { userId: KAM_ID }),
      ),
      'CUSTOMER_DECISION',
    );
    expect(planDrop(g5, TERMINAL, CLOSED_LANE_KEY)).toEqual({
      gateKey: 'G5',
      outcomeKey: null,
      targetStageKey: null,
    });
    // B-26: an award moves to Commit & Hand Off (an open stage); G6 closes it Won.
    expect(planDrop(g5, TERMINAL, 'COMMIT_HANDOFF')?.outcomeKey).toBe('awarded');
    const g6 = boardMoves(
      availableActions(
        hybridConfig,
        makeQuote('COMMIT_HANDOFF', { kamUserId: KAM_ID }),
        makeActor('KAM', { userId: KAM_ID }),
      ),
      'COMMIT_HANDOFF',
    );
    expect(planDrop(g6, TERMINAL, 'AWARDED')?.outcomeKey).toBe('advance');
  });

  it.each(ROLES)('%s may drag only from the stage whose gate it decides', (role) => {
    // SalesLeader decides G1, records customer outcomes (outcome.record) at G5 and G6 (B-26).
    const expected: Partial<Record<Role, string[]>> = {
      SalesLeader: ['INTAKE', 'CUSTOMER_DECISION', 'COMMIT_HANDOFF'],
      EngLead: ['ENG_REVIEW'],
      Pricing: ['QUOTING'],
      PricingLead: ['QUOTING'],
      Approver: ['FINAL_REVIEW'],
    };
    for (const stage of OPEN_STAGES) {
      const cols = droppable(role, stage);
      if (expected[role]?.includes(stage))
        expect(cols.length, `${role} ${stage}`).toBeGreaterThan(0);
      else if (role === 'KAM' && (stage === 'CUSTOMER_DECISION' || stage === 'COMMIT_HANDOFF'))
        continue; // own quotes: next test
      else expect(cols, `${role} ${stage}`).toEqual([]);
    }
  });

  it('a KAM moves only their own quotes out of Customer Decision (outcome.record own)', () => {
    const own = makeQuote('CUSTOMER_DECISION', { kamUserId: KAM_ID });
    const peer = makeQuote('CUSTOMER_DECISION', { kamUserId: OTHER_ID });
    const kam = makeActor('KAM', { userId: KAM_ID });
    const cols = (q: typeof own) =>
      [
        ...droppableColumns(
          boardMoves(availableActions(hybridConfig, q, kam), 'CUSTOMER_DECISION'),
          TERMINAL,
        ).keys(),
      ].sort();
    expect(cols(own)).toEqual(
      ['COMMIT_HANDOFF', 'CLOSED_LOST', 'ENG_REVIEW', 'EXPIRED', 'QUOTING', CLOSED_LANE_KEY].sort(),
    );
    expect(cols(peer)).toEqual([]);
  });

  it('segregation removes the move: the KAM of a quote cannot drag it out of Final Review', () => {
    const quote = makeQuote('FINAL_REVIEW', { kamUserId: KAM_ID });
    const approverWhoIsKam = makeActor('Approver', { userId: KAM_ID });
    expect(
      boardMoves(availableActions(hybridConfig, quote, approverWhoIsKam), 'FINAL_REVIEW'),
    ).toEqual([]);
  });

  it('closed quotes have no moves', () => {
    expect(droppable('Admin', 'AWARDED', makeQuote('AWARDED', { status: 'closed' }))).toEqual([]);
  });
});

describe('dropDenialReason', () => {
  const g2 = { key: 'G2', label: 'Feasible solution?', enabled: true };
  const engMoves = boardMoves(
    availableActions(hybridConfig, makeQuote('ENG_REVIEW'), makeActor('EngLead')),
    'ENG_REVIEW',
  );
  const base = {
    fromStageKey: 'ENG_REVIEW',
    status: 'active',
    terminalStageKeys: TERMINAL,
    gate: g2,
    stageLabel: label,
  };

  it('is null for an allowed column or the card’s own column', () => {
    expect(dropDenialReason({ ...base, toColumnKey: 'QUOTING', moves: engMoves })).toBeNull();
    expect(dropDenialReason({ ...base, toColumnKey: 'ENG_REVIEW', moves: [] })).toBeNull();
  });

  it('names the gate when the actor cannot decide it', () => {
    expect(dropDenialReason({ ...base, toColumnKey: 'QUOTING', moves: [] })).toMatch(
      /can’t decide “Feasible solution\?” \(G2\)/,
    );
  });

  it('lists where the card can go when the column is not one of them', () => {
    expect(dropDenialReason({ ...base, toColumnKey: 'FINAL_REVIEW', moves: engMoves })).toBe(
      'No “Feasible solution?” outcome moves a quote from Engineering Review to Final Review. You can move it to: Quoting, Intake, Declined.',
    );
    expect(
      dropDenialReason({
        ...base,
        toColumnKey: CLOSED_LANE_KEY,
        moves: engMoves.filter((m: BoardMove) => !m.closes),
      }),
    ).toMatch(/to Closed\./);
  });

  it('explains closed quotes and stages without a gate', () => {
    expect(
      dropDenialReason({ ...base, status: 'closed', toColumnKey: 'QUOTING', moves: [] }),
    ).toMatch(/closed/);
    expect(dropDenialReason({ ...base, gate: null, toColumnKey: 'QUOTING', moves: [] })).toBe(
      'Nothing moves a quote from Engineering Review on the board.',
    );
    expect(
      dropDenialReason({ ...base, gate: { ...g2, enabled: false }, toColumnKey: 'X', moves: [] }),
    ).toMatch(/Nothing moves/);
  });
});

describe('list helpers', () => {
  it('seesPeerPriority: only a KAM-only user is restricted, and only when the setting is off', () => {
    expect(seesPeerPriority(makeActor('KAM'), false)).toBe(false);
    expect(seesPeerPriority(makeActor('KAM'), true)).toBe(true);
    expect(seesPeerPriority(makeActor(['KAM', 'SalesLeader']), false)).toBe(true);
    expect(seesPeerPriority(makeActor('Engineer'), false)).toBe(true);
  });

  it('daysSince counts whole days and never goes negative', () => {
    const now = new Date('2026-11-03T12:00:00Z');
    expect(daysSince(new Date('2026-11-01T12:00:01Z'), now)).toBe(1);
    expect(daysSince(new Date('2026-11-01T12:00:00Z'), now)).toBe(2);
    expect(daysSince(new Date('2026-11-04T00:00:00Z'), now)).toBe(0);
  });

  it('exportColumnsFor drops commercial columns for roles without commercialFields', () => {
    const known = [
      'quoteNumber',
      'amount',
      'prelimCapitalUsd',
      'capitalReadiness',
      'priceApproved',
    ];
    const requested = [
      'quoteNumber',
      'prelimCapitalUsd',
      'capitalReadiness',
      'nope',
      'quoteNumber',
    ];
    expect(exportColumnsFor(makeActor('KAM'), requested, known)).toEqual(['quoteNumber']);
    expect(exportColumnsFor(makeActor('Pricing'), requested, known)).toEqual([
      'quoteNumber',
      'prelimCapitalUsd',
      'capitalReadiness',
    ]);
    // `priceApproved…` matches the commercial prefix `price`; the approval *status* column is named
    // differently in the list so it stays visible to everyone.
    expect(exportColumnsFor(makeActor('KAM'), ['priceApproved'], known)).toEqual([]);
  });

  it('personInitials', () => {
    expect(personInitials('Avery Q. Kam')).toBe('AK');
    expect(personInitials('cher')).toBe('C');
    expect(personInitials('  ')).toBe('?');
    expect(personInitials(null)).toBe('?');
  });
});
