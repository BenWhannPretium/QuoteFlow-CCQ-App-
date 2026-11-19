import { describe, expect, it } from 'vitest';

import { isNewToReader } from '../engineering/queue';
import { canEditCapacity, canEditEngReview } from '../engineering/review';
import { NOW, makeActor, makeQuote, validCase } from '../test-utils';
import {
  EMPTY_LEAD_REVIEW,
  canReturnToAssignee,
  canSubmitCapacityToLead,
  canSubmitToLead,
  capacityLockedFor,
  capacitySubmissionRules,
  engineeringParts,
  engineeringReviewStatus,
  leadNoticeDue,
  parseEngLeadNotifyWhen,
  planReturnToAssignee,
  planSubmitCapacityToLead,
  planSubmitToLead,
  submissionRules,
  assigneeExclusions,
  type LeadReviewState,
} from './index';
import { asUserId } from '../types/ids';
import { availableActions } from '../workflow/available-actions';
import { hybridConfig } from '../workflow/seeds/hybrid';

const ENGINEER = asUserId('user-engineer');
const SCHEDULER = asUserId('user-scheduler');
const LEAD = asUserId('user-lead');
const engineer = makeActor('Engineer', { userId: ENGINEER });
const scheduler = makeActor('ProductionScheduler', { userId: SCHEDULER });
const otherScheduler = makeActor('ProductionScheduler');
const engLead = makeActor('EngLead', { userId: LEAD });
// D2: a person who holds both roles, assigned to themselves as the engineer.
const leadEngineer = makeActor(['EngLead', 'Engineer'], { userId: ENGINEER });

const q = (overrides = {}) =>
  makeQuote('ENG_REVIEW', {
    assignedEngineerId: ENGINEER,
    assignedSchedulerId: SCHEDULER,
    ...overrides,
  });
const noScheduler = (overrides = {}) =>
  makeQuote('ENG_REVIEW', { assignedEngineerId: ENGINEER, ...overrides });

const engIn: LeadReviewState = { ...EMPTY_LEAD_REVIEW, submittedAt: NOW, submittedBy: ENGINEER };
const capIn: LeadReviewState = {
  ...EMPTY_LEAD_REVIEW,
  capacitySubmittedAt: NOW,
  capacitySubmittedBy: SCHEDULER,
};
const bothIn: LeadReviewState = {
  ...engIn,
  capacitySubmittedAt: NOW,
  capacitySubmittedBy: SCHEDULER,
};

describe('FB-22: two parts, one review', () => {
  it('engineer only: not ready while a scheduler is assigned', () => {
    const parts = engineeringParts(q(), engIn, false);
    expect(parts.engineer.in).toBe(true);
    expect(parts.scheduler?.in).toBe(false);
    expect(parts.ready).toBe(false);
    expect(engineeringReviewStatus(q(), engIn, parts)).toBe('none');
  });

  it('scheduler only: not ready until the engineer submits', () => {
    const parts = engineeringParts(q(), capIn, false);
    expect(parts.engineer.in).toBe(false);
    expect(parts.scheduler?.in).toBe(true);
    expect(parts.ready).toBe(false);
  });

  it('both: ready for lead review', () => {
    const parts = engineeringParts(q(), bothIn, false);
    expect(parts.ready).toBe(true);
    expect(engineeringReviewStatus(q(), bothIn, parts)).toBe('submitted');
  });

  it('no scheduler assigned: the engineer’s part alone is the review', () => {
    const parts = engineeringParts(noScheduler(), engIn, false);
    expect(parts.scheduler).toBeNull();
    expect(parts.ready).toBe(true);
    expect(engineeringParts(noScheduler(), EMPTY_LEAD_REVIEW, false).ready).toBe(false);
  });

  it('D2: a lead who is the engineer needs no submit; the scheduler’s submit makes it ready', () => {
    const before = engineeringParts(q(), EMPTY_LEAD_REVIEW, true);
    expect(before.engineer.in).toBe(true);
    expect(before.engineer.ownerIsLead).toBe(true);
    expect(before.ready).toBe(false);
    expect(engineeringParts(q(), capIn, true).ready).toBe(true);
    // With no scheduler there is nothing to review: the lead just decides.
    expect(engineeringParts(noScheduler(), EMPTY_LEAD_REVIEW, true).ready).toBe(false);
    expect(canSubmitToLead('engineering', leadEngineer, q(), EMPTY_LEAD_REVIEW)).toBe(false);
  });

  it('the lead is told when both are in (seed), or on each part', () => {
    expect(parseEngLeadNotifyWhen(undefined)).toBe('both_parts');
    expect(parseEngLeadNotifyWhen('nonsense')).toBe('both_parts');
    expect(parseEngLeadNotifyWhen('each_part')).toBe('each_part');
    const partial = engineeringParts(q(), engIn, false);
    const ready = engineeringParts(q(), bothIn, false);
    expect(leadNoticeDue('both_parts', partial)).toBe(false);
    expect(leadNoticeDue('both_parts', ready)).toBe(true);
    expect(leadNoticeDue('each_part', partial)).toBe(true);
  });
});

