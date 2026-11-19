import { DomainError } from '../errors';
import {
  LEAD_REVIEW,
  SCHEDULER_PART_FIELDS,
  isLead,
  type LeadReviewPlan,
  type LeadReviewQuote,
  type LeadReviewState,
} from './index';
import { can } from '../policy/can';
import type { Actor } from '../types/actor';
import type { QuoteState } from '../types/quote';
import type { RequiredRule, WorkflowConfig } from '../types/workflow-config';
import { evaluateQuoteRules } from '../workflow/item-rules';
import { fieldsReferenced } from '../workflow/rules';

/**
 * FB-22 (N17-14, Ben Whann, Nov 17-18; provisional): Engineering has two parts, one review. The engineer's
 * part (solution, BOM, pricing inputs) and the production scheduler's part (the capacity rows) are each
 * submitted to the engineering lead by their owner. The lead is told per `app_setting.eng_lead_notify_when`
 * (seed `both_parts`: once every part is in) and may still decide at any time (L-9).
 *
 * D2 (Ben, 2026-11-18): an engineering lead who is also the assigned engineer has nobody to submit to, so
 * their own part counts as in; with a scheduler assigned, the lead is told when the scheduler submits.
 */
export const ENG_LEAD_NOTIFY_WHEN = ['both_parts', 'each_part'] as const;
export type EngLeadNotifyWhen = (typeof ENG_LEAD_NOTIFY_WHEN)[number];
export const ENG_LEAD_NOTIFY_WHEN_SEED: EngLeadNotifyWhen = 'both_parts';

/** The setting's value, or the seed when it is missing or not one of the choices (fail to the seed). */
export function parseEngLeadNotifyWhen(value: unknown): EngLeadNotifyWhen {
  return ENG_LEAD_NOTIFY_WHEN.includes(value as EngLeadNotifyWhen)
    ? (value as EngLeadNotifyWhen)
    : ENG_LEAD_NOTIFY_WHEN_SEED;
}

export type EngPart = 'engineer' | 'scheduler';

export interface EngPartState {
  /** Whose part it is (null: nobody assigned). */
  ownerId: string | null;
  submittedAt: Date | null;
  submittedBy: string | null;
  /** D2: the owner is an engineering lead, so the part needs no submit (it counts as in). */
  ownerIsLead: boolean;
  /** Submitted, or needs no submit. */
  in: boolean;
}

export interface EngParts {
  engineer: EngPartState;
  /** Null when no production scheduler is assigned: the engineer's part covers capacity. */
  scheduler: EngPartState | null;
  /** Every part is in and at least one was submitted: the quote reads "Ready for lead review". */
  ready: boolean;
}

const inEngStage = (quote: Pick<QuoteState, 'stageKey' | 'status'>) =>
  quote.stageKey === LEAD_REVIEW.engineering.stageKey && quote.status !== 'closed';

/**
 * Where each part stands. `engineerIsLead`: the assigned engineer holds the lead's permission (the
 * caller reads their roles); their part then needs no submit.
 */
export function engineeringParts(
  quote: Pick<LeadReviewQuote, 'assignedEngineerId' | 'assignedSchedulerId'>,
  review: LeadReviewState,
  engineerIsLead: boolean,
): EngParts {
  const engineerId = quote.assignedEngineerId ?? null;
  const selfReviewed = engineerIsLead && engineerId !== null;
  const engineer: EngPartState = {
    ownerId: engineerId,
    submittedAt: review.submittedAt,
    submittedBy: review.submittedBy,
    ownerIsLead: selfReviewed,
    in: review.submittedAt !== null || selfReviewed,
  };
  const schedulerId = quote.assignedSchedulerId ?? null;
  const capacityAt = review.capacitySubmittedAt ?? null;
  const scheduler: EngPartState | null = schedulerId
    ? {
        ownerId: schedulerId,
        submittedAt: capacityAt,
        submittedBy: review.capacitySubmittedBy ?? null,
        ownerIsLead: false,
        in: capacityAt !== null,
      }
    : null;
  const anySubmitted = engineer.submittedAt !== null || (scheduler?.submittedAt ?? null) !== null;
  return { engineer, scheduler, ready: anySubmitted && engineer.in && (scheduler?.in ?? true) };
}

/**
 * The Engineering tab's and queue's lead-review status. `submitted`: every part is in (waiting on the
 * lead). `returned`: the lead's latest send-back has not been answered by the person it went to. Else
 * `none` (one part may be in: `engineeringParts` says which).
 */
