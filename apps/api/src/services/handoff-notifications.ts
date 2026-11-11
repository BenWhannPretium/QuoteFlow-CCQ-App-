import type { DbOrTx } from '@ccq/db';
import {
  findUserById,
  getPricingRecord,
  listActiveUserIdsWithRoles,
  listUsersByIds,
} from '@ccq/db/repos';
import {
  HANDOFF_TYPES,
  asUserId,
  planMoveNotifications,
  planResume,
  resolveDeliveries,
  rolesIn,
  type Delivery,
  type HandoffEvent,
  type PlannedHandoff,
  type ProposalReleasePlan,
  type QuoteState,
  type Role,
  type TransitionEffects,
  type UserId,
  type WorkflowConfig,
} from '@ccq/domain';
import type { FastifyBaseLogger } from 'fastify';

import { loadEngQueueSettings } from './engineering-view';
import { createNotifications, type NotificationDraft } from './notificationService';

/**
 * FB-05 (F-079): the notifications for a hand-off. After a gate decision (or a KAM resubmission that
 * resumes a send-back), the declared `notify` targets of the outcome, the next owner and the quote's KAM
 * are told, in-app and by email, once each. The domain decides the people (`planMoveNotifications`);
 * this loads the users, words each notice and writes the rows in the caller's transaction, so a
 * rolled-back decision leaves nothing behind.
 *
 * Free text (the note) is in the in-app body only. The email is built from `payload`, which holds
 * strings that are safe to send: the actor, a stage or reason label, a date. Never a note or a figure.
 */

/** In-app bodies carry the decider's note, shortened. */
const NOTE_MAX = 280;
const shorten = (s: string) => (s.length > NOTE_MAX ? `${s.slice(0, NOTE_MAX - 1)}…` : s);

const sentence = (...parts: (string | false | null | undefined)[]) =>
  parts.filter((p): p is string => Boolean(p)).join(' ');

/** DR-kam-sales-leader-12: one full stop at the end of free text (none added after "." "!" "?" or "…"). */
export const endSentence = (text: string) =>
  /[.!?…]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;

/** What the notice needs to say; everything is read in the decision's transaction. */
export interface HandoffContext {
  quote: { id: string; quoteNumber: string };
  actorName: string | null;
  workflow: Pick<WorkflowConfig, 'stages' | 'outcomes' | 'reasonCodes'>;
  event: HandoffEvent;
  /** The decider's note (in-app only). */
  note: string | null;
  reasonLabel: string | null;
  outcomeLabel: string;
  /** Approve: when the proposal is valid until. */
  validityUntil: string | null;
}

const stageLabel = (c: Pick<WorkflowConfig, 'stages'>, key: string) =>
  c.stages.find((s) => s.key === key)?.label ?? key;

/** "Pricing sent it back." / "Final Review returned it for another look." */
function returnedSentence(ctx: HandoffContext): string | null {
  switch (ctx.event.returnedFrom) {
    case 'final_review':
      return 'Final Review returned it for another look.';
    case 'customer_requote':
      return 'The customer asked for a re-quote.';
    case 'commitment':
      return 'Commit & Hand Off sent it back: something changed since the quote.';
    case 'pricing':
      return 'Pricing sent it back to Engineering.';
    case 'in_place':
      return 'The lead sent the work back for rework.';
    case 'kam_rework':
      return 'The KAM fixed what Pricing sent back, with no scope change.';
    default:
      return null;
  }
}

