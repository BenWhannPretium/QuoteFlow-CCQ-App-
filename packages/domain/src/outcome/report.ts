import { isClosureComplete } from './closure';
import { isValidityLapsed } from './validity';
import { CUSTOMER_DECISION_STAGE_KEY } from '../final-review/release';
import type { WorkflowConfig } from '../types/workflow-config';

/**
 * The outcomes report (B-13, admin): counts by outcome and reason, and the outcome capture rate. Today
 * 71% of FY26 requests have no recorded customer outcome; this is the number that shows it closing.
 *
 * - **Customer outcomes** are the customer's closures (closure owner = the KAM) decided at Customer
 *   Decision (G5: lost, expired) or at Commit & Hand Off (G6: awarded, B-26). **Internal** closures
 *   (G1–G3 Stop, G4 Decline, G1 Redirect, G6 "commitment not authorized") are counted, never mixed in.
 * - **B-26:** an award (G5) moves the quote to Commit & Hand Off; it closes Won at G6. A quote waiting
 *   there is a customer win already (`customer.commitmentPending`), counted in the awards, the win rate
 *   and the capture rate.
 * - **Expired is not lost** ("silence is not a loss"): it has its own row and is left out of the win rate.
 * - **Capture rate** = recorded customer outcomes ÷ (recorded + "gone dark"), where gone dark = a
 *   proposal still open in Customer Decision after its validity date. Proposals still within validity
 *   are pending, not missing, so they are not in the denominator.
 */

/** closeAs keys of the seeded customer outcomes (config may relabel them; these are the keys). */
export const AWARDED_OUTCOME = 'awarded';
export const LOST_OUTCOME = 'lost';
export const EXPIRED_OUTCOME = 'expired';
/** B-26: the G5 outcome key for a counter within the approved range (the quote stays open). */
export const NEGOTIATING_OUTCOME = 'negotiating';
/** The terminal stage an award lands in (Closed – Won). */
export const AWARDED_STAGE_KEY = 'AWARDED';
/** B-26: Stage 6, where an awarded quote waits for the CER and the hand-off (the hand-off record lives here). */
export const COMMIT_STAGE_KEY = 'COMMIT_HANDOFF';

export interface OutcomeReportRow {
  stageKey: string;
  status: string;
  outcome: string | null;
  outcomeReasonCode: string | null;
  closureOwnerId: string | null;
  closedAt: Date | null;
  proposalIssuedAt: Date | null;
  validityUntil: string | null;
}

export interface OutcomeReasonCount {
  code: string | null;
  label: string;
  count: number;
}

export interface OutcomeCount {
  outcome: string;
  label: string;
  kind: 'customer' | 'internal';
  count: number;
  reasons: OutcomeReasonCount[];
}

export interface OutcomeReport {
  outcomes: OutcomeCount[];
  customer: {
    awarded: number;
    lost: number;
    expired: number;
    /** B-26: awarded by the customer, still in Commit & Hand Off (included in `awarded`). */
    commitmentPending: number;
    /** awarded ÷ (awarded + lost); expired is excluded. Null when nothing is decided yet. */
    winRate: number | null;
  };
  capture: {
    /** Quotes that reached the customer (a proposal was issued). */
    proposalsIssued: number;
    recorded: number;
    /** Open in Customer Decision, validity not yet passed. */
    awaiting: number;
    /** Open in Customer Decision, validity passed, no outcome recorded. */
    goneDark: number;
    /** recorded ÷ (recorded + goneDark); null when both are 0. */
    rate: number | null;
  };
  /** Closed quotes missing an outcome, reason, owner or date. The closure rule keeps this at 0. */
  incompleteClosures: number;
}

/**
 * Which closeAs values are the customer's outcome, from the workflow config: the closures the G5
 * (Customer Decision) gate makes, and the KAM-owned closures of the Commit & Hand Off gate (B-26: G6
 * Won; its "commitment not authorized" is Pretium's own no-go, so internal).
 */
export function customerOutcomeKeys(config: WorkflowConfig): Set<string> {
  const stageOf = new Map(config.gates.map((g) => [g.key, g.stageKey]));
  return new Set(
    config.transitions
      .filter((t) => {
        if (t.nextStatus !== 'closed' || !t.closeAs) return false;
        const stage = stageOf.get(t.gateKey);
        if (stage === CUSTOMER_DECISION_STAGE_KEY) return true;
        return stage === COMMIT_STAGE_KEY && t.closureOwner === 'kam';
      })
      .map((t) => t.closeAs as string),
  );
}

