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

/** The outcomes that move a quote forward out of a work stage (the rest hold it, send it back or stop it). */
const FORWARD_OUTCOMES: Record<string, readonly string[]> = {
  G2: ['proceed', 'proceed_with_risk', 'capital_required'],
  G3: ['submit'],
};

interface ActionLike {
  gateKey: string;
  outcomeKey: string;
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
  const forward = forGate.filter((a) => forwardKeys.includes(a.outcomeKey));
  return {
    ready: forward.some((a) => a.missing.length === 0),
    // What the plain "advance" outcome (the first one) still needs.
    missing: forward[0]?.missing ?? [],
    others: forGate.filter((a) => !forwardKeys.includes(a.outcomeKey)).map((a) => a.outcomeKey),
  };
}
