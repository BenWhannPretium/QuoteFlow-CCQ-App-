import { OUTCOME_GROUP_VALUES } from '@ccq/contracts';
import { OUTCOME_GROUPS, hybridConfig } from '@ccq/domain';
import { describe, expect, it } from 'vitest';

import {
  DECISION_GROUPS,
  groupDecisions,
  noteHelp,
  notePlaceholder,
  sendBackDestination,
  sendBackOptions,
  sendBackValue,
  showsDecisionGroups,
} from './decision-groups';

type Group = (typeof OUTCOME_GROUP_VALUES)[number];

const action = (
  outcomeKey: string,
  outcomeLabel: string,
  outcomeGroup: Group | null,
  targetStageKeys: string[] = ['X'],
) => ({ outcomeKey, outcomeLabel, outcomeGroup, targetStageKeys });

/** What a decider is offered at a gate of the seeded workflow (active outcomes, config order). */
const seeded = (gateKey: string) =>
  hybridConfig.outcomes
    .filter((o) => o.gateKey === gateKey && o.active)
    .map((o) => {
      const transition = hybridConfig.transitions.find(
        (t) => t.gateKey === gateKey && t.outcomeKey === o.key,
      )!;
      return action(o.key, o.label, o.outcomeGroup ?? null, [...transition.targetStageKeys]);
    });

const STAGES: Record<string, string> = { QUOTING: 'Quoting', ENG_REVIEW: 'Engineering & Capacity' };
const stageName = (key: string) => STAGES[key] ?? key;

describe('outcome groups', () => {
  it('the API contract and the domain list the same groups (contracts does not import the domain)', () => {
    expect([...OUTCOME_GROUP_VALUES]).toEqual([...OUTCOME_GROUPS]);
    // The four choices are the groups a decider picks from; `customer_outcome` is G5's flat list.
    expect([...DECISION_GROUPS, 'customer_outcome'].sort()).toEqual([...OUTCOME_GROUPS].sort());
  });
});

describe('showsDecisionGroups', () => {
  it('shows the four choices at G1 to G4 and G6, and keeps the flat list at G5', () => {
    for (const gate of ['G1', 'G2', 'G3', 'G4', 'G6']) {
      expect(showsDecisionGroups(seeded(gate)), gate).toBe(true);
    }
    expect(showsDecisionGroups(seeded('G5'))).toBe(false);
  });

  it('keeps the flat list when an outcome has no group, and when nothing is offered', () => {
    expect(
      showsDecisionGroups([action('advance', 'Advance', 'advance'), action('x', 'X', null)]),
    ).toBe(false);
    expect(showsDecisionGroups([])).toBe(false);
  });
});

describe('groupDecisions', () => {
  it('orders Advance, Send back to…, Hold, Stop, whatever the config order is', () => {
    const groups = groupDecisions(seeded('G2'));
    expect(groups.map((g) => g.label)).toEqual(['Advance', 'Send back to…', 'Hold', 'Stop']);
    expect(groups.map((g) => g.actions.map((a) => a.outcomeKey))).toEqual([
      // "Advance – capital required" is switched off (W13-22), so it is not offered.
      ['proceed', 'proceed_with_risk'],
      ['rework', 'redirect'],
      ['hold'],
      ['stop'],
    ]);
  });

  it('G1 "not CCQ work" sits under Stop, not under Send back', () => {
    const groups = groupDecisions(seeded('G1'));
    expect(groups.find((g) => g.group === 'stop')!.actions.map((a) => a.outcomeKey)).toEqual([
      'redirect',
      'stop',
    ]);
    expect(groups.find((g) => g.group === 'send_back')!.actions.map((a) => a.outcomeKey)).toEqual([
      'rework',
    ]);
  });

  it('leaves out a choice with nothing under it', () => {
    expect(groupDecisions([action('hold', 'Hold', 'hold')]).map((g) => g.group)).toEqual(['hold']);
  });
});

