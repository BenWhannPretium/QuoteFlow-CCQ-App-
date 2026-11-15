import { calendarDate } from './time';

/**
 * FB-17 (W13-26): one sentence for a hold, the same on the timeline and in the quote header:
 * "On hold: Awaiting internal input. Owner: Avery Stone. Review by Dec 1, 2026." A part that is not
 * known is left out; with nothing known it reads "On hold".
 */
export function holdSummary(hold: {
  reasonLabel?: string | null;
  ownerName?: string | null;
  /** `YYYY-MM-DD`. */
  reviewDate?: string | null;
}): string {
  const parts = [
    hold.ownerName && `Owner: ${hold.ownerName}.`,
    hold.reviewDate && `Review by ${calendarDate(hold.reviewDate)}.`,
  ].filter(Boolean);
  const head = hold.reasonLabel ? `On hold: ${hold.reasonLabel}.` : 'On hold';
  if (parts.length === 0) return head;
  return `${hold.reasonLabel ? head : `${head}.`} ${parts.join(' ')}`;
}

/**
 * How a hold ended. Only a decision ends one today (no job ends a hold when its review date passes), so
 * it names who decided and what: "Hold ended: Jordan Reyes recorded “Advance”". An entry recorded
 * before FB-17 carries no outcome and reads "Hold ended".
 */
export function holdEndedSummary(ended: {
  actorName?: string | null;
  outcomeLabel?: string | null;
}): string {
  if (!ended.outcomeLabel) return 'Hold ended';
  return `Hold ended: ${ended.actorName ?? 'someone'} recorded “${ended.outcomeLabel}”`;
}
