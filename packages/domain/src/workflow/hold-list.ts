import type { WorkflowConfig } from '../types/workflow-config';

/**
 * FB-18 (W13-26, the Command Center half; Zachary Cairns and Bailey Schmitt, 2026-11-13): a KAM could
 * not tell that one of their quotes was on hold. The Command Center lists now mark an on-hold quote and
 * put it first, and say why it is held in the same words as the quote header and the timeline (FB-17).
 * These are the two rules behind that, so the API has one copy of each.
 */

/**
 * Why a quote is on hold, in words: the label of the hold's reason code, looked up in the reason
 * contexts the workflow's hold outcomes use (an outcome whose transition puts the quote on hold). A code
 * that is in none of them is shown as it is; no code is null.
 *
 * FB-17 wrote this lookup inside the API's commercial view. It moved here unchanged so the quote header
 * and the Command Center read one rule.
 */
export function holdReasonLabel(
  workflow: Pick<WorkflowConfig, 'transitions' | 'outcomes' | 'reasonCodes'>,
  reasonCode: string | null | undefined,
): string | null {
  if (!reasonCode) return null;
  const contexts = new Set(
    workflow.transitions
      .filter((t) => t.nextStatus === 'on_hold')
      .map(
        (t) =>
          workflow.outcomes.find((o) => o.gateKey === t.gateKey && o.key === t.outcomeKey)
            ?.reasonContext,
      ),
  );
  return (
    workflow.reasonCodes.find((r) => r.code === reasonCode && contexts.has(r.context))?.label ??
    reasonCode
  );
}

/** The quote status that means "on hold" (`quote.status`). */
export const ON_HOLD_STATUS = 'on_hold';

/**
 * A list order that puts on-hold quotes first and keeps `then` (oldest first, say) inside each group.
 * The lists are per stage, so this is "first within its stage".
 */
export function onHoldFirst<T extends { status: string }>(
  then: (a: T, b: T) => number,
): (a: T, b: T) => number {
  return (a, b) => {
    const held = Number(b.status === ON_HOLD_STATUS) - Number(a.status === ON_HOLD_STATUS);
    return held !== 0 ? held : then(a, b);
  };
}
