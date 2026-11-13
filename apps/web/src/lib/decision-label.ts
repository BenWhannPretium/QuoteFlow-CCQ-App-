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
