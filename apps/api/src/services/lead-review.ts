import type { DbOrTx, Tx } from '@ccq/db';
import {
  getLeadReview,
  getQuoteByNumber,
  getQuoteForUpdate,
  getSetting,
  getUserWithRoles,
  insertActivityEvent,
  listUsersByIds,
  loadQuoteState,
  loadWorkflowConfigInput,
  setLeadReview,
  type LeadReviewRow,
  type Quote,
} from '@ccq/db/repos';
import {
  LEAD_REVIEW,
  asUserId,
  assigneeOf,
  canReturnToAssignee,
  canSubmitCapacityToLead,
  canSubmitToLead,
  engineeringParts,
  engineeringReviewStatus,
  isForwardOutcome,
  leadNoticeDue,
  parseEngLeadNotifyWhen,
  planPartSubmitted,
  planSubmitCapacityToLead,
  rolesWithPermission,
  leadReviewStatus,
  leadReviewStatusInStage,
  packOutRequirementErrors,
  submitBlockedReason,
  parseWorkflowConfig,
  planLeadReturned,
  planLeadSubmitted,
  planReturnToAssignee,
  planSubmitToLead,
  returnTargets,
  returnTargetUser,
  withDerivedFields,
  type Actor,
  type DomainError,
  type EngParts,
  type LeadReviewKind,
  type LeadReviewState,
  type QuoteState,
  type ReturnTarget,
  type WorkflowConfig,
} from '@ccq/domain';
import type { FastifyBaseLogger } from 'fastify';

import { deliverPlanned } from './handoff-notifications';
import type { QuoteReadService } from './quotes';
import { recordAudit, type AuditMeta } from '../plugins/audit';

/**
 * Lead review (Ben, 2026-10-30), shared by the engineering and pricing services: the assignee
 * submits their part to the lead; the lead may send it back with a note. Each step is recorded on
 * the timeline and in the audit log, and the other party is told. The rules are the domain's
 * (`@ccq/domain` lead-review); each service maps the domain errors to its own problem codes.
 */
export interface LeadReviewDeps {
  quotes: QuoteReadService;
  log?: FastifyBaseLogger | undefined;
  /** The caller's domain-error → problem mapping (403 / 409 / 422). */
  fail: (errors: readonly DomainError[]) => never;
  notFound: (quoteNumber: string) => Error;
}

/** What the tabs show about the current round. */
export interface LeadReviewView {
  status: 'none' | 'submitted' | 'returned';
  submittedAt: string | null;
  submittedByName: string | null;
  returnedAt: string | null;
  returnedByName: string | null;
  returnNote: string | null;
  canSubmit: boolean;
  canSendBack: boolean;
  submitBlockedReason: string | null;
  /** FB-16 (W13-19): who the latest send-back went to; null on older rounds and on pricing. */
  returnedToName: string | null;
  /** FB-16 (W13-19): who the lead may send the work back to (the assignee first). Engineering only. */
  returnTargets?: { target: ReturnTarget; name: string | null }[];
  /** FB-22 (N17-14): Engineering only, the two parts. */
  parts?: {
    engineer: EngPartDto;
    scheduler: EngPartDto | null;
  };
  canSubmitCapacity?: boolean;
}

interface EngPartDto {
  ownerName: string | null;
  submittedAt: string | null;
  submittedByName: string | null;
  ownerIsLead: boolean;
  in: boolean;
}

/**
 * D2 (Ben, 2026-11-18): the assigned engineer holds a role that leads the stage (decides G2). Their own
 * part then needs no submit (they have nobody to submit to).
 */
export async function engineerIsLead(
  tx: DbOrTx,
  state: Pick<QuoteState, 'assignedEngineerId'>,
): Promise<boolean> {
  if (!state.assignedEngineerId) return false;
  const user = await getUserWithRoles(tx, state.assignedEngineerId);
  const leads = rolesWithPermission(LEAD_REVIEW.engineering.leadPermission) as string[];
  return !!user && user.roles.some((r) => leads.includes(r));
}

