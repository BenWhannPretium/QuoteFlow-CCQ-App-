/**
 * What the button that opens a gate's decision says. A gate's configured label names the gate
 * ("Feasible solution?", "Price approved"); a button names what you are about to do. One wording per
 * gate, used by every button that opens that decision, so the same action never has two names.
 * A gate added in the admin console falls back to "Decide: <its label>".
 */
const DECISION_LABELS: Record<string, string> = {
  G1: 'Qualify quote',
  G2: 'Decide feasibility',
  G3: 'Decide price approval',
  G4: 'Decide Final Review',
  G5: 'Record customer decision',
  G6: 'Commit and hand off',
  SUBMIT: 'Submit to Engineering',
};

export function decisionLabel(gateKey: string, gateLabel?: string | null): string {
  return DECISION_LABELS[gateKey] ?? `Decide: ${gateLabel ?? gateKey}`;
}

/**
 * What the button for the decisions that do not move a quote forward says, and the title of the dialog
 * it opens. A quote already on hold is not offered Hold again (UX-004), so the button does not name it.
 */
export const otherDecisionsLabel = (onHold: boolean): string =>
  onHold ? 'Send back or stop' : 'Send back, hold or stop';

/**
 * The gates decided on a work tab (Engineering, Quoting). FB-17 (W13-23): an outcome moves the quote
 * forward when its group is `advance` (config, on every available action). The keys listed here are read
 * only for an action that carries no group; `capital_required` stays listed for that case although the
 * outcome is switched off (W13-22) and no longer offered.
 */
const FORWARD_OUTCOMES: Record<string, readonly string[]> = {
  G2: ['proceed', 'proceed_with_risk', 'capital_required'],
  G3: ['submit'],
};

interface ActionLike {
  gateKey: string;
  outcomeKey: string;
  outcomeGroup?: string | null;
  missing: readonly { field: string; message: string }[];
}

/**
 * Bailey Schmitt (2026-11-12): the button that moves a quote forward appears only once the work it needs is
 * filled in, so seeing it means "you can move this on". For the gates decided on a work tab (Engineering,
 * Quoting) this says whether a forward outcome has nothing missing, and what the main one still needs.
 * Other gates have no work tab and are always ready to open.
 */
export function forwardReadiness(
  actions: readonly ActionLike[],
  gateKey: string,
): { ready: boolean; missing: readonly { field: string; message: string }[]; others: string[] } {
  const forGate = actions.filter((a) => a.gateKey === gateKey);
  const forwardKeys = FORWARD_OUTCOMES[gateKey];
  if (!forwardKeys) return { ready: true, missing: [], others: [] };
  const isForward = (a: ActionLike) =>
    a.outcomeGroup ? a.outcomeGroup === 'advance' : forwardKeys.includes(a.outcomeKey);
  const forward = forGate.filter(isForward);
  return {
    ready: forward.some((a) => a.missing.length === 0),
    // What the plain "advance" outcome (the first one) still needs.
    missing: forward[0]?.missing ?? [],
    others: forGate.filter((a) => !isForward(a)).map((a) => a.outcomeKey),
  };
}
