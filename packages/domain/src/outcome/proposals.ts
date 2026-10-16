/**
 * "My open proposals" (B-13): a KAM's quotes waiting for the customer, soonest validity end first, so
 * the ones about to lapse are on top. Quotes with no validity date (should not happen after Final
 * Review) sort last; ties by quote number.
 */
export interface OpenProposalEntry {
  quoteNumber: string;
  validityUntil: string | null;
}

export function sortOpenProposals<T extends OpenProposalEntry>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.validityUntil !== b.validityUntil) {
      if (a.validityUntil === null) return 1;
      if (b.validityUntil === null) return -1;
      return a.validityUntil < b.validityUntil ? -1 : 1;
    }
    return a.quoteNumber.localeCompare(b.quoteNumber);
  });
}

/**
 * A decision taken against an earlier quote version than the current one. Re-quote and return paths
 * bump the version (CR-38): the earlier approvals are kept exactly as recorded and shown as superseded.
 */
export const isSupersededDecision = (decisionVersion: number, quoteVersion: number): boolean =>
  decisionVersion < quoteVersion;
