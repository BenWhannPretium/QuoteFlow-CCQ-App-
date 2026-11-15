import { describe, expect, it } from 'vitest';

import {
  HOLD_OWNER_DEFAULT_SEED,
  holdOwnerChoices,
  parseHoldOwnerDefault,
  type HoldOwnerInput,
} from './hold-owner';
import { settingSpec } from '../config-admin/settings';
import { DomainError } from '../errors';

/**
 * FB-17 (W13-25): the hold owner is the person who will clear the hold. Synthetic names only.
 */
const me = { id: 'u-lead', displayName: 'Lee Lead' };
const kam = { id: 'u-kam', displayName: 'Kim Kam' };
const engineer = { id: 'u-eng', displayName: 'Erin Engineer' };
const scheduler = { id: 'u-sched', displayName: 'Sam Scheduler' };
const pricer = { id: 'u-pricer', displayName: 'Pat Pricer' };

const pick = (input: Partial<HoldOwnerInput> & { stageKey: string }) => {
  const { choices, defaultChoice } = holdOwnerChoices({ me, kam, ...input });
  return { labels: choices.map((c) => c.label), kinds: choices.map((c) => c.kind), defaultChoice };
};

describe('who the hold-owner picker offers, and where it starts', () => {
  it('Engineering with an engineer only: the engineer first and by default', () => {
    const r = pick({ stageKey: 'ENG_REVIEW', engineer });
    expect(r.labels).toEqual(['The assigned engineer (Erin Engineer)', 'Me', 'The KAM (Kim Kam)']);
    expect(r.defaultChoice).toMatchObject({ id: 'u-eng', kind: 'engineer' });
  });

  it('Engineering with an engineer and a production scheduler: both offered, "Me" by default', () => {
    const r = pick({ stageKey: 'ENG_REVIEW', engineer, scheduler });
    expect(r.labels).toEqual([
      'The assigned engineer (Erin Engineer)',
      'The production scheduler (Sam Scheduler)',
      'Me',
      'The KAM (Kim Kam)',
    ]);
    // Two people work the stage, so the decider says which of them (or someone else) owns it.
    expect(r.defaultChoice).toMatchObject({ id: 'u-lead', kind: 'me' });
  });

  it('Engineering with only a production scheduler: the scheduler by default', () => {
    const r = pick({ stageKey: 'ENG_REVIEW', scheduler });
    expect(r.kinds).toEqual(['scheduler', 'me', 'kam']);
    expect(r.defaultChoice).toMatchObject({ id: 'u-sched', kind: 'scheduler' });
  });

  it('Quoting: the assigned pricer first and by default (the engineer worked an earlier stage)', () => {
    const r = pick({ stageKey: 'QUOTING', engineer, scheduler, pricer });
    expect(r.labels).toEqual(['The assigned pricer (Pat Pricer)', 'Me', 'The KAM (Kim Kam)']);
    expect(r.defaultChoice).toMatchObject({ id: 'u-pricer', kind: 'pricer' });
  });

  it('nobody assigned, or a stage that keeps no assignee: "Me", as before', () => {
    for (const stageKey of ['ENG_REVIEW', 'QUOTING']) {
      const r = pick({ stageKey });
      expect(r.labels, stageKey).toEqual(['Me', 'The KAM (Kim Kam)']);
      expect(r.defaultChoice.kind, stageKey).toBe('me');
    }
    for (const stageKey of ['INTAKE', 'FINAL_REVIEW', 'CUSTOMER_DECISION', 'COMMIT_HANDOFF']) {
      const r = pick({ stageKey, engineer, scheduler, pricer });
      expect(r.labels, stageKey).toEqual(['Me', 'The KAM (Kim Kam)']);
      expect(r.defaultChoice.kind, stageKey).toBe('me');
    }
  });

  it('lists a person once: an assignee who is the decider is "Me"; the KAM is not repeated', () => {
    const selfAssigned = pick({ stageKey: 'ENG_REVIEW', engineer: me });
    expect(selfAssigned.labels).toEqual(['Me', 'The KAM (Kim Kam)']);
    expect(selfAssigned.defaultChoice.kind).toBe('me');
    const both = pick({ stageKey: 'ENG_REVIEW', engineer, scheduler: engineer });
    expect(both.kinds).toEqual(['engineer', 'me', 'kam']);
    expect(both.defaultChoice.kind).toBe('engineer');
    // The KAM decides their own G5 hold: "Me" covers them.
    expect(holdOwnerChoices({ stageKey: 'CUSTOMER_DECISION', me: kam, kam }).choices).toEqual([
      { ...kam, kind: 'me', label: 'Me' },
    ]);
    expect(pick({ stageKey: 'QUOTING', pricer: kam }).kinds).toEqual(['pricer', 'me']);
    expect(pick({ stageKey: 'QUOTING', pricer, kam: null }).kinds).toEqual(['pricer', 'me']);
  });

  it('hold_owner_default = decider keeps the people and their order but starts on "Me"', () => {
    const r = pick({ stageKey: 'ENG_REVIEW', engineer, defaultTo: 'decider' });
    expect(r.kinds).toEqual(['engineer', 'me', 'kam']);
    expect(r.defaultChoice.kind).toBe('me');
  });
});

describe('hold_owner_default (setting)', () => {
  it('is seeded "stage_assignee" (provisional) and refuses anything unknown', () => {
    expect(HOLD_OWNER_DEFAULT_SEED).toBe('stage_assignee');
    expect(parseHoldOwnerDefault(undefined)).toBe('stage_assignee');
    expect(parseHoldOwnerDefault(null)).toBe('stage_assignee');
    expect(parseHoldOwnerDefault('decider')).toBe('decider');
    for (const bad of ['kam', '', 1, true, {}]) {
      expect(() => parseHoldOwnerDefault(bad), JSON.stringify(bad)).toThrow(DomainError);
    }
  });

  it('the Admin console knows it: a pick in the Workflow group, never "not set"', () => {
    const spec = settingSpec('hold_owner_default');
    expect(spec).toMatchObject({
      group: 'workflow',
      editor: 'select',
      options: ['stage_assignee', 'decider'],
    });
    expect(spec.parse('decider')).toBe('decider');
    expect(() => spec.parse(null)).toThrow(DomainError);
  });
});