/** The title, in-app body and email payload of one delivery. */
export function composeHandoff(
  d: Pick<Delivery, 'type' | 'asAssignee' | 'reason'>,
  ctx: HandoffContext,
): { title: string; body: string; payload: Record<string, string> } {
  const n = ctx.quote.quoteNumber;
  const e = ctx.event;
  const to = stageLabel(ctx.workflow, e.toStageKey);
  const from = stageLabel(ctx.workflow, e.fromStageKey);
  const reasonAndNote = sentence(
    ctx.reasonLabel && `Reason: ${ctx.reasonLabel}.`,
    ctx.note && `Note: ${endSentence(shorten(ctx.note))}`,
  );
  const payload: Record<string, string> = {
    ...(ctx.actorName ? { actor: ctx.actorName } : {}),
    ...(ctx.reasonLabel ? { reason: ctx.reasonLabel } : {}),
    ...(e.returnedFrom ? { returnedFrom: e.returnedFrom } : {}),
    ...(d.asAssignee ? { assignee: 'yes' } : {}),
  };

  switch (d.type) {
    case HANDOFF_TYPES.readyForEng: {
      const returned = e.returnedFrom !== null || e.kind === 'resume';
      return {
        title: returned
          ? d.asAssignee
            ? `${n} is back with you in Engineering`
            : e.returnedFrom === 'pricing'
              ? `${n} was returned to Engineering from Pricing`
              : `${n} was returned to Engineering`
          : `${n} is in the engineering queue`,
        body: sentence(
          returnedSentence(ctx),
          reasonAndNote,
          d.asAssignee
            ? 'Open the engineering review to pick it up.'
            : 'Open the engineering queue to assign it.',
        ),
        payload,
      };
    }
    case HANDOFF_TYPES.readyForQuoting: {
      const returned = e.returnedFrom !== null || e.kind === 'resume';
      const resumed = e.returnedFrom === 'kam_rework' || e.kind === 'resume';
      return {
        title: resumed
          ? `${n} is back from the KAM`
          : returned
            ? e.returnedFrom === 'in_place'
              ? `${n} was sent back to you for rework`
              : `${n} was returned to Quoting`
            : `${n} is ready for pricing`,
        body: resumed
          ? 'The KAM fixed what Pricing sent back, with no scope change. It is back in Quoting with the same pricer: record the price approval again.'
          : returned
            ? sentence(
                returnedSentence(ctx),
                reasonAndNote,
                'Open the pricing queue to record the price approval again.',
              )
            : 'Engineering has cleared it. Open the pricing queue to record the price approval.',
        payload: resumed ? { ...payload, returnedFrom: 'kam_rework' } : payload,
      };
    }
    case HANDOFF_TYPES.readyForFinalReview:
      return {
        title: `${n} is ready for Final Review`,
        body: 'Pricing has approved the price. Open Approvals to release or return the proposition.',
        payload,
      };
    case HANDOFF_TYPES.reworked:
      return {
        title: `${n} was returned to you for rework`,
        body: sentence(
          `${from} sent it back.`,
          reasonAndNote,
          'Open the quote to see what to fix, then resubmit it.',
        ),
        payload: { ...payload, from },
      };
    case HANDOFF_TYPES.progress: {
      const direction =
        e.kind === 'advance' ? 'advanced' : e.kind === 'return' ? 'returned' : 'decision';
      const title =
        e.kind === 'advance'
          ? `${n} moved on to ${to}`
          : e.kind === 'return'
            ? e.returnedFrom === 'in_place'
              ? `${n} was sent back for rework in ${to}`
              : `${n} was sent back to ${to}`
            : `${n}: ${ctx.outcomeLabel}`;
      const who = ctx.actorName ? `${ctx.actorName} ` : '';
      const body =
        e.kind === 'advance'
          ? `${who ? `${who}advanced` : 'Advanced'} from ${from} to ${to}.`
          : e.kind === 'return'
            ? sentence(returnedSentence(ctx) ?? `Sent back from ${from} to ${to}.`, reasonAndNote)
            : sentence(`${ctx.outcomeLabel} was recorded at ${from}.`, reasonAndNote);
      return {
        title,
        body,
        payload: { ...payload, direction, stage: to, fromStage: from, outcome: ctx.outcomeLabel },
      };
    }
    case HANDOFF_TYPES.onHold: {
      const owner = d.reason === 'hold_owner';
      return {
        title: owner ? `${n} is on hold: you own the hold` : `${n} was put on hold`,
        body: sentence(
          owner ? 'You are the hold owner.' : `Put on hold at ${from}.`,
          ctx.reasonLabel && `Reason: ${ctx.reasonLabel}.`,
          e.holdUntil && `Review date: ${e.holdUntil}.`,
          ctx.note && `Note: ${endSentence(shorten(ctx.note))}`,
        ),
        payload: {
          ...payload,
          owner: owner ? 'you' : 'other',
          stage: from,
          ...(e.holdUntil ? { reviewDate: e.holdUntil } : {}),
        },
      };
    }
    case HANDOFF_TYPES.closed:
      return {
        title: `${n} was closed: ${to}`,
        body: sentence(
          `${ctx.outcomeLabel} was recorded at ${from}.`,
          reasonAndNote,
          'Open the quote for the details.',
        ),
        payload: { ...payload, outcome: to, stage: from },
      };
    case HANDOFF_TYPES.approved:
      return {
        title: `${n} is approved: issue the proposal`,
        body: `Approved; issue the proposal.${ctx.validityUntil ? ` It is valid until ${ctx.validityUntil}.` : ''}`,
        payload: ctx.validityUntil ? { validityUntil: ctx.validityUntil } : {},
      };
    case HANDOFF_TYPES.declined:
      return {
        title: `${n} was declined at Final Review`,
        body: `Reason: ${ctx.reasonLabel ?? 'not given'}. Open the quote for the approver's note.`,
        payload: ctx.reasonLabel ? { reason: ctx.reasonLabel } : {},
      };
    default:
      // A type the outcome declares that has no wording of its own: say what was decided.
      return {
        title: `${n}: ${ctx.outcomeLabel}`,
        body: sentence(`${ctx.outcomeLabel} was recorded at ${from}.`, reasonAndNote),
        payload,
      };
  }
}

