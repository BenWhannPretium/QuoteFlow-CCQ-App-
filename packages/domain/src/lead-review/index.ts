import { ENG_QUEUE_STAGE_KEY } from '../engineering/queue';
import { DomainError } from '../errors';
import { can } from '../policy/can';
import { PRICING_QUEUE_STAGE_KEY } from '../pricing/queue';
import type { Actor } from '../types/actor';
import type { Permission } from '../types/permissions';
import type { QuoteState } from '../types/quote';
import type { RequiredRule, WorkflowConfig } from '../types/workflow-config';
import { evaluateRules, fieldsReferenced } from '../workflow/rules';

/**
 * Lead review (Ben, 2026-10-30). The engineer or pricer assigned to a quote does their part, then
 * submits it to their lead; the lead is told and finds it under "Ready for my review". The lead
 * either moves the quote on through the gate (G2 / G3) or sends it back with a note. While it is
 * submitted, the assignee's part is locked: only the lead edits.
 *
 * The lead may act at any time, submitted or not (they can fill anything in themselves), so nothing
 * here gates G2 or G3. A lead who is the assignee has nobody to submit to, so is never offered it.
 */
export const LEAD_REVIEW_KINDS = ['engineering', 'pricing'] as const;
export type LeadReviewKind = (typeof LEAD_REVIEW_KINDS)[number];

export interface LeadReviewSpec {
  stageKey: string;
  /** The gate the lead decides next. */
  gateKey: string;
  /** The outcome whose required fields the assignee's submission is checked against. */
  advanceOutcomeKey: string;
  /** Who the lead is: whoever may decide that gate. */
  leadPermission: Permission;
  /** Who does the work: the assignee holding this permission. */
  workPermission: Permission;
  /** Fields that are the lead's own step, left out of the assignee's check (G2's capacity sign-off). */
  leadOnlyFields: readonly string[];
  noun: { assignee: string; lead: string };
}

export const LEAD_REVIEW: Record<LeadReviewKind, LeadReviewSpec> = {
  engineering: {
    stageKey: ENG_QUEUE_STAGE_KEY,
    gateKey: 'G2',
    advanceOutcomeKey: 'proceed',
    leadPermission: 'gate.G2.decide',
    workPermission: 'engReview.edit',
    leadOnlyFields: ['capacity_signoff_status'],
    noun: { assignee: 'engineer', lead: 'engineering lead' },
  },
  pricing: {
    stageKey: PRICING_QUEUE_STAGE_KEY,
    gateKey: 'G3',
    advanceOutcomeKey: 'submit',
    leadPermission: 'gate.G3.submit',
    workPermission: 'quoting.edit',
    leadOnlyFields: [],
    noun: { assignee: 'pricer', lead: 'pricing lead' },
  },
};

/** The submission state of one kind on one quote (the latest submit and the latest send-back). */
export interface LeadReviewState {
  submittedAt: Date | null;
  submittedBy: string | null;
  returnedAt: Date | null;
  returnedBy: string | null;
  returnNote: string | null;
}

export const EMPTY_LEAD_REVIEW: LeadReviewState = {
  submittedAt: null,
  submittedBy: null,
  returnedAt: null,
  returnedBy: null,
  returnNote: null,
};

export type LeadReviewQuote = Pick<
  QuoteState,
  | 'stageKey'
  | 'status'
  | 'kamUserId'
  | 'assignedEngineerId'
  | 'assignedPricerId'
  | 'engSubmittedAt'
  | 'pricingSubmittedAt'
  | 'region'
  | 'accountId'
>;

export const assigneeOf = (kind: LeadReviewKind, quote: LeadReviewQuote): string | null =>
  (kind === 'engineering' ? quote.assignedEngineerId : quote.assignedPricerId) ?? null;

const inStage = (kind: LeadReviewKind, quote: LeadReviewQuote) =>
  quote.stageKey === LEAD_REVIEW[kind].stageKey && quote.status !== 'closed';

/** The actor is a lead for this kind (may decide its gate). */
export const isLead = (kind: LeadReviewKind, actor: Actor, quote: LeadReviewQuote) =>
  can(actor, LEAD_REVIEW[kind].leadPermission, quote);

/** Waiting on the lead: submitted in this stay and not sent back since. */
export const isSubmitted = (review: LeadReviewState) => review.submittedAt !== null;

/**
 * While submitted, only a lead edits the assignee's part. Callers add this to their edit checks
 * (canEditEngReview / canEditQuoting).
 */
export function lockedForActor(
  kind: LeadReviewKind,
  actor: Actor,
  quote: LeadReviewQuote,
  review: LeadReviewState,
): boolean {
  return isSubmitted(review) && !isLead(kind, actor, quote);
}

/** The quote's part is submitted and the actor is not a lead: they may not edit it. */
export function lockedFor(kind: LeadReviewKind, actor: Actor, quote: LeadReviewQuote): boolean {
  const submittedAt = kind === 'engineering' ? quote.engSubmittedAt : quote.pricingSubmittedAt;
  return submittedAt != null && !isLead(kind, actor, quote);
}

