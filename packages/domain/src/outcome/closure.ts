import { DomainError } from '../errors';
import type { UserId } from '../types/ids';
import type { Role } from '../types/roles';

/**
 * The closure rule (B-13, CR-39/40). A quote reaches a terminal state only with all four of:
 *   outcome · outcome_reason_code · closure_owner_id · closed_at
 * That holds on every terminal path: the customer outcome (G5 Awarded / Lost / Expired) and every
 * internal no-go (G1 Stop / Redirect, G2 Stop, G3 Stop, G4 Decline). `evaluateTransition` plans the
 * closure and refuses a transition that would leave a field empty; the database repeats the rule as a
 * CHECK constraint, so nothing outside the engine can close a quote half-recorded either.
 */

/** The quote columns a closure must fill (snake_case, as stored). */
export const CLOSURE_FIELDS = [
  'outcome',
  'outcome_reason_code',
  'closure_owner_id',
  'closed_at',
] as const;

/** What a closing transition writes on the quote, plus the deciding role (CR-40). */
export interface ClosureRecord {
  /** The transition's `closeAs` (awarded, lost, expired, declined, redirected). */
  outcome: string | null;
  outcomeReasonCode: string | null;
  /** Defaults to the quote's KAM (G5) or the decider (internal no-go); see `closureOwner` on the transition. */
  closureOwnerId: UserId | null;
  closedAt: Date | null;
  /** Who recorded it (may differ from the owner) and in which roles. */
  decidedBy: UserId;
  decidedByRoles: readonly Role[];
}

const LABELS: Record<(typeof CLOSURE_FIELDS)[number], string> = {
  outcome: 'an outcome',
  outcome_reason_code: 'a reason code',
  closure_owner_id: 'a closure owner',
  closed_at: 'a closing date',
};

/** Every closure field that is still empty, as `CLOSURE_INCOMPLETE` errors. Empty array = complete. */
export function closureErrors(
  closure: Pick<ClosureRecord, 'outcome' | 'outcomeReasonCode' | 'closureOwnerId' | 'closedAt'>,
): DomainError[] {
  const values: Record<(typeof CLOSURE_FIELDS)[number], unknown> = {
    outcome: closure.outcome?.trim() || null,
    outcome_reason_code: closure.outcomeReasonCode?.trim() || null,
    closure_owner_id: closure.closureOwnerId || null,
    closed_at:
      closure.closedAt && !Number.isNaN(closure.closedAt.getTime()) ? closure.closedAt : null,
  };
  return CLOSURE_FIELDS.filter((f) => values[f] === null).map(
    (f) =>
      new DomainError('CLOSURE_INCOMPLETE', `A quote can't close without ${LABELS[f]} (CR-39)`, f),
  );
}

/** A stored quote row satisfies the closure rule (used by reports: should always be true). */
export function isClosureComplete(row: {
  status: string;
  outcome: string | null;
  outcomeReasonCode: string | null;
  closureOwnerId: string | null;
  closedAt: Date | null;
}): boolean {
  if (row.status !== 'closed') return true;
  return (
    closureErrors({
      outcome: row.outcome,
      outcomeReasonCode: row.outcomeReasonCode,
      closureOwnerId: row.closureOwnerId as UserId | null,
      closedAt: row.closedAt,
    }).length === 0
  );
}