/** The active users holding each role in `entries`, once. */
async function roleMembers(tx: DbOrTx, entries: readonly PlannedHandoff[]) {
  const roles = rolesIn(entries);
  const byRole = new Map<Role, UserId[]>();
  for (const r of roles) {
    byRole.set(r, (await listActiveUserIdsWithRoles(tx, [r])).map(asUserId));
  }
  return (r: Role): readonly UserId[] => byRole.get(r) ?? [];
}

/** The backup assigners (a setting) who are still active users. */
async function activeBackupAssigners(tx: DbOrTx): Promise<UserId[]> {
  const settings = await loadEngQueueSettings(tx);
  const users = await listUsersByIds(tx, [...settings.backupAssignerUserIds]);
  return users.filter((u) => u.active).map((u) => asUserId(u.id));
}

const handoffQuote = (
  state: Pick<QuoteState, 'kamUserId' | 'assignedEngineerId' | 'assignedPricerId'>,
) => ({
  kamUserId: state.kamUserId,
  assignedEngineerId: state.assignedEngineerId ?? null,
  assignedPricerId: state.assignedPricerId ?? null,
});

/**
 * Tell the people a gate decision concerns. Called once, in the decision's transaction, after the
 * transition has been written. Returns the number of people notified.
 */
export async function deliverDecisionNotifications(
  tx: DbOrTx,
  input: {
    quote: { id: string; quoteNumber: string };
    actorId: string;
    /** The quote before the decision (assignments are kept across stages). */
    state: Pick<QuoteState, 'kamUserId' | 'assignedEngineerId' | 'assignedPricerId'>;
    effects: TransitionEffects;
    workflow: WorkflowConfig;
    proposal: Extract<ProposalReleasePlan, { ok: true }> | null;
  },
  log?: FastifyBaseLogger,
): Promise<number> {
  const { effects, workflow } = input;
  const approver = (await getPricingRecord(tx, input.quote.id))?.priceApprovedBy;
  const plan = planMoveNotifications({
    config: workflow,
    effects,
    quote: handoffQuote(input.state),
    backupAssigners: await activeBackupAssigners(tx),
    priceApproverId: approver ? asUserId(approver) : null,
  });
  const record = effects.gateDecisionRecord;
  const outcome = workflow.outcomes.find(
    (o) => o.gateKey === record.gateKey && o.key === record.outcomeKey,
  );
  const reasonLabel =
    workflow.reasonCodes.find(
      (r) => r.code === record.reasonCode && r.context === outcome?.reasonContext,
    )?.label ?? null;
  const ctx: HandoffContext = {
    quote: input.quote,
    actorName: (await findUserById(tx, input.actorId))?.displayName ?? null,
    workflow,
    event: plan.event,
    note: record.note?.trim() || null,
    reasonLabel,
    outcomeLabel: outcome?.label ?? record.outcomeKey,
    validityUntil: input.proposal?.validityUntil ?? null,
  };
  return deliver(tx, plan.entries, input.actorId, ctx, log);
}

