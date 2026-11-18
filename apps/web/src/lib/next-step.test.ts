import type { QuoteNextStep } from '@ccq/contracts';
import { describe, expect, it } from 'vitest';

import { blockedDecision, nextStepLine, nothingToDecideText } from './next-step';

const step = (over: Partial<QuoteNextStep>): QuoteNextStep => ({
  waitingOn: 'nobody',
  personName: null,
  state: 'at_gate',
  since: null,
  gateKey: null,
  place: null,
  yourMove: false,
  hold: null,
  ...over,
});

describe('nextStepLine', () => {
  it('rework: names the KAM for everyone else, and gives the KAM the way in', () => {
    const rework = step({
      waitingOn: 'kam',
      personName: 'Dana Whitfield',
      state: 'rework',
      gateKey: 'G1',
      place: 'intake',
    });
    expect(nextStepLine(rework)).toEqual({
      text: 'Waiting on: the KAM (Dana Whitfield). Next: fix the intake and resubmit.',
      action: null,
    });
    expect(nextStepLine({ ...rework, yourMove: true })).toEqual({
      text: 'Waiting on you. Next: fix the intake and resubmit.',
      action: { kind: 'rework', label: 'Fix and resubmit' },
    });
  });

  it('unassigned: the lead assigns, on the stage’s own tab', () => {
    const eng = step({
      waitingOn: 'engineering_lead',
      state: 'unassigned',
      gateKey: 'G2',
      place: 'engineering',
    });
    expect(nextStepLine(eng).text).toBe(
      'Waiting on: the engineering lead. Next: assign an engineer.',
    );
    expect(nextStepLine({ ...eng, yourMove: true })).toEqual({
      text: 'Waiting on you. Next: assign an engineer.',
      action: { kind: 'tab', tab: 'engineering', label: 'Open the Engineering tab' },
    });
    expect(
      nextStepLine(
        step({
          waitingOn: 'pricing_lead',
          state: 'unassigned',
          place: 'quoting',
          yourMove: true,
        }),
      ),
    ).toEqual({
      text: 'Waiting on you. Next: assign a pricer.',
      action: { kind: 'tab', tab: 'quoting', label: 'Open the Quoting tab' },
    });
  });

  it('in progress: the assignee by name, and what they do next', () => {
    expect(
      nextStepLine(
        step({
          waitingOn: 'engineering',
          personName: 'V. Carroll',
          state: 'in_progress',
          place: 'engineering',
        }),
      ).text,
    ).toBe(
      'Waiting on: Engineering (V. Carroll). Next: complete the solution and capacity, then submit to the engineering lead.',
    );
    expect(
      nextStepLine(
        step({
          waitingOn: 'pricing',
          personName: 'Kyle Arnold',
          state: 'in_progress',
          place: 'quoting',
        }),
      ).text,
    ).toBe(
      'Waiting on: Pricing (Kyle Arnold). Next: complete the costing and the pricing record, then submit to the pricing lead.',
    );
    expect(
      nextStepLine(step({ waitingOn: 'finance', state: 'in_progress', place: 'quoting' })).text,
    ).toBe('Waiting on: Finance. Next: upload the payback model.');
  });

  it('the two other people who work a stage: the scheduler’s capacity, and a lead who is the assignee', () => {
    const scheduler = nextStepLine(
      step({
        waitingOn: 'engineering',
        personName: 'V. Carroll',
        state: 'in_progress',
        place: 'engineering',
        yourMove: true,
        part: 'capacity',
      }),
    );
    expect(scheduler.text).toBe(
      'Waiting on you. Next: add the capacity evidence, then approve capacity or block it with a note.',
    );
    expect(scheduler.action).toEqual({
      kind: 'tab',
      tab: 'engineering',
      label: 'Open the Engineering tab',
    });
    // A lead working the quote themselves has no one to submit to: the step ends in the decision.
    expect(
      nextStepLine(
        step({
          waitingOn: 'engineering',
          state: 'in_progress',
          place: 'engineering',
          gateKey: 'G2',
          yourMove: true,
          part: 'decide',
        }),
      ).text,
    ).toBe('Waiting on you. Next: complete the solution and capacity, then decide feasibility.');
    expect(
      nextStepLine(
        step({
          waitingOn: 'pricing',
          state: 'in_progress',
          place: 'quoting',
          gateKey: 'G3',
          yourMove: true,
          part: 'decide',
        }),
      ).text,
    ).toBe(
      'Waiting on you. Next: complete the costing and the pricing record, then decide price approval.',
    );
  });

  it('with the lead: review, then the gate’s own decision, in the words of its button', () => {
    expect(
      nextStepLine(
        step({
          waitingOn: 'engineering_lead',
          state: 'with_lead',
          gateKey: 'G2',
          place: 'engineering',
        }),
      ).text,
    ).toBe(
      'Waiting on: the engineering lead. Next: review the submitted work, then decide feasibility or send it back.',
    );
  });

  it('at a gate: the decision by its button name; no second button (the header has it)', () => {
    expect(
      nextStepLine(
        step({ waitingOn: 'sales_leader', gateKey: 'G1', place: 'decision', yourMove: true }),
      ),
    ).toEqual({ text: 'Waiting on you. Next: qualify quote.', action: null });
    expect(
      nextStepLine(step({ waitingOn: 'customer', gateKey: 'G5', place: 'decision' })).text,
    ).toBe('Waiting on: the customer. Next: record customer decision.');
    // A gate added in the admin console is named by its configured label.
    expect(
      nextStepLine(
        step({ waitingOn: 'approver', gateKey: 'G9', place: 'decision' }),
        'Legal sign-off',
      ).text,
    ).toBe('Waiting on: the approver. Next: decide: Legal sign-off.');
  });

  it('on hold: the hold sentence (reason, owner, review date), and whose decision ends it', () => {
    expect(
      nextStepLine(
        step({
          waitingOn: 'engineering_lead',
          state: 'on_hold',
          gateKey: 'G2',
          hold: {
            reviewDate: '2026-12-01',
            ownerName: 'Avery Stone',
            reasonLabel: 'Awaiting internal input',
          },
        }),
      ),
    ).toEqual({
      text: 'On hold: Awaiting internal input. Owner: Avery Stone. Review by Dec 1, 2026. A decision by the engineering lead ends the hold.',
      action: null,
    });
    // A hold from before the reason and owner were recorded.
    expect(nextStepLine(step({ waitingOn: 'nobody', state: 'on_hold' })).text).toBe('On hold.');
  });

  it('closed: no next step', () => {
    expect(nextStepLine(step({ state: 'closed' }))).toEqual({
      text: 'Closed. No next step.',
      action: null,
    });
  });
});

