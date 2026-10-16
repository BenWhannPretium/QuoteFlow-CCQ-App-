import { DomainError } from '../errors';
import type { TransitionRule, WorkflowConfig } from '../types/workflow-config';

/**
 * Final Review (B-12, F-16 as a P0 decision record, CR-29). G4 "Release proposition" is the INTERNAL
 * decision "is this the offer Pretium is prepared to commit to, on these terms?". It never sets Awarded
 * or Lost: Approve moves the quote to Customer Decision, Decline closes it as DECLINED (an internal
 * no-go) and Return sends it back to the affected stage. Only the customer outcome (G5, B-13) awards
 * or loses a quote (fixes PRD F-16, X-88).
 */

/** Stage and gate keys of the hybrid seed. Config can relabel them; these are the keys. */
export const FINAL_REVIEW_STAGE_KEY = 'FINAL_REVIEW';
export const CUSTOMER_DECISION_STAGE_KEY = 'CUSTOMER_DECISION';
export const RELEASE_GATE_KEY = 'G4';

/** Pretium HQ's calendar: the validity date is a calendar date, so it is counted in US Central. */
export const PROPOSAL_TIME_ZONE = 'America/Chicago';

/** `validity_days_default` fallback (provisional, D-12: PTF says 30, 60-day proposals exist). */
export const VALIDITY_DAYS_SEED = 30;
const MAX_VALIDITY_DAYS = 730;

/** A send date this far ahead of the server clock is accepted (device clock skew). */
const FUTURE_SKEW_MS = 5 * 60_000;
const DAY_MS = 86_400_000;

/**
 * `app_setting.validity_days_default`. Undefined or null falls back to the seed; anything else must be
 * a whole number of days from 1 to 730 or the config is invalid (the release is then refused, not guessed).
 */
export function parseValidityDays(input: unknown): number {
  if (input === undefined || input === null) return VALIDITY_DAYS_SEED;
  if (
    typeof input !== 'number' ||
    !Number.isInteger(input) ||
    input < 1 ||
    input > MAX_VALIDITY_DAYS
  ) {
    throw new DomainError(
      'INVALID_CONFIG',
      `validity_days_default must be a whole number of days from 1 to ${MAX_VALIDITY_DAYS}`,
    );
  }
  return input;
}

/** `YYYY-MM-DD` of `at` on the US Central calendar. */
export function proposalCalendarDate(at: Date, timeZone: string = PROPOSAL_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** `date` (`YYYY-MM-DD`) plus whole calendar days. */
export function addCalendarDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** validity_until = the (US Central) calendar date the proposal was issued + the default validity days. */
export function validityUntil(issuedAt: Date, validityDays: number): string {
  return addCalendarDays(proposalCalendarDate(issuedAt), validityDays);
}

export interface ProposalReleaseInput {
  now: Date;
  /** The actual send date when it differs from the decision time. Default: now. */
  issuedAt?: Date | null;
  /** `validity_days_default` (parsed). */
  validityDays: number;
}

export type ProposalReleasePlan =
  | { ok: true; proposalIssuedAt: Date; validityUntil: string; validityDays: number }
  | { ok: false; errors: DomainError[] };

/**
 * What an Approve sets on the quote (CR-29, D-12): `proposal_issued_at` (default now, editable to the
 * actual send date, never in the future) and `validity_until = issued + validity days`. The days are
 * config, never a literal.
 */
export function planProposalRelease(input: ProposalReleaseInput): ProposalReleasePlan {
  const issued = input.issuedAt ?? input.now;
  if (Number.isNaN(issued.getTime())) {
    return {
      ok: false,
      errors: [
        new DomainError(
          'INVALID_PROPOSAL_DATE',
          'The proposal date is not valid',
          'proposalIssuedAt',
        ),
      ],
    };
  }
  if (issued.getTime() > input.now.getTime() + FUTURE_SKEW_MS) {
    return {
      ok: false,
      errors: [
        new DomainError(
          'INVALID_PROPOSAL_DATE',
          'The proposal issue date cannot be in the future: enter the date it was actually sent',
          'proposalIssuedAt',
        ),
      ],
    };
  }
  return {
    ok: true,
    proposalIssuedAt: issued,
    validityUntil: validityUntil(issued, input.validityDays),
    validityDays: input.validityDays,
  };
}

/**
 * Does this gate outcome release the proposition? True when the gate sits on Final Review and its
 * transition moves the quote on (active) into Customer Decision, whatever the outcome is called in config.
 */
export function releasesProposal(
  config: Pick<WorkflowConfig, 'gates' | 'transitions'>,
  gateKey: string,
  outcomeKey: string,
): boolean {
  const gate = config.gates.find((g) => g.key === gateKey);
  if (gate?.stageKey !== FINAL_REVIEW_STAGE_KEY) return false;
  const transition: TransitionRule | undefined = config.transitions.find(
    (t) => t.gateKey === gateKey && t.outcomeKey === outcomeKey,
  );
  return (
    !!transition &&
    transition.nextStatus === 'active' &&
    transition.targetStageKeys.length === 1 &&
    transition.targetStageKeys[0] === CUSTOMER_DECISION_STAGE_KEY
  );
}