/** The assignee (not a lead) may submit their part, once per round. */
export function canSubmitToLead(
  kind: LeadReviewKind,
  actor: Actor,
  quote: LeadReviewQuote,
  review: LeadReviewState,
): boolean {
  return (
    inStage(kind, quote) &&
    !isSubmitted(review) &&
    assigneeOf(kind, quote) === actor.userId &&
    can(actor, LEAD_REVIEW[kind].workPermission, quote) &&
    !isLead(kind, actor, quote)
  );
}

/** A lead may send a submitted part back to the assignee. */
export function canReturnToAssignee(
  kind: LeadReviewKind,
  actor: Actor,
  quote: LeadReviewQuote,
  review: LeadReviewState,
): boolean {
  return inStage(kind, quote) && isSubmitted(review) && isLead(kind, actor, quote);
}

/**
 * The rules a submission is checked against: the gate's and its advance outcome's required fields,
 * minus the lead's own steps. Read from the workflow config, so they follow any admin change.
 */
export function submissionRules(kind: LeadReviewKind, config: WorkflowConfig): RequiredRule[] {
  const spec = LEAD_REVIEW[kind];
  const gate = config.gates.find((g) => g.key === spec.gateKey);
  const outcome = config.outcomes.find(
    (o) => o.gateKey === spec.gateKey && o.key === spec.advanceOutcomeKey,
  );
  return [...(gate?.requiredFields ?? []), ...(outcome?.requiredFields ?? [])].filter(
    (rule) => !fieldsReferenced(rule).some((f) => spec.leadOnlyFields.includes(f)),
  );
}

function stageErrors(kind: LeadReviewKind, quote: LeadReviewQuote): DomainError[] {
  if (quote.status === 'closed') return [new DomainError('QUOTE_CLOSED', 'The quote is closed')];
  if (quote.stageKey !== LEAD_REVIEW[kind].stageKey) {
    return [
      new DomainError(
        'WRONG_STAGE',
        `The quote is in ${quote.stageKey}, not in ${LEAD_REVIEW[kind].stageKey}`,
      ),
    ];
  }
  return [];
}

export type LeadReviewPlan = { ok: true } | { ok: false; errors: DomainError[] };

/**
 * Submit to the lead. Only the assignee (not a lead); not twice; and the work must pass the gate's
 * checks (less the lead's own steps), so the lead is never handed half-finished work. `fields` are
 * the quote's decision fields (`QuoteState.fields`, with derived fields applied).
 */
export function planSubmitToLead(
  kind: LeadReviewKind,
  actor: Actor,
  quote: LeadReviewQuote,
  review: LeadReviewState,
  config: WorkflowConfig,
  fields: QuoteState['fields'],
): LeadReviewPlan {
  const { noun } = LEAD_REVIEW[kind];
  const stage = stageErrors(kind, quote);
  if (stage.length > 0) return { ok: false, errors: stage };
  if (isSubmitted(review)) {
    return {
      ok: false,
      errors: [new DomainError('ALREADY_SUBMITTED', `Already submitted to the ${noun.lead}`)],
    };
  }
  if (!canSubmitToLead(kind, actor, quote, review)) {
    return {
      ok: false,
      errors: [
        new DomainError(
          'NOT_PERMITTED',
          `Only the assigned ${noun.assignee} submits to the ${noun.lead}`,
        ),
      ],
    };
  }
  const missing = evaluateRules(submissionRules(kind, config), fields);
  return missing.length > 0 ? { ok: false, errors: missing } : { ok: true };
}

/** Send back to the assignee, with a note saying what to change. A lead only, while submitted. */
export function planReturnToAssignee(
  kind: LeadReviewKind,
  actor: Actor,
  quote: LeadReviewQuote,
  review: LeadReviewState,
  note: string | null | undefined,
): LeadReviewPlan {
  const { noun } = LEAD_REVIEW[kind];
  const stage = stageErrors(kind, quote);
  if (stage.length > 0) return { ok: false, errors: stage };
  if (!isLead(kind, actor, quote)) {
    return {
      ok: false,
      errors: [new DomainError('NOT_PERMITTED', `Only the ${noun.lead} sends work back`)],
    };
  }
  if (!isSubmitted(review)) {
    return {
      ok: false,
      errors: [new DomainError('NOT_SUBMITTED', `Nothing was submitted by the ${noun.assignee}`)],
    };
  }
  if (!note?.trim()) {
    return {
      ok: false,
      errors: [new DomainError('NOTE_REQUIRED', 'Say what to change', 'note')],
    };
  }
  return { ok: true };
}

/**
 * The status shown in a queue and on the tab: `submitted` (waiting on the lead), `returned` (sent
 * back and not resubmitted) or `none`.
 */
export function leadReviewStatus(review: LeadReviewState): 'none' | 'submitted' | 'returned' {
  if (isSubmitted(review)) return 'submitted';
  return review.returnedAt ? 'returned' : 'none';
}
