import { DomainError } from '../errors';
import { CUSTOMER_DECISION_STAGE_KEY, proposalCalendarDate } from '../final-review/release';

/**
 * Proposal validity (B-13, D-12 open). The validity date is a US Central calendar date set when Final
 * Review releases the proposition (`validity_until` = issued + `validity_days_default`). The proposal is
 * valid through that whole day and expired from the next. Nothing here closes a quote: an expired
 * proposal is flagged so the KAM revalidates it or records the outcome (D-12 decides any auto-close).
 */

/** `validity_warning_days` fallback: the countdown turns amber at this many days left or fewer. */
export const VALIDITY_WARNING_DAYS_SEED = 7;
const MAX_WARNING_DAYS = 90;
const DAY_MS = 86_400_000;

/** `app_setting.validity_warning_days`. Null/undefined = the seed; else a whole number 0–90. */
export function parseValidityWarningDays(input: unknown): number {
  if (input === undefined || input === null) return VALIDITY_WARNING_DAYS_SEED;
  if (
    typeof input !== 'number' ||
    !Number.isInteger(input) ||
    input < 0 ||
    input > MAX_WARNING_DAYS
  ) {
    throw new DomainError(
      'INVALID_CONFIG',
      `validity_warning_days must be a whole number of days from 0 to ${MAX_WARNING_DAYS}`,
    );
  }
  return input;
}

/** `none`: no validity date · `valid` · `expiring`: ≤ warning days left (amber) · `expired`: past (red). */
export type ValidityState = 'none' | 'valid' | 'expiring' | 'expired';

export interface ValidityStatus {
  validityUntil: string | null;
  /** Whole calendar days from today (US Central) to the validity date: 0 = last day, negative = expired. */
  daysLeft: number | null;
  state: ValidityState;
}

/** Whole days from calendar date `from` to `to` (both `YYYY-MM-DD`). */
export function calendarDaysBetween(from: string, to: string): number {
  const at = (d: string) => {
    const [y, m, day] = d.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((at(to) - at(from)) / DAY_MS);
}

/** The countdown the quote header shows. Pure: the caller passes the clock. */
export function validityStatus(
  validityUntil: string | null | undefined,
  now: Date,
  warningDays: number = VALIDITY_WARNING_DAYS_SEED,
): ValidityStatus {
  if (!validityUntil) return { validityUntil: null, daysLeft: null, state: 'none' };
  const daysLeft = calendarDaysBetween(proposalCalendarDate(now), validityUntil);
  const state: ValidityState =
    daysLeft < 0 ? 'expired' : daysLeft <= warningDays ? 'expiring' : 'valid';
  return { validityUntil, daysLeft, state };
}

/** True once the validity date has passed (the day after `validity_until`, US Central). */
export function isValidityLapsed(validityUntil: string | null | undefined, now: Date): boolean {
  return validityStatus(validityUntil, now).state === 'expired';
}

/** The slice of a quote row the expiry job looks at. */
export interface ExpiryCandidate {
  id: string;
  quoteNumber: string;
  stageKey: string;
  status: string;
  kamUserId: string;
  validityUntil: string | null;
  /** When the job last flagged this validity date; null = not flagged (reset when a new date is set). */
  validityExpiredFlaggedAt: Date | null;
}

/**
 * The daily expiry job's selection: open quotes waiting for the customer (Customer Decision, on hold
 * included) whose validity has passed and that have not been flagged for it yet. Flagging writes an
 * activity event and tells the KAM; it never changes the stage or status (D-12: no auto-close).
 */
export function quotesToFlagExpired<T extends ExpiryCandidate>(
  rows: readonly T[],
  now: Date,
  stageKey: string = CUSTOMER_DECISION_STAGE_KEY,
): T[] {
  return rows.filter(
    (r) =>
      r.stageKey === stageKey &&
      r.status !== 'closed' &&
      r.validityExpiredFlaggedAt === null &&
      isValidityLapsed(r.validityUntil, now),
  );
}