describe('blockedDecision (UX-003)', () => {
  const submit = { field: 'submitted_at', message: 'The intake, submitted by the KAM' };
  const volume = { field: 'est_annual_volume', message: 'Annual volume or revenue' };

  it('is blocked only when every outcome the reader is offered at the gate lacks something', () => {
    // A reworked quote at G1: the gate's own precondition fails for Advance, Send back, Hold and Stop.
    expect(
      blockedDecision(
        [
          { gateKey: 'G1', missing: [submit, volume] },
          { gateKey: 'G1', missing: [submit] },
          { gateKey: 'G1', missing: [submit] },
        ],
        'G1',
      ),
    ).toEqual({ blocked: true, missing: [submit] });
  });

  it('keeps the decision while one outcome is open: Advance blocked, Hold possible', () => {
    expect(
      blockedDecision(
        [
          { gateKey: 'G2', missing: [volume] },
          { gateKey: 'G2', missing: [] },
        ],
        'G2',
      ),
    ).toEqual({ blocked: false, missing: [] });
  });

  it('a gate the reader is not offered is not blocked: there is nothing to replace', () => {
    expect(blockedDecision([{ gateKey: 'G1', missing: [submit] }], 'G2').blocked).toBe(false);
    expect(blockedDecision([], 'G1').blocked).toBe(false);
  });

  it('with nothing in common, it lists what the first outcome lacks', () => {
    expect(
      blockedDecision(
        [
          { gateKey: 'G1', missing: [volume] },
          { gateKey: 'G1', missing: [submit] },
        ],
        'G1',
      ).missing,
    ).toEqual([volume]);
  });
});

describe('nothingToDecideText (UX-003)', () => {
  it('back with the KAM: since when, and what ends it', () => {
    expect(nothingToDecideText({ state: 'rework' }, [], 'Nov 12, 2026, 3:04 PM CST')).toBe(
      'Back with the KAM for rework since Nov 12, 2026, 3:04 PM CST. Nothing to decide until it is resubmitted.',
    );
    expect(nothingToDecideText({ state: 'rework' }, [], null)).toBe(
      'Back with the KAM for rework. Nothing to decide until it is resubmitted.',
    );
  });

  it('any other precondition: what is still needed, in the server’s words', () => {
    expect(
      nothingToDecideText({ state: 'at_gate' }, [{ message: 'A' }, { message: 'B' }], null),
    ).toBe('Nothing to decide yet. Still needed: A; B.');
    expect(nothingToDecideText(undefined, [], null)).toBe('Nothing to decide yet.');
  });
});
