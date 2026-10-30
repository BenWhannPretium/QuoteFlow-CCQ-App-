import type { DbOrTx, Tx } from '@ccq/db';
import {
  getLeadReview,
  getQuoteByNumber,
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
  canSubmitToLead,
  leadReviewStatus,
  parseWorkflowConfig,
  planReturnToAssignee,
  planSubmitToLead,
  rolesWithPermission,
  withDerivedFields,
  type Actor,
  type DomainError,
  type LeadReviewKind,
  type QuoteState,
} from '@ccq/domain';
import type { FastifyBaseLogger } from 'fastify';

import { persistNotifications } from './notificationService';
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
  const people = await listUsersByIds(
    tx,
    [review.submittedBy, review.returnedBy].filter((id): id is string => !!id),
  );
  const name = (id: string | null) => (id && people.find((p) => p.id === id)?.displayName) || null;
  return {
    status: leadReviewStatus(review),
    submittedAt: iso(review.submittedAt),
    submittedByName: name(review.submittedBy),
    returnedAt: iso(review.returnedAt),
    returnedByName: name(review.returnedBy),
    returnNote: review.returnNote,
    canSubmit: canSubmitToLead(kind, actor, state, review),
    canSendBack: canReturnToAssignee(kind, actor, state, review),
  };
}

async function load(tx: Tx, deps: LeadReviewDeps, quoteNumber: string) {
  const q = await getQuoteByNumber(tx, quoteNumber);
  if (!q) throw deps.notFound(quoteNumber);
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

  const after: Partial<LeadReviewRow> = { submittedAt: now, submittedBy: actor.userId };
  await setLeadReview(tx, q.id, kind, after);
  const [me] = await listUsersByIds(tx, [actor.userId]);
  const actorName = me?.displayName ?? null;
  await insertActivityEvent(tx, {
    quoteId: q.id,
    type: 'lead_review_submitted',
    actorId: actor.userId,
    at: now,
    payload: { kind, byName: actorName },
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
  const spec = LEAD_REVIEW[kind];
  await persistNotifications(
    tx,
    rolesWithPermission(spec.leadPermission).map((role) => ({
      type: 'quote.submitted_to_lead',
      recipient: { kind: 'role' as const, role },
    })),
    {
      quoteId: q.id,
      title: `${quoteNumber} is ready for your review`,
      body: `${actorName ?? `The ${spec.noun.assignee}`} submitted the ${workName(kind)}. Review it, then decide ${spec.gateKey} or send it back.`,
      excludeUserId: actor.userId,
      payload: { kind, ...(actorName ? { actor: actorName } : {}) },
    },
    deps.log,
  );
}

/** POST …/send-back: the lead returns the part to the assignee with a note. */
export async function returnToAssignee(
  tx: Tx,
  deps: LeadReviewDeps,
  actor: Actor,
  kind: LeadReviewKind,
  quoteNumber: string,
  note: string,
  meta: AuditMeta,
  now: Date,
): Promise<void> {
  const { q, state } = await load(tx, deps, quoteNumber);
  const review = await getLeadReview(tx, q.id, kind);
  const plan = planReturnToAssignee(kind, actor, state, review, note);
  if (!plan.ok) deps.fail(plan.errors);

  const trimmed = note.trim();
  await setLeadReview(tx, q.id, kind, {
    submittedAt: null,
    submittedBy: null,
    returnedAt: now,
    returnedBy: actor.userId,
    returnNote: trimmed,
  });
  const assignee = assigneeOf(kind, state);
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
    payload: { kind, note: trimmed, byName: nameOf(actor.userId), toName: nameOf(assignee) },
    createdBy: actor.userId,
  });
  await recordAudit(tx, actor, meta, {
    action: 'update',
    entity: 'quote',
    entityId: q.id,
    quoteId: q.id,
    before: {
      [`${kind}SubmittedAt`]: iso(review.submittedAt),
      [`${kind}SubmittedBy`]: review.submittedBy,
    },
    after: {
      [`${kind}SubmittedAt`]: null,
      [`${kind}ReturnedAt`]: now.toISOString(),
      [`${kind}ReturnNote`]: trimmed,
    },
    at: now,
  });
  if (assignee) {
    const leadName = nameOf(actor.userId);
    await persistNotifications(
      tx,
      [{ type: 'quote.returned_by_lead', recipient: { kind: 'user', userId: asUserId(assignee) } }],
      {
        quoteId: q.id,
        title: `${quoteNumber} was sent back to you`,
        body: `${leadName ?? `The ${LEAD_REVIEW[kind].noun.lead}`} asked for changes: ${trimmed}`,
        excludeUserId: actor.userId,
        payload: { kind, note: trimmed, ...(leadName ? { actor: leadName } : {}) },
      },
      deps.log,
    );
  }
}
