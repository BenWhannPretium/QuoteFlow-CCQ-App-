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
        // The production scheduler's own part, and a lead who works the quote themselves.
        if (step.part === 'capacity') {
          return 'add the capacity evidence, then approve capacity or block it with a note';
        }
        if (step.part === 'decide') return `complete the solution and capacity, then ${decision}`;
        return 'complete the solution and capacity, then submit to the engineering lead';
      }
      if (step.place === 'quoting') {
        if (step.part === 'decide') {
          return `complete the costing and the pricing record, then ${decision}`;
        }
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

interface OfferedAction {
  gateKey: string;
  missing: readonly { field: string; message: string }[];
}

/**
 * UX-003: is the reader offered a gate where nothing can be decided now? Read from the server's own
 * `availableActions`: every outcome it offers at the gate (Advance, Send back, Hold and Stop alike) lists
 * something missing that the decision dialog cannot supply, so the server would refuse each of them.
 * One open outcome is enough to keep the decision: a blocked Advance with Hold still possible is not
 * blocked. `missing` is what every outcome lacks (the gate's own precondition).
 */
export function blockedDecision(
  actions: readonly OfferedAction[],
  gateKey: string,
): { blocked: boolean; missing: readonly { field: string; message: string }[] } {
  const offered = actions.filter((a) => a.gateKey === gateKey);
  const blocked = offered.length > 0 && offered.every((a) => a.missing.length > 0);
  if (!blocked) return { blocked: false, missing: [] };
  const [first, ...rest] = offered;
  const shared = first!.missing.filter((m) =>
    rest.every((a) => a.missing.some((x) => x.field === m.field && x.message === m.message)),
  );
  return { blocked: true, missing: shared.length > 0 ? shared : first!.missing };
}

/**
 * UX-003: what a reader sees in place of the decision button on a gate where nothing can be decided.
 * Back with the KAM (the server's `rework` state): since when, and what ends it. Any other precondition:
 * what is still needed, in the server's own words. `since` is already formatted for display.
 */
export function nothingToDecideText(
  step: Pick<QuoteNextStep, 'state'> | undefined,
  missing: readonly { message: string }[],
  since: string | null,
): string {
  if (step?.state === 'rework') {
    return `Back with the KAM for rework${since ? ` since ${since}` : ''}. Nothing to decide until it is resubmitted.`;
  }
  const needed = missing.map((m) => m.message).join('; ');
  return needed ? `Nothing to decide yet. Still needed: ${needed}.` : 'Nothing to decide yet.';
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