describe('FB-22: who may submit the capacity part', () => {
  it('the assigned scheduler, in the stage, once; not the engineer, another scheduler or a lead', () => {
    expect(canSubmitCapacityToLead(scheduler, q(), EMPTY_LEAD_REVIEW)).toBe(true);
    expect(canSubmitCapacityToLead(scheduler, q(), capIn)).toBe(false);
    expect(canSubmitCapacityToLead(otherScheduler, q(), EMPTY_LEAD_REVIEW)).toBe(false);
    expect(canSubmitCapacityToLead(engineer, q(), EMPTY_LEAD_REVIEW)).toBe(false);
    expect(canSubmitCapacityToLead(engLead, q(), EMPTY_LEAD_REVIEW)).toBe(false);
    expect(canSubmitCapacityToLead(scheduler, q({ stageKey: 'QUOTING' }), EMPTY_LEAD_REVIEW)).toBe(
      false,
    );
    expect(canSubmitCapacityToLead(scheduler, noScheduler(), EMPTY_LEAD_REVIEW)).toBe(false);
  });

  it('is checked against the capacity rules only, without the lead’s sign-off', () => {
    const rules = capacitySubmissionRules(hybridConfig);
    const text = JSON.stringify(rules);
    expect(text).toContain('capacity_evidence');
    expect(text).not.toContain('capacity_signoff_status');
    expect(text).not.toContain('plant_code');
    const plan = planSubmitCapacityToLead(scheduler, q(), EMPTY_LEAD_REVIEW, hybridConfig, {});
    expect(!plan.ok && plan.errors.map((e) => e.field)).toContain('capacity_evidence');
    const g2 = validCase(hybridConfig, 'G2', 'proceed');
    expect(
      planSubmitCapacityToLead(scheduler, q(), EMPTY_LEAD_REVIEW, hybridConfig, g2.fields).ok,
    ).toBe(true);
    const code = (p: ReturnType<typeof planSubmitCapacityToLead>) => !p.ok && p.errors[0]!.code;
    expect(code(planSubmitCapacityToLead(scheduler, q(), capIn, hybridConfig, g2.fields))).toBe(
      'ALREADY_SUBMITTED',
    );
    expect(
      code(
        planSubmitCapacityToLead(otherScheduler, q(), EMPTY_LEAD_REVIEW, hybridConfig, g2.fields),
      ),
    ).toBe('NOT_PERMITTED');
  });

  it('the engineer’s submit leaves the capacity rows to the scheduler when one is assigned', () => {
    expect(assigneeExclusions('engineering', q())).toContain('capacity_evidence');
    expect(assigneeExclusions('engineering', noScheduler())).toEqual([]);
    expect(
      JSON.stringify(submissionRules('engineering', hybridConfig, ['capacity_evidence'])),
    ).not.toContain('capacity_evidence');
    const g2 = validCase(hybridConfig, 'G2', 'proceed');
    const { capacity_signoff_status: _s, capacity_evidence: _c, ...noRows } = g2.fields;
    expect(
      planSubmitToLead('engineering', engineer, q(), EMPTY_LEAD_REVIEW, hybridConfig, noRows).ok,
    ).toBe(true);
    expect(
      planSubmitToLead(
        'engineering',
        engineer,
        noScheduler(),
        EMPTY_LEAD_REVIEW,
        hybridConfig,
        noRows,
      ).ok,
    ).toBe(false);
  });
});