const ratio = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 1000);

export function summarizeOutcomes(
  rows: readonly OutcomeReportRow[],
  config: WorkflowConfig,
  now: Date,
): OutcomeReport {
  const customer = customerOutcomeKeys(config);
  // Labels: the outcome that closes as X, and its reason codes (several gates may close as `declined`).
  const closing = config.transitions.filter((t) => t.nextStatus === 'closed' && t.closeAs);
  const outcomeDefs = (closeAs: string) =>
    closing
      .filter((t) => t.closeAs === closeAs)
      .map((t) => config.outcomes.find((o) => o.gateKey === t.gateKey && o.key === t.outcomeKey))
      .filter((o) => o !== undefined);
  const outcomeLabel = (closeAs: string) =>
    config.stages.find(
      (s) => closing.find((t) => t.closeAs === closeAs)?.targetStageKeys[0] === s.key,
    )?.label ??
    outcomeDefs(closeAs)[0]?.label ??
    closeAs;
  const reasonLabel = (closeAs: string, code: string | null) => {
    if (!code) return 'No reason recorded';
    const contexts = new Set(outcomeDefs(closeAs).map((o) => o.reasonContext));
    return (
      config.reasonCodes.find((r) => r.code === code && contexts.has(r.context))?.label ?? code
    );
  };

  const byOutcome = new Map<string, Map<string | null, number>>();
  for (const row of rows) {
    if (row.status !== 'closed') continue;
    const key = row.outcome ?? 'unrecorded';
    const reasons = byOutcome.get(key) ?? new Map<string | null, number>();
    reasons.set(row.outcomeReasonCode, (reasons.get(row.outcomeReasonCode) ?? 0) + 1);
    byOutcome.set(key, reasons);
  }
  // Every configured closure appears, with 0 when nothing closed that way yet: customer outcomes first.
  for (const t of closing) if (!byOutcome.has(t.closeAs!)) byOutcome.set(t.closeAs!, new Map());

  const outcomes: OutcomeCount[] = [...byOutcome.entries()]
    .map(([outcome, reasons]) => ({
      outcome,
      label: outcome === 'unrecorded' ? 'No outcome recorded' : outcomeLabel(outcome),
      kind: customer.has(outcome) ? ('customer' as const) : ('internal' as const),
      count: [...reasons.values()].reduce((a, b) => a + b, 0),
      reasons: [...reasons.entries()]
        .map(([code, count]) => ({ code, label: reasonLabel(outcome, code), count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    }))
    .sort(
      (a, b) =>
        (a.kind === b.kind ? 0 : a.kind === 'customer' ? -1 : 1) ||
        b.count - a.count ||
        a.outcome.localeCompare(b.outcome),
    );

  const count = (outcome: string) => outcomes.find((o) => o.outcome === outcome)?.count ?? 0;
  const commitmentPending = rows.filter(
    (r) => r.status !== 'closed' && r.stageKey === COMMIT_STAGE_KEY,
  ).length;
  const awarded = count(AWARDED_OUTCOME) + commitmentPending;
  const lost = count(LOST_OUTCOME);
  const expired = count(EXPIRED_OUTCOME);

  const recorded =
    rows.filter((r) => r.status === 'closed' && r.outcome !== null && customer.has(r.outcome))
      .length + commitmentPending;
  const open = rows.filter(
    (r) => r.status !== 'closed' && r.stageKey === CUSTOMER_DECISION_STAGE_KEY,
  );
  const goneDark = open.filter((r) => isValidityLapsed(r.validityUntil, now)).length;
  const awaiting = open.length - goneDark;
  const proposalsIssued = rows.filter(
    (r) =>
      r.proposalIssuedAt !== null ||
      r.stageKey === CUSTOMER_DECISION_STAGE_KEY ||
      r.stageKey === COMMIT_STAGE_KEY ||
      (r.outcome !== null && customer.has(r.outcome)),
  ).length;

  return {
    outcomes,
    customer: {
      awarded,
      lost,
      expired,
      commitmentPending,
      winRate: ratio(awarded, awarded + lost),
    },
    capture: {
      proposalsIssued,
      recorded,
      awaiting,
      goneDark,
      rate: ratio(recorded, recorded + goneDark),
    },
    incompleteClosures: rows.filter((r) => !isClosureComplete(r)).length,
  };
}
