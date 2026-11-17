import type { QuoteNextStep } from '@ccq/contracts';
import { describe, expect, it } from 'vitest';

import { nextStepLine } from './next-step';

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
