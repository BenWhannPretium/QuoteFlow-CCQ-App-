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
 * UX-014: a quote number that could not be opened. One wording for "no such quote" and "outside your
 * scope" (the server answers both the same way), so the page never says whether the quote exists.
 */
export function quoteNotFoundText(quoteNumber: string): { title: string; message: string } {
  return {
    title: `We could not find ${quoteNumber}, or it is outside what your role can see.`,
    message: 'Check the number, or search from the Pipeline.',
  };
}

/**
 * UX-014: the server's id for a failed request (`traceId` on every problem response), which support
 * can look up in the logs. Null when the response carries none. Never the API path.
 */
export function requestReference(problem: unknown): string | null {
  const id = (problem as { traceId?: unknown } | null | undefined)?.traceId;
  return typeof id === 'string' && id.trim() !== '' ? id : null;
}

/**
 * Under "Time in stage": how often the quote has been in a stage, when more than once ("entered this
 * stage twice"). Null for a single stay: nothing to say.
 */
export function stageEntriesText(visits: number): string | null {
  if (visits <= 1) return null;
  return visits === 2 ? 'entered this stage twice' : `entered this stage ${visits} times`;
}

/**
 * UX-013: what a closed quote says beside its stage. The outcome by the server's label ("Declined"),
 * or, when the quote carries none, the stored key in plain words. Never the raw key ("declined",
 * "no_response").
 */
export function closedText(
  outcome: string | null | undefined,
  outcomeLabel: string | null | undefined,
): string {
  if (!outcome) return 'Closed';
  const words = outcomeLabel ?? outcome.replace(/[_-]+/g, ' ').trim();
  return `Closed (${words.charAt(0).toUpperCase()}${words.slice(1)})`;
}

/**
 * UX-013: what a locked section was locked by, in words: the decision of the gate's stage ("the
 * Engineering & Capacity decision"), not the gate's number ("G2"). Until the configuration has loaded,
 * or for a gate it does not list, "a gate decision".
 */
export function lockedAfterText(stageLabel: string | null | undefined): string {
  return stageLabel ? `Locked after the ${stageLabel} decision` : 'Locked after a gate decision';
}