describe('the "Send to" list', () => {
  it('names each send-back by where the quote goes', () => {
    expect(sendBackOptions(seeded('G1'), stageName).map((o) => o.label)).toEqual([
      'The KAM (fix the intake)',
    ]);
    expect(sendBackOptions(seeded('G2'), stageName).map((o) => [o.outcomeKey, o.label])).toEqual([
      ['rework', 'The KAM (fix the intake)'],
      ['redirect', 'Engineering (try another platform or site)'],
    ]);
    expect(sendBackOptions(seeded('G3'), stageName).map((o) => [o.outcomeKey, o.label])).toEqual([
      ['recost', 'Pricing (re-cost)'],
      ['rework', 'Engineering'],
      ['rework_kam', 'The KAM'],
      ['redirect', 'Pricing (another capital model)'],
    ]);
  });

  it('an outcome with several target stages becomes one option per stage, named by the stage', () => {
    expect(sendBackOptions(seeded('G4'), stageName)).toEqual([
      {
        value: 'return>QUOTING',
        outcomeKey: 'return',
        targetStageKey: 'QUOTING',
        label: 'Quoting',
      },
      {
        value: 'return>ENG_REVIEW',
        outcomeKey: 'return',
        targetStageKey: 'ENG_REVIEW',
        label: 'Engineering & Capacity',
      },
    ]);
    expect(sendBackOptions(seeded('G6'), stageName).map((o) => o.value)).toEqual([
      'requote>QUOTING',
      'requote>ENG_REVIEW',
    ]);
    expect(sendBackValue('return', 'QUOTING')).toBe('return>QUOTING');
    expect(sendBackValue('rework')).toBe('rework');
  });

  it('never lists a hold, a stop or an advance', () => {
    for (const gate of ['G1', 'G2', 'G3', 'G4', 'G6']) {
      const keys = sendBackOptions(seeded(gate), stageName).map((o) => o.outcomeKey);
      const sendBacks = seeded(gate)
        .filter((a) => a.outcomeGroup === 'send_back')
        .map((a) => a.outcomeKey);
      expect([...new Set(keys)], gate).toEqual(sendBacks);
    }
  });

  it('shows a label an Admin reworded as it is', () => {
    expect(sendBackDestination('Send back to the KAM')).toBe('The KAM');
    expect(sendBackDestination('send back to Pricing (re-cost)')).toBe('Pricing (re-cost)');
    expect(sendBackDestination('Return for more detail')).toBe('Return for more detail');
    expect(sendBackDestination('Send back to ')).toBe('Send back to');
  });
});

describe('noteHelp and notePlaceholder', () => {
  const help = (outcomeKey: string, outcomeGroup: Group | null, closesAs: string | null = null) =>
    noteHelp({ outcomeKey, outcomeGroup, closesAs });

  it('follows the group for a hold, a send-back and a stop', () => {
    expect(help('on_hold', 'hold')).toBe('Say what you are waiting for, and from whom.');
    // G2 and G3 "redirect" are send-backs now; the key no longer decides the hint.
    expect(help('redirect', 'send_back')).toBe('Say what needs to change, and where.');
    expect(help('recost', 'send_back')).toBe('Say what needs to change, and where.');
    expect(help('decline', 'stop', 'declined')).toBe('Say why it stops here.');
    // G1 "Stop: not CCQ work (send elsewhere)" closes as redirected.
    expect(help('redirect', 'stop', 'redirected')).toBe(
      'Say where the work goes instead, and why.',
    );
  });

  it('keeps the earlier wording for the other outcomes', () => {
    expect(help('proceed_with_risk', 'advance')).toBe(
      'Say what the risk is and how it is covered.',
    );
    expect(help('lost', 'customer_outcome', 'lost')).toBe('Say why it stops here.');
    expect(help('expired', 'customer_outcome', 'expired')).toBe('Say why it is expired now.');
    expect(help('rework', null)).toBe('Say what needs to change, and where.');
    expect(help('approve', 'advance')).toBe('Say why this decision was made.');
  });

  it('a send-back asks what needs fixing', () => {
    expect(notePlaceholder({ outcomeKey: 'redirect', outcomeGroup: 'send_back' })).toBe(
      'What needs fixing?',
    );
    expect(notePlaceholder({ outcomeKey: 'rework', outcomeGroup: null })).toBe(
      'What should the KAM fix?',
    );
    expect(notePlaceholder({ outcomeKey: 'hold', outcomeGroup: 'hold' })).toBeUndefined();
    expect(notePlaceholder(undefined)).toBeUndefined();
  });
});
