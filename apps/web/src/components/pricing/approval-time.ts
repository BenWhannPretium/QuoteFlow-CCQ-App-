/**
 * The price-approval time to send: the `datetime-local` value as an ISO instant, or null when there is
 * no approver or the field is blank or unreadable.
 *
 * A cleared field is `''`, and `new Date('').toISOString()` throws "Invalid time value", which reached
 * the user as a bare toast with no field marked. Null with an approver set is NOT something to send:
 * the server stamps the current time on an approval that arrives without one, so the form checks for it
 * and marks the field instead (see the submit handler in QuotingTab).
 */
export function approvedAtIso(approvedBy: string, approvedAtLocal: string): string | null {
  if (!approvedBy || !approvedAtLocal) return null;
  const at = new Date(approvedAtLocal);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}