describe('FB-22: locks per part', () => {
  it('the scheduler’s submission locks the rows for everyone but the lead', () => {
    const sent = q({ capacitySubmittedAt: NOW });
    expect(canEditCapacity(scheduler, sent, hybridConfig)).toBe(false);
    expect(canEditCapacity(engineer, sent, hybridConfig)).toBe(false);
    expect(canEditCapacity(engLead, sent, hybridConfig)).toBe(true);
    // The engineer's own part stays open.
    expect(canEditEngReview(engineer, sent, hybridConfig)).toBe(true);
  });

  it('the engineer’s submission locks the engineer, not the scheduler', () => {
    const sent = q({ engSubmittedAt: NOW });
    expect(canEditEngReview(engineer, sent, hybridConfig)).toBe(false);
    expect(canEditCapacity(engineer, sent, hybridConfig)).toBe(false);
    expect(canEditCapacity(scheduler, sent, hybridConfig)).toBe(true);
    expect(capacityLockedFor(engLead, sent)).toBe(false);
    // No scheduler: the engineer's submission covers the rows.
    expect(canEditCapacity(engineer, noScheduler({ engSubmittedAt: NOW }), hybridConfig)).toBe(
      false,
    );
  });
});

describe('FB-22: send-back per part', () => {
  it('a lead may send back once either part is in', () => {
    expect(canReturnToAssignee('engineering', engLead, q(), capIn)).toBe(true);
    expect(canReturnToAssignee('engineering', engLead, q(), engIn)).toBe(true);
    expect(canReturnToAssignee('engineering', engLead, q(), EMPTY_LEAD_REVIEW)).toBe(false);
    expect(
      planReturnToAssignee('engineering', engLead, q(), capIn, 'Recheck line 4', 'scheduler').ok,
    ).toBe(true);
  });

  it('the status reads "returned" until the person it went to submits again', () => {
    // Sent back to the scheduler while the engineer's part stays in.
    const toScheduler: LeadReviewState = {
      ...engIn,
      returnedAt: NOW,
      returnedBy: LEAD,
      returnNote: 'x',
      returnedTo: SCHEDULER,
    };
    expect(
      engineeringReviewStatus(q(), toScheduler, engineeringParts(q(), toScheduler, false)),
    ).toBe('returned');
    const resubmitted = { ...toScheduler, capacitySubmittedAt: NOW };
    expect(
      engineeringReviewStatus(q(), resubmitted, engineeringParts(q(), resubmitted, false)),
    ).toBe('submitted');
    // Sent back to the engineer, who resubmits before the scheduler: no stale "sent back" line.
    const toEngineer: LeadReviewState = {
      ...EMPTY_LEAD_REVIEW,
      submittedAt: NOW,
      returnedAt: NOW,
      returnedTo: ENGINEER,
    };
    expect(engineeringReviewStatus(q(), toEngineer, engineeringParts(q(), toEngineer, false))).toBe(
      'none',
    );
  });
});

describe('FB-22: "New" in the engineering queue', () => {
  const row = {
    assignedEngineerId: ENGINEER as string,
    assignedSchedulerId: SCHEDULER as string,
    acceptedAt: null,
    capacityRowCount: 0,
  };
  it('new to the engineer until Start review; to the scheduler until a capacity row', () => {
    expect(isNewToReader(ENGINEER, row)).toBe(true);
    expect(isNewToReader(ENGINEER, { ...row, acceptedAt: NOW })).toBe(false);
    expect(isNewToReader(SCHEDULER, row)).toBe(true);
    expect(isNewToReader(SCHEDULER, { ...row, capacityRowCount: 1 })).toBe(false);
    // The lead and anyone else never see "New".
    expect(isNewToReader(LEAD, row)).toBe(false);
  });
});

describe('D2: an engineering lead decides G2 on their own work', () => {
  it('G2 is offered to the lead who is the assigned engineer, with no segregation rule against it', () => {
    const quote = makeQuote('ENG_REVIEW', { assignedEngineerId: ENGINEER });
    expect(
      availableActions(hybridConfig, quote, leadEngineer)
        .filter((a) => a.gateKey === 'G2')
        .map((a) => a.outcomeKey),
    ).toContain('proceed');
  });
});