export function engineeringReviewStatus(
  quote: Pick<LeadReviewQuote, 'assignedEngineerId' | 'assignedSchedulerId'>,
  review: LeadReviewState,
  parts: EngParts,
): 'none' | 'submitted' | 'returned' {
  if (parts.ready) return 'submitted';
  if (!review.returnedAt) return 'none';
  const toScheduler =
    review.returnedTo != null && review.returnedTo === (quote.assignedSchedulerId ?? null);
  const answered = toScheduler
    ? (review.capacitySubmittedAt ?? null) !== null
    : review.submittedAt !== null;
  return answered ? 'none' : 'returned';
}

/** The production scheduler assigned to the quote (not a lead) may submit the capacity part, once per round. */
export function canSubmitCapacityToLead(
  actor: Actor,
  quote: LeadReviewQuote,
  review: LeadReviewState,
): boolean {
  return (
    inEngStage(quote) &&
    quote.assignedSchedulerId != null &&
    quote.assignedSchedulerId === actor.userId &&
    (review.capacitySubmittedAt ?? null) === null &&
    can(actor, 'capacity.edit', quote) &&
    !isLead('engineering', actor, quote)
  );
}

/**
 * The rules the scheduler's submission is checked against: G2 and its advance outcome's rules that read
 * the scheduler's part (the capacity rows), less the lead's own steps (the capacity sign-off).
 */
export function capacitySubmissionRules(config: WorkflowConfig): RequiredRule[] {
  const spec = LEAD_REVIEW.engineering;
  const gate = config.gates.find((g) => g.key === spec.gateKey);
  const outcome = config.outcomes.find(
    (o) => o.gateKey === spec.gateKey && o.key === spec.advanceOutcomeKey,
  );
  return [...(gate?.requiredFields ?? []), ...(outcome?.requiredFields ?? [])].filter((rule) => {
    const fields = fieldsReferenced(rule);
    return (
      fields.some((f) => SCHEDULER_PART_FIELDS.includes(f)) &&
      !fields.some((f) => spec.leadOnlyFields.includes(f))
    );
  });
}

/** Submit the capacity part: the assigned scheduler only, not twice, and the capacity rules must pass. */
export function planSubmitCapacityToLead(
  actor: Actor,
  quote: LeadReviewQuote,
  review: LeadReviewState,
  config: WorkflowConfig,
  fields: QuoteState['fields'],
): LeadReviewPlan {
  if (quote.status === 'closed') {
    return { ok: false, errors: [new DomainError('QUOTE_CLOSED', 'The quote is closed')] };
  }
  if (quote.stageKey !== LEAD_REVIEW.engineering.stageKey) {
    return {
      ok: false,
      errors: [
        new DomainError(
          'WRONG_STAGE',
          `The quote is in ${quote.stageKey}, not in ${LEAD_REVIEW.engineering.stageKey}`,
        ),
      ],
    };
  }
  if ((review.capacitySubmittedAt ?? null) !== null) {
    return {
      ok: false,
      errors: [
        new DomainError('ALREADY_SUBMITTED', 'Capacity is already with the engineering lead'),
      ],
    };
  }
  if (!canSubmitCapacityToLead(actor, quote, review)) {
    return {
      ok: false,
      errors: [
        new DomainError(
          'NOT_PERMITTED',
          'Only the production scheduler assigned to this quote submits the capacity',
        ),
      ],
    };
  }
  const missing = evaluateQuoteRules(capacitySubmissionRules(config), fields);
  return missing.length > 0 ? { ok: false, errors: missing } : { ok: true };
}

/**
 * The capacity rows are read-only for someone who is not a lead while the part they belong to is with
 * the lead: the scheduler's submission locks them for everyone but the lead; the engineer's submission
 * locks them for the engineer (with no scheduler assigned, the engineer's part covers them).
 */
export function capacityLockedFor(
  actor: Actor,
  quote: Pick<
    LeadReviewQuote,
    | 'engSubmittedAt'
    | 'capacitySubmittedAt'
    | 'assignedSchedulerId'
    | 'stageKey'
    | 'kamUserId'
    | 'assignedEngineerId'
    | 'region'
    | 'accountId'
  >,
): boolean {
  if (can(actor, LEAD_REVIEW.engineering.leadPermission, quote)) return false;
  if (quote.capacitySubmittedAt != null) return true;
  return (
    quote.engSubmittedAt != null &&
    !(quote.assignedSchedulerId != null && quote.assignedSchedulerId === actor.userId)
  );
}

/** Whether a submission tells the engineering lead now (the setting; seed `both_parts`). */
export const leadNoticeDue = (setting: EngLeadNotifyWhen, after: EngParts): boolean =>
  after.ready || setting === 'each_part';
