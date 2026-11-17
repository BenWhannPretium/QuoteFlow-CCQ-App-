import type { QuoteNextStep } from '@ccq/contracts';

import { decisionLabel } from './decision-label';
import { holdSummary } from './hold-text';

/**
 * UX-002: the "whose move is it" line under the stage tracker of a quote, worded from the server's
 * facts (`QuoteDetail.nextStep`). The server says who is waited on and whether it is the reader's move;
 * this file only chooses the words. The gate's own name comes from the workflow config (`gateLabel`).
 */

/** A role in plain words, as it reads after "Waiting on:". */
const PARTY: Record<QuoteNextStep['waitingOn'], string> = {
  kam: 'the KAM',
  sales_leader: 'the sales leader',
  engineering: 'Engineering',
  engineering_lead: 'the engineering lead',
  pricing: 'Pricing',
  pricing_lead: 'the pricing lead',
  finance: 'Finance',
  approver: 'the approver',
  leadership: 'Leadership',
  customer: 'the customer',
  nobody: 'nobody',
};

export type NextStepAction =
  /** The KAM opens the rework draft (the intake wizard). */
  | { kind: 'rework'; label: string }
  /** A work tab of the quote page. */
  | { kind: 'tab'; tab: 'engineering' | 'quoting'; label: string };

export interface NextStepLine {
  text: string;
  /** Where the reader makes their move; null when it is not theirs, or the page header already offers it. */
  action: NextStepAction | null;
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** What happens next, to follow "Next:" (no capital, no full stop); null when there is nothing to say. */
function nextText(step: QuoteNextStep, gateLabel: string | null | undefined): string | null {
  // The same words as the button that opens the gate's decision ("Decide feasibility").
  const decision = step.gateKey ? lowerFirst(decisionLabel(step.gateKey, gateLabel)) : 'decide';
  switch (step.state) {
    case 'rework':
      return 'fix the intake and resubmit';
    case 'unassigned':
      return step.place === 'quoting' ? 'assign a pricer' : 'assign an engineer';
    case 'in_progress':
      if (step.waitingOn === 'finance') return 'upload the payback model';
      if (step.place === 'engineering') {
        return 'complete the solution and capacity, then submit to the engineering lead';
      }
      if (step.place === 'quoting') {
        return 'complete the costing and the pricing record, then submit to the pricing lead';
      }
      return null;
    case 'with_lead':
      return `review the submitted work, then ${decision} or send it back`;
    case 'at_gate':
      return decision;
    default:
      return null;
  }
}

function actionFor(step: QuoteNextStep): NextStepAction | null {
  if (!step.yourMove) return null;
  switch (step.place) {
    case 'intake':
      return { kind: 'rework', label: 'Fix and resubmit' };
    case 'engineering':
      return { kind: 'tab', tab: 'engineering', label: 'Open the Engineering tab' };
    case 'quoting':
      return { kind: 'tab', tab: 'quoting', label: 'Open the Quoting tab' };
    // A gate decided in its own dialog or screen: the button is in the page header.
    default:
      return null;
  }
}

export function nextStepLine(
  step: QuoteNextStep,
  /** The configured label of `step.gateKey` (public config). */
  gateLabel?: string | null,
): NextStepLine {
  if (step.state === 'closed') return { text: 'Closed. No next step.', action: null };
  if (step.state === 'on_hold') {
    const hold = holdSummary(step.hold ?? {});
    const sentence = hold.endsWith('.') ? hold : `${hold}.`;
    const ends =
      step.waitingOn === 'nobody' ? '' : ` A decision by ${PARTY[step.waitingOn]} ends the hold.`;
    return { text: `${sentence}${ends}`, action: null };
  }
  const who = step.yourMove
    ? 'Waiting on you.'
    : `Waiting on: ${PARTY[step.waitingOn]}${step.personName ? ` (${step.personName})` : ''}.`;
  const next = nextText(step, gateLabel);
  return { text: next ? `${who} Next: ${next}.` : who, action: actionFor(step) };
}
