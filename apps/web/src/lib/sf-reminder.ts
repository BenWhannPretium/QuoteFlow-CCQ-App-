/**
 * DR-kam-sales-leader-01: the "update the Salesforce opportunity" reminder after a customer outcome (G5)
 * is kept in this browser until the KAM dismisses it, so it survives a reload and shows on the quote
 * even when the outcome was recorded from My proposals. Per browser and per quote; storage can be off
 * (private window), so every access is guarded and the reminder simply does not persist then.
 */
const key = (quoteNumber: string) => `ccq.sfReminder.${quoteNumber}`;

export function readSfReminder(quoteNumber: string): string | null {
  try {
    return localStorage.getItem(key(quoteNumber));
  } catch {
    return null;
  }
}

export function writeSfReminder(quoteNumber: string, outcomeKey: string | null): void {
  try {
    if (outcomeKey) localStorage.setItem(key(quoteNumber), outcomeKey);
    else localStorage.removeItem(key(quoteNumber));
  } catch {
    // Storage is off: the in-memory reminder still shows for this visit.
  }
}
