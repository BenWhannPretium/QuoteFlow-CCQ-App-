import type { OutcomeRates, PublicConfigResponse } from '@ccq/contracts';

import { fmtCount } from '@/components/charts/format';

/**
 * UX-013: plain words on the Command Center where the screen showed an internal term ("SF amount",
 * "gone dark", a gate number). Wording only: every number still comes from the dashboard response.
 */

/**
 * What a stage total is a sum of. "Salesforce opportunity amount" is how the Analytics view and the
 * pipeline board already describe it; "SF" was never spelled out.
 */
export const STAGE_AMOUNT_WORDS = 'Salesforce opportunity amount';

/**
 * The line under a KAM's outcome capture rate: how many proposals have an outcome, how many are past
 * their validity date with none, and how many are still inside validity.
 */
export function captureHint(r: Pick<OutcomeRates, 'recorded' | 'goneDark' | 'awaiting'>): string {
  if (r.recorded + r.goneDark === 0) {
    return 'No proposals are past their validity yet, so there is nothing to measure.';
  }
  return `${fmtCount(r.recorded)} recorded, ${fmtCount(r.goneDark)} past validity with no outcome recorded, ${fmtCount(r.awaiting)} still waiting.`;
}

/**
 * A gate by its configured label ("Qualify & prioritize"), for text a user reads. Null while the
 * configuration is loading or when it has no such gate: the caller then leaves the gate out, and never
 * shows the gate's key (G1) in its place.
 */
export function gateLabel(
  config: Pick<PublicConfigResponse, 'gates'> | undefined,
  gateKey: string | null | undefined,
): string | null {
  if (!gateKey) return null;
  return config?.gates.find((g) => g.key === gateKey)?.label ?? null;
}

/**
 * Where a quote was sent back from, as words to put after `lead` ("Returned at Qualify & prioritize",
 * " · returned at Qualify & prioritize"); empty while the gate's label is not known.
 */
export function returnedAt(
  config: Pick<PublicConfigResponse, 'gates'> | undefined,
  gateKey: string | null | undefined,
  lead: string,
): string {
  const label = gateLabel(config, gateKey);
  return label ? `${lead}${label}` : '';
}