/** FB-22: the engineering parts as they stand (reads the engineer's roles for D2). */
export async function loadEngineeringParts(
  tx: DbOrTx,
  state: QuoteState,
  review: LeadReviewState,
): Promise<EngParts> {
  return engineeringParts(state, review, await engineerIsLead(tx, state));
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function leadReviewView(
  tx: DbOrTx,
  actor: Actor,
  kind: LeadReviewKind,
  q: Quote,
  state: QuoteState,
): Promise<LeadReviewView> {
  const review = await getLeadReview(tx, q.id, kind);
  const targets = kind === 'engineering' ? returnTargets(kind, state) : [];
  const parts = kind === 'engineering' ? await loadEngineeringParts(tx, state, review) : null;
  const people = await listUsersByIds(
    tx,
    [
      review.submittedBy,
      review.returnedBy,
      review.returnedTo,
      review.capacitySubmittedBy,
      state.assignedEngineerId ?? null,
      ...targets.map((t) => t.userId),
    ].filter((id): id is string => !!id),
  );
  const name = (id: string | null) => (id && people.find((p) => p.id === id)?.displayName) || null;
  const partDto = (p: EngParts['engineer']): EngPartDto => ({
    ownerName: name(p.ownerId),
    submittedAt: iso(p.submittedAt),
    submittedByName: name(p.submittedBy),
    ownerIsLead: p.ownerIsLead,
    in: p.in,
  });
  // FB-22: in Engineering "submitted" means every part is in (ready for the lead).
  const status = parts ? engineeringReviewStatus(state, review, parts) : leadReviewStatus(review);
  return {
    // DR-pricing-finance-03: after the gate is decided the "Submitted to the lead" banner is gone.
    status: leadReviewStatusInStage(kind, state, status),
    submittedAt: iso(review.submittedAt),
    submittedByName: name(review.submittedBy),
    returnedAt: iso(review.returnedAt),
    returnedByName: name(review.returnedBy),
    returnNote: review.returnNote,
    canSubmit: canSubmitToLead(kind, actor, state, review),
    canSendBack: canReturnToAssignee(kind, actor, state, review),
    submitBlockedReason: submitBlockedReason(kind, actor, state, review),
    returnedToName: name(review.returnedTo),
    ...(kind === 'engineering'
      ? {
          returnTargets: targets.map((t) => ({ target: t.target, name: name(t.userId) })),
          parts: {
            engineer: partDto(parts!.engineer),
            scheduler: parts!.scheduler ? partDto(parts!.scheduler) : null,
          },
          canSubmitCapacity: canSubmitCapacityToLead(actor, state, review),
        }
      : {}),
  };
}

/**
 * FB-16 (W13-14): what the engineer's submission still needs on top of the gate's rules: one pack-out
 * count, while `pack_out_rule.requireOneOf` is on (seeded off). The same check the G2 decision runs.
 */
export function engineeringSubmissionExtras(
  kind: LeadReviewKind,
  workflow: WorkflowConfig,
  fields: QuoteState['fields'],
  packOutRule: Parameters<typeof packOutRequirementErrors>[0],
): DomainError[] {
  const spec = LEAD_REVIEW[kind];
  if (kind !== 'engineering') return [];
  if (!isForwardOutcome(workflow, spec.gateKey, spec.advanceOutcomeKey)) return [];
  return packOutRequirementErrors(packOutRule, fields);
}

async function load(tx: Tx, deps: LeadReviewDeps, quoteNumber: string) {
  const q = await getQuoteByNumber(tx, quoteNumber);
  if (!q) throw deps.notFound(quoteNumber);
  // DR-pricing-finance-04: submit and send-back lock the quote row first, so a double-click runs one
  // after the other: the second sees "already submitted" (409), with no second notice or email.
  await getQuoteForUpdate(tx, q.id);
  const state = (await loadQuoteState(tx, q.id))!;
  return { q, state };
}

const workName = (kind: LeadReviewKind) =>
  kind === 'engineering' ? 'engineering review' : 'pricing work';

/** POST …/submit: the assignee hands their part to the lead. */
export async function submitToLead(
  tx: Tx,
  deps: LeadReviewDeps,
  actor: Actor,
  kind: LeadReviewKind,
  quoteNumber: string,
  meta: AuditMeta,
  now: Date,
): Promise<void> {
  const { q, state } = await load(tx, deps, quoteNumber);
  const ctx = await deps.quotes.context(tx, actor, now);
  // The same fields the gate reads, the server-derived ones included (pass-through, Legal review).
  const fields = withDerivedFields(state, ctx.commercial.derived).fields;
  const workflow = parseWorkflowConfig(await loadWorkflowConfigInput(tx));
  const review = await getLeadReview(tx, q.id, kind);
  const plan = planSubmitToLead(kind, actor, state, review, workflow, fields);
  if (!plan.ok) deps.fail(plan.errors);
  // FB-16 (W13-14): one pack-out count, while the rule is switched on (off in the seed).
  const extras = engineeringSubmissionExtras(kind, workflow, fields, ctx.packOutRule);
  if (extras.length > 0) deps.fail(extras);

  const after: Partial<LeadReviewRow> = { submittedAt: now, submittedBy: actor.userId };
  await setLeadReview(tx, q.id, kind, after);
  const [me] = await listUsersByIds(tx, [actor.userId]);
  const actorName = me?.displayName ?? null;
  await insertActivityEvent(tx, {
    quoteId: q.id,
    type: 'lead_review_submitted',
    actorId: actor.userId,
    at: now,
    payload: { kind, byName: actorName, ...(kind === 'engineering' ? { part: 'engineer' } : {}) },
    createdBy: actor.userId,
  });
  await recordAudit(tx, actor, meta, {
    action: 'update',
    entity: 'quote',
    entityId: q.id,
    quoteId: q.id,
    before: { [`${kind}SubmittedAt`]: null },
    after: { [`${kind}SubmittedAt`]: now.toISOString(), [`${kind}SubmittedBy`]: actor.userId },
    at: now,
  });
  if (kind === 'engineering') {
    // FB-22 (N17-14): two parts; the lead is told per the setting, the scheduler hears the engineer's is in.
    const after = await loadEngineeringParts(tx, state, {
      ...review,
      submittedAt: now,
      submittedBy: actor.userId,
    });
    await announceEngineeringPart(tx, deps, actor, q, state, 'engineer', after, actorName, now);
    return;
  }
  const spec = LEAD_REVIEW[kind];
  // The lead is told (in-app and email). FB-05 (F-079): the KAM sees the quote reach the lead, in-app only.
  await deliverPlanned(
    tx,
    planLeadSubmitted(kind, state),
    actor.userId,
    (d) =>
      d.type === 'quote.submitted_to_lead'
        ? {
            title: `${quoteNumber} is ready for your review`,
            body: `${actorName ?? `The ${spec.noun.assignee}`} submitted the ${workName(kind)}. Review it, then decide ${spec.gateKey} or send it back.`,
            payload: { kind, ...(actorName ? { actor: actorName } : {}) },
          }
        : {
            title: `${quoteNumber}: the ${workName(kind)} is with the ${spec.noun.lead}`,
            body: `${actorName ?? `The ${spec.noun.assignee}`} submitted the ${workName(kind)} to the ${spec.noun.lead} for review.`,
            payload: { kind, ...(actorName ? { actor: actorName } : {}) },
          },
    q.id,
    { log: deps.log },
  );
}

const PART_NAME: Record<'engineer' | 'scheduler', string> = {
  engineer: 'the engineering part',
  scheduler: 'capacity',
};

/**
 * FB-22 (N17-14): after one part of an engineering review is submitted. The engineering lead is told
 * (`quote.submitted_to_lead`, in-app and email) per `app_setting.eng_lead_notify_when` (seed both_parts:
 * only once every part is in); the KAM sees it reach the lead (in-app) only then. The person who owns the
 * other part is told in-app (`quote.part_submitted`), unless they are a lead being told anyway.
 */
async function announceEngineeringPart(
  tx: Tx,
  deps: LeadReviewDeps,
  actor: Actor,
  q: Quote,
  state: QuoteState,
  part: 'engineer' | 'scheduler',
  after: EngParts,
  actorName: string | null,
  now: Date,
): Promise<void> {
  const n = q.quoteNumber;
  const who = actorName ?? (part === 'engineer' ? 'The engineer' : 'The production scheduler');
  const setting = parseEngLeadNotifyWhen(await getSetting(tx, 'eng_lead_notify_when'));
  const toLead = leadNoticeDue(setting, after);
  const other = part === 'engineer' ? after.scheduler : after.engineer;
  // A lead who owns the other part is told as the lead; no second notice.
  const otherId = other?.ownerId && !(toLead && other.ownerIsLead) ? asUserId(other.ownerId) : null;
  const leadEntries = toLead
    ? planLeadSubmitted('engineering', state).filter(
        (e) => after.ready || e.type === 'quote.submitted_to_lead',
      )
    : [];
  const missing =
    part === 'engineer'
      ? after.scheduler && !after.scheduler.in
        ? ' Capacity is not in yet.'
        : ''
      : !after.engineer.in
        ? ' The engineering part is not in yet.'
        : '';
  await deliverPlanned(
    tx,
    [...leadEntries, ...planPartSubmitted(otherId)],
    actor.userId,
    (d) =>
      d.type === 'quote.submitted_to_lead'
        ? {
            title: after.ready ? `${n} is ready for your review` : `${n}: ${PART_NAME[part]} is in`,
            body: after.ready
              ? `${who} submitted ${PART_NAME[part]}. Every part is in: review it, then decide G2 or send it back.`
              : `${who} submitted ${PART_NAME[part]}.${missing}`,
            payload: {
              kind: 'engineering',
              part,
              ready: after.ready ? 'yes' : 'no',
              ...(actorName ? { actor: actorName } : {}),
            },
          }
        : d.type === 'quote.part_submitted'
          ? {
              title: `${who} submitted ${PART_NAME[part]} for ${n}`,
              body: after.ready
                ? 'Every part is in. The engineering lead reviews it next.'
                : `It is with the engineering lead.${part === 'scheduler' && !after.engineer.in ? ' Submit your part when it is finished.' : part === 'engineer' && after.scheduler && !after.scheduler.in ? ' Submit capacity when it is finished.' : ''}`,
              payload: { kind: 'engineering', part, ...(actorName ? { actor: actorName } : {}) },
            }
          : {
              title: `${n}: the engineering review is with the engineering lead`,
              body: `${who} submitted ${PART_NAME[part]}; every part is now with the engineering lead for review.`,
              payload: { kind: 'engineering', ...(actorName ? { actor: actorName } : {}) },
            },
    q.id,
    { log: deps.log, at: now },
  );
}

/**
 * FB-22 (N17-14): POST …/eng-review/submit-capacity. The production scheduler assigned to the quote hands
 * the capacity part to the engineering lead. Checked against the G2 rules that read the capacity rows (less
 * the lead's sign-off); the rows are then locked for everyone but the lead until it is sent back.
 */
export async function submitCapacityToLead(
  tx: Tx,
  deps: LeadReviewDeps,
  actor: Actor,
  quoteNumber: string,
  meta: AuditMeta,
  now: Date,
): Promise<void> {
  const { q, state } = await load(tx, deps, quoteNumber);
  const ctx = await deps.quotes.context(tx, actor, now);
  const fields = withDerivedFields(state, ctx.commercial.derived).fields;
  const workflow = parseWorkflowConfig(await loadWorkflowConfigInput(tx));
  const review = await getLeadReview(tx, q.id, 'engineering');
  const plan = planSubmitCapacityToLead(actor, state, review, workflow, fields);
  if (!plan.ok) deps.fail(plan.errors);

  await setLeadReview(tx, q.id, 'engineering', {
    capacitySubmittedAt: now,
    capacitySubmittedBy: actor.userId,
  });
  const [me] = await listUsersByIds(tx, [actor.userId]);
  const actorName = me?.displayName ?? null;
  await insertActivityEvent(tx, {
    quoteId: q.id,
    type: 'lead_review_submitted',
    actorId: actor.userId,
    at: now,
    payload: { kind: 'engineering', part: 'capacity', byName: actorName },
    createdBy: actor.userId,
  });
  await recordAudit(tx, actor, meta, {
    action: 'update',
    entity: 'quote',
    entityId: q.id,
    quoteId: q.id,
    before: { capacitySubmittedAt: null },
    after: { capacitySubmittedAt: now.toISOString(), capacitySubmittedBy: actor.userId },
    at: now,
  });
  const after = await loadEngineeringParts(tx, state, {
    ...review,
    capacitySubmittedAt: now,
    capacitySubmittedBy: actor.userId,
  });
  await announceEngineeringPart(tx, deps, actor, q, state, 'scheduler', after, actorName, now);
}

/**
 * POST …/send-back: the lead returns the part with a note. FB-16 (W13-19): `target` is who it goes to:
 * the assignee (the default) or, in Engineering, the production scheduler assigned to the quote. Only
 * that person is notified (plus the KAM's in-app update).
 */
export async function returnToAssignee(
  tx: Tx,
  deps: LeadReviewDeps,
  actor: Actor,
  kind: LeadReviewKind,
  quoteNumber: string,
  note: string,
  meta: AuditMeta,
  now: Date,
  target: ReturnTarget = 'assignee',
): Promise<void> {
  const { q, state } = await load(tx, deps, quoteNumber);
  const review = await getLeadReview(tx, q.id, kind);
  const plan = planReturnToAssignee(kind, actor, state, review, note, target);
  if (!plan.ok) deps.fail(plan.errors);

  const trimmed = note.trim();
  // Who it goes to: the chosen person, or the assignee when the quote has nobody in that part.
  const assignee = returnTargetUser(kind, state, target) ?? assigneeOf(kind, state);
  // FB-22 (N17-14): a send-back clears only the chosen person's part: the scheduler's capacity, or the
  // engineer's (assignee's) part. The other part stays with the lead.
  const toSchedulerPart =
    kind === 'engineering' &&
    target === 'scheduler' &&
    returnTargetUser(kind, state, target) !== null;
  await setLeadReview(tx, q.id, kind, {
    ...(toSchedulerPart
      ? { capacitySubmittedAt: null, capacitySubmittedBy: null }
      : { submittedAt: null, submittedBy: null }),
    returnedAt: now,
    returnedBy: actor.userId,
    returnNote: trimmed,
    returnedTo: assignee,
  });
  const people = await listUsersByIds(
    tx,
    [actor.userId, assignee].filter((id): id is string => !!id),
  );
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.displayName ?? null;
  await insertActivityEvent(tx, {
    quoteId: q.id,
    type: 'lead_review_returned',
    actorId: actor.userId,
    at: now,
    payload: {
      kind,
      note: trimmed,
      byName: nameOf(actor.userId),
      toName: nameOf(assignee),
      // FB-16 (W13-19): which part it went back to.
      to: target === 'scheduler' ? 'scheduler' : 'assignee',
    },
    createdBy: actor.userId,
  });
  await recordAudit(tx, actor, meta, {
    action: 'update',
    entity: 'quote',
    entityId: q.id,
    quoteId: q.id,
    before: toSchedulerPart
      ? {
          capacitySubmittedAt: iso(review.capacitySubmittedAt),
          capacitySubmittedBy: review.capacitySubmittedBy,
        }
      : {
          [`${kind}SubmittedAt`]: iso(review.submittedAt),
          [`${kind}SubmittedBy`]: review.submittedBy,
        },
    after: {
      ...(toSchedulerPart ? { capacitySubmittedAt: null } : { [`${kind}SubmittedAt`]: null }),
      [`${kind}ReturnedAt`]: now.toISOString(),
      [`${kind}ReturnNote`]: trimmed,
      [`${kind}ReturnedTo`]: assignee,
    },
    at: now,
  });
  const leadName = nameOf(actor.userId);
  const toScheduler = target === 'scheduler';
  // The assignee is told in-app with the note, and by email without it (DR-pricing-finance-05: a note
  // can carry a price, and email never carries comment text). FB-05 (F-079): the KAM sees the send-back,
  // in-app only, without the note's detail in any email (there is none for that type).
  await deliverPlanned(
    tx,
    planLeadReturned(assignee ? asUserId(assignee) : null, state),
    actor.userId,
    (d) =>
      d.type === 'quote.returned_by_lead'
        ? {
            title: `${quoteNumber} was sent back to you`,
            body: `${leadName ?? `The ${LEAD_REVIEW[kind].noun.lead}`} asked for changes: ${trimmed}`,
            // DR-pricing-finance-05: the note is in the in-app body only, never in the email payload.
            payload: {
              kind,
              ...(leadName ? { actor: leadName } : {}),
              ...(toScheduler ? { to: 'scheduler' } : {}),
            },
          }
        : {
            title: `${quoteNumber}: the ${workName(kind)} was sent back to the ${toScheduler ? 'production scheduler' : LEAD_REVIEW[kind].noun.assignee}`,
            body: `${leadName ?? `The ${LEAD_REVIEW[kind].noun.lead}`} asked for changes: ${trimmed}`,
            payload: { kind, ...(leadName ? { actor: leadName } : {}) },
          },
    q.id,
    { log: deps.log },
  );
}
