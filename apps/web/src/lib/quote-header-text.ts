/**
 * UX-013: plain words for the quote header, where the page showed internal shorthand ("at G1",
 * "2 visits"). Gate names are never written here: the caller passes the label from the workflow config.
 */

/**
 * The headline of the rework banner: "Returned by Sam Reyes at Qualify & prioritize". `gateLabel` is the
 * configured label of the gate that sent the quote back; `decidedByName` is who decided, when known.
 */
export function reworkHeadline(decidedByName: string | null, gateLabel: string): string {
  return decidedByName
    ? `Returned by ${decidedByName} at ${gateLabel}`
    : `Returned for rework at ${gateLabel}`;
}

/**
 * Under "Time in stage": how often the quote has been in a stage, when more than once ("entered this
 * stage twice"). Null for a single stay: nothing to say.
 */
export function stageEntriesText(visits: number): string | null {
  if (visits <= 1) return null;
  return visits === 2 ? 'entered this stage twice' : `entered this stage ${visits} times`;
}
