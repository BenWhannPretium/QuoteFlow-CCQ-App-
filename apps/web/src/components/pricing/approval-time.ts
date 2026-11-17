/**
 * The price-approval time to send: the `datetime-local` value as an ISO instant, or null when there is
 * no approver or the field is blank or unreadable. A cleared field is `''`, and
 * `new Date('').toISOString()` throws "Invalid time value", which reached the user as a bare toast with
 * no field marked. Null lets the server answer as it does for any other missing field.
 */
export function approvedAtIso(approvedBy: string, approvedAtLocal: string): string | null {
  if (!approvedBy || !approvedAtLocal) return null;
  const at = new Date(approvedAtLocal);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}