/**
 * The KAM fixed a send-back with no scope change and the quote resumed where it came from (FB-01, F-030):
 * tell the assignee and the stage's lead ("back from the KAM"). The KAM caused it, so they are not told.
 */
export async function deliverResumeNotifications(
  tx: DbOrTx,
  input: {
    quote: { id: string; quoteNumber: string };
    actorId: string;
    state: Pick<QuoteState, 'kamUserId' | 'assignedEngineerId' | 'assignedPricerId'>;
    originStageKey: string;
    workflow: WorkflowConfig;
  },
  log?: FastifyBaseLogger,
): Promise<number> {
  const entries = planResume(
    input.originStageKey,
    handoffQuote(input.state),
    input.workflow,
    await activeBackupAssigners(tx),
  );
  const ctx: HandoffContext = {
    quote: input.quote,
    actorName: (await findUserById(tx, input.actorId))?.displayName ?? null,
    workflow: input.workflow,
    event: {
      kind: 'resume',
      gateKey: '',
      outcomeKey: '',
      fromStageKey: 'INTAKE',
      toStageKey: input.originStageKey,
      returnedFrom: 'kam_rework',
      closeAs: null,
      holdUntil: null,
    },
    note: null,
    reasonLabel: null,
    outcomeLabel: 'Resubmitted',
    validityUntil: null,
  };
  return deliver(tx, entries, input.actorId, ctx, log);
}

async function deliver(
  tx: DbOrTx,
  entries: readonly PlannedHandoff[],
  actorId: string,
  ctx: HandoffContext,
  log?: FastifyBaseLogger,
): Promise<number> {
  const deliveries = resolveDeliveries(entries, await roleMembers(tx, entries), actorId);
  const drafts: NotificationDraft[] = deliveries.map((d) => ({
    userId: d.userId,
    type: d.type,
    quoteId: ctx.quote.id,
    ...composeHandoff(d, ctx),
  }));
  return createNotifications(tx, drafts, log);
}

/** Write notices that carry their own wording (lead review, comments): one per person, the actor excluded. */
export async function deliverPlanned(
  tx: DbOrTx,
  entries: readonly PlannedHandoff[],
  actorId: string,
  compose: (d: Delivery) => Pick<NotificationDraft, 'title' | 'body'> & {
    payload?: Record<string, string>;
    dedupeKey?: string;
  },
  quoteId: string,
  opts: {
    exclude?: ReadonlySet<string>;
    log?: FastifyBaseLogger | undefined;
    emailDelayMs?: number;
    /** The event time (the caller's clock). Default: now. */
    at?: Date;
  } = {},
): Promise<number> {
  const deliveries = resolveDeliveries(
    entries,
    await roleMembers(tx, entries),
    actorId,
    opts.exclude,
  );
  const drafts: NotificationDraft[] = deliveries.map((d) => ({
    userId: d.userId,
    type: d.type,
    quoteId,
    ...compose(d),
    ...(opts.emailDelayMs ? { emailDelayMs: opts.emailDelayMs } : {}),
    ...(opts.at ? { at: opts.at } : {}),
  }));
  return createNotifications(tx, drafts, opts.log);
}
