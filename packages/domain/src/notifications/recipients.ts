import { ENG_QUEUE_STAGE_KEY } from '../engineering/queue';
import {
  CUSTOMER_DECISION_STAGE_KEY,
  FINAL_REVIEW_STAGE_KEY,
  RELEASE_GATE_KEY,
} from '../final-review/release';
import { LEAD_REVIEW, type LeadReviewKind } from '../lead-review';
import { rolesWithPermission } from '../policy/matrix';
import { PRICING_QUEUE_STAGE_KEY } from '../pricing/queue';
import type { UserId } from '../types/ids';
import type { Role } from '../types/roles';
import type { WorkflowConfig } from '../types/workflow-config';
import type {
  NotificationRecipient,
  PlannedNotification,
  TransitionEffects,
} from '../workflow/evaluate';
import { INTAKE_STAGE_KEY } from '../workflow/rework';

/**
 * Who is told when a quote moves (FB-05, F-079) or someone comments on it (F-034). Pure: the API loads
 * the users and writes the rows; this decides the people, the type and the wording variant.
 *
 * One event reaches **one notification per person**, however many parts that person plays: entries are
 * ordered by weight (declared targets first: the workflow config is the authority; then the next owner;
 * then the KAM; then the price approver) and `resolveDeliveries` keeps each person's first.
 */

/** What happened to the quote. */
export type HandoffEventKind =
  /** Moved to a later stage. */
  | 'advance'
  /** Sent back to an earlier work stage, or reworked in place (re-cost). */
  | 'return'
  /** Sent back to the KAM (it enters Intake). */
  | 'return_to_kam'
  | 'hold'
  | 'close'
  /** The KAM fixed a send-back with no scope change and the quote resumed where it came from. */
  | 'resume'
  /** A decision that changes neither stage nor status (redirect in place, negotiating). */
  | 'stay';

/** Where a send-back came from; the wording says "returned from Pricing". */
export type ReturnedFrom =
  | 'pricing'
  | 'final_review'
  | 'customer_requote'
  | 'commitment'
  | 'engineering'
  | 'kam_rework'
  | 'in_place';

export interface HandoffEvent {
  kind: HandoffEventKind;
  gateKey: string;
  outcomeKey: string;
  fromStageKey: string;
  toStageKey: string;
  returnedFrom: ReturnedFrom | null;
  /** The closure kind (`declined`, `awarded`, `lost`…) when the decision closes the quote. */
  closeAs: string | null;
  /** The review date of a hold (ISO date), when one was given. */
  holdUntil: string | null;
}

/** Why this person is on the list. */
export type HandoffReason = 'declared' | 'next_owner' | 'kam' | 'price_approver' | 'hold_owner';

export interface PlannedHandoff {
  type: string;
  recipient: NotificationRecipient;
  reason: HandoffReason;
  /** The recipient is the stage's assignee (the wording says "it is with you"). */
  asAssignee?: boolean;
  /**
   * The person who caused the event still gets this one when they hold the role (B-26: a KAM who is also
   * the engineering lead needs the queue alert for their own submit). Role recipients only.
   */
  viaRole?: boolean;
}

export interface MoveNotifyPlan {
  event: HandoffEvent;
  entries: PlannedHandoff[];
}

// ── Catalogue types the planner writes ───────────────────────────────────────────────────────────

export const HANDOFF_TYPES = {
  readyForEng: 'quote.ready_for_eng_review',
  readyForQuoting: 'quote.ready_for_quoting',
  readyForFinalReview: 'quote.ready_for_final_review',
  reworked: 'quote.reworked',
  progress: 'quote.progress',
  onHold: 'quote.on_hold',
  closed: 'quote.closed',
  approved: 'quote.approved_for_customer',
  declined: 'quote.declined',
  commentPosted: 'comment.posted',
  leadReviewUpdate: 'quote.lead_review_update',
  submittedToLead: 'quote.submitted_to_lead',
  returnedByLead: 'quote.returned_by_lead',
} as const;

/** Declared types the seeded workflow uses that are not catalogue types of their own: the arrival alert says it. */
const ARRIVAL_ALIASES = new Set(['quote.returned', 'quote.requote']);

/** Arrival alerts reach the person who caused the event when they hold the role (B-26). */
const VIA_ROLE_TYPES = new Set<string>([HANDOFF_TYPES.readyForEng, HANDOFF_TYPES.readyForQuoting]);

// ── Stage facts: who works and who leads each stage (from the permission matrix, not names) ─────

/** The roles that lead a stage: whoever may decide its gate (the EngLead, the PricingLead, the Approver). */
export function stageLeadRoles(stageKey: string): Role[] {
  switch (stageKey) {
    case ENG_QUEUE_STAGE_KEY:
      return rolesWithPermission(LEAD_REVIEW.engineering.leadPermission);
    case PRICING_QUEUE_STAGE_KEY:
      return rolesWithPermission(LEAD_REVIEW.pricing.leadPermission);
    case FINAL_REVIEW_STAGE_KEY:
      return rolesWithPermission('gate.G4.decide');
    default:
      return [];
  }
}

export interface HandoffQuote {
  kamUserId: UserId;
  assignedEngineerId?: UserId | null | undefined;
  assignedPricerId?: UserId | null | undefined;
}

/** The person a stage keeps assigned (the engineer in Engineering Review, the pricer in Quoting). */
export function stageAssignee(stageKey: string, quote: HandoffQuote): UserId | null {
  if (stageKey === ENG_QUEUE_STAGE_KEY) return quote.assignedEngineerId ?? null;
  if (stageKey === PRICING_QUEUE_STAGE_KEY) return quote.assignedPricerId ?? null;
  return null;
}

const arrivalType = (stageKey: string): string | null =>
  stageKey === ENG_QUEUE_STAGE_KEY
    ? HANDOFF_TYPES.readyForEng
    : stageKey === PRICING_QUEUE_STAGE_KEY
      ? HANDOFF_TYPES.readyForQuoting
      : stageKey === FINAL_REVIEW_STAGE_KEY
        ? HANDOFF_TYPES.readyForFinalReview
        : null;

const user = (userId: UserId): NotificationRecipient => ({ kind: 'user', userId });
const role = (r: Role): NotificationRecipient => ({ kind: 'role', role: r });

/**
 * The next owner of work arriving in `stageKey`: the assignee when the stage keeps one, and the roles
 * that lead it (who assign and decide); the engineering queue's backup assigners count as leads. KAM
 * stages (Intake, Customer Decision, Commit & Hand Off) belong to the KAM.
 */
export function nextOwnerEntries(
  stageKey: string,
  quote: HandoffQuote,
  config: Pick<WorkflowConfig, 'stages'>,
  backupAssigners: readonly UserId[] = [],
  /** Type for a KAM-owned or unrecognised stage (a "your quote moved" notice). */
  fallbackType: string = HANDOFF_TYPES.progress,
): PlannedHandoff[] {
  const type = arrivalType(stageKey);
  if (type) {
    const assignee = stageAssignee(stageKey, quote);
    return [
      ...(assignee
        ? [
            {
              type,
              recipient: user(assignee),
              reason: 'next_owner' as const,
              asAssignee: true,
            },
          ]
        : []),
      ...stageLeadRoles(stageKey).map((r): PlannedHandoff => ({
        type,
        recipient: role(r),
        reason: 'next_owner',
        ...(VIA_ROLE_TYPES.has(type) ? { viaRole: true } : {}),
      })),
      ...(stageKey === ENG_QUEUE_STAGE_KEY
        ? backupAssigners.map((id): PlannedHandoff => ({
            type,
            recipient: user(id),
            reason: 'next_owner',
          }))
        : []),
    ];
  }
  const owner = config.stages.find((s) => s.key === stageKey)?.ownerRole;
  if (!owner || owner === 'KAM') {
    return [
      {
        type: stageKey === INTAKE_STAGE_KEY ? HANDOFF_TYPES.reworked : fallbackType,
        recipient: user(quote.kamUserId),
        reason: 'next_owner',
      },
    ];
  }
  return [{ type: fallbackType, recipient: role(owner), reason: 'next_owner' }];
}

// ── Gate decisions ───────────────────────────────────────────────────────────────────────────────

export interface MoveNotifyInput {
  config: Pick<WorkflowConfig, 'stages' | 'outcomes'>;
  effects: Pick<
    TransitionEffects,
    | 'fromStageKey'
    | 'nextStageKey'
    | 'nextStatus'
    | 'closeAs'
    | 'hold'
    | 'notifications'
    | 'reworkReturn'
    | 'gateDecisionRecord'
  >;
  /** The quote as it stood when the decision was taken (assignments are kept across stages). */
  quote: HandoffQuote;
  /** The engineering queue's backup assigners (a setting): they get the queue alert with the leads. */
  backupAssigners?: readonly UserId[];
  /** Who recorded the price approval at G3 (Final Review decisions tell them). */
  priceApproverId?: UserId | null;
}

const RETURNED_FROM_STAGE: Record<string, ReturnedFrom> = {
  [PRICING_QUEUE_STAGE_KEY]: 'pricing',
  [FINAL_REVIEW_STAGE_KEY]: 'final_review',
  [CUSTOMER_DECISION_STAGE_KEY]: 'customer_requote',
  COMMIT_HANDOFF: 'commitment',
  [ENG_QUEUE_STAGE_KEY]: 'engineering',
};

/** What kind of hand-off a decision is, read from where it sends the quote. */
export function classifyHandoff(input: MoveNotifyInput): HandoffEvent {
  const { effects, config } = input;
  const record = effects.gateDecisionRecord;
  const from = effects.fromStageKey;
  const to = effects.nextStageKey;
  const order = (key: string) => config.stages.findIndex((s) => s.key === key);
  const outcome = config.outcomes.find(
    (o) => o.gateKey === record.gateKey && o.key === record.outcomeKey,
  );
  const base = {
    gateKey: record.gateKey,
    outcomeKey: record.outcomeKey,
    fromStageKey: from,
    toStageKey: to,
    closeAs: effects.closeAs ?? null,
    holdUntil: typeof record.payload?.review_date === 'string' ? record.payload.review_date : null,
  };
  if (effects.nextStatus === 'closed') return { ...base, kind: 'close', returnedFrom: null };
  if (effects.hold.action === 'start') return { ...base, kind: 'hold', returnedFrom: null };
  if (effects.reworkReturn) return { ...base, kind: 'return_to_kam', returnedFrom: null };
  if (to === from) {
    // Reworked in place (G3 "re-cost"): the assignee gets it back. Anything else that stays put is a
    // recorded decision the KAM should see.
    return outcome?.reasonContext === 'rework' && arrivalType(to)
      ? { ...base, kind: 'return', returnedFrom: 'in_place' }
      : { ...base, kind: 'stay', returnedFrom: null };
  }
  if (order(to) > order(from)) return { ...base, kind: 'advance', returnedFrom: null };
  return { ...base, kind: 'return', returnedFrom: RETURNED_FROM_STAGE[from] ?? null };
}

/** `quote.returned` / `quote.requote` (declared in the seeded workflow) are announced by the stage's arrival alert. */
const canonicalType = (declared: string, toStageKey: string): string =>
  ARRIVAL_ALIASES.has(declared) ||
  // "Returned to you" is the KAM's notice; a send-back that lands in Engineering or Quoting is that
  // stage's arrival alert ("returned from Pricing").
  (declared === HANDOFF_TYPES.reworked && toStageKey !== INTAKE_STAGE_KEY)
    ? (arrivalType(toStageKey) ?? HANDOFF_TYPES.progress)
    : declared;

/**
 * The people a gate decision tells: the outcome's declared targets, plus the next owner and the quote's
 * KAM. The caller removes the person who decided (`resolveDeliveries`).
 */
export function planMoveNotifications(input: MoveNotifyInput): MoveNotifyPlan {
  const event = classifyHandoff(input);
  const { effects, quote, config } = input;
  const entries: PlannedHandoff[] = [];

  // 1. Declared on the outcome (config is the authority).
  for (const n of effects.notifications as readonly PlannedNotification[]) {
    const type = canonicalType(n.type, event.toStageKey);
    entries.push({
      type,
      recipient: n.recipient,
      reason: 'declared',
      ...(n.recipient.kind === 'role' && VIA_ROLE_TYPES.has(type) ? { viaRole: true } : {}),
    });
  }

  // 2. The next owner.
  const kamUser = user(quote.kamUserId);
  switch (event.kind) {
    case 'advance':
    case 'return':
      entries.push(
        ...nextOwnerEntries(event.toStageKey, quote, config, input.backupAssigners ?? []).map(
          // Reworked in place by the lead who decided: they do not need the queue alert too.
          (e) => (event.returnedFrom === 'in_place' ? { ...e, viaRole: false } : e),
        ),
      );
      break;
    case 'return_to_kam':
      entries.push({ type: HANDOFF_TYPES.reworked, recipient: kamUser, reason: 'next_owner' });
      break;
    case 'hold': {
      const ownerId = effects.gateDecisionRecord.payload?.hold_owner_id;
      if (typeof ownerId === 'string' && ownerId) {
        entries.push({
          type: HANDOFF_TYPES.onHold,
          recipient: user(ownerId as UserId),
          reason: 'hold_owner',
        });
      }
      break;
    }
    default:
      break;
  }

  // 3. The KAM always hears where their quote stands.
  const kamType =
    event.kind === 'hold'
      ? HANDOFF_TYPES.onHold
      : event.kind === 'close'
        ? HANDOFF_TYPES.closed
        : event.kind === 'return_to_kam'
          ? HANDOFF_TYPES.reworked
          : HANDOFF_TYPES.progress;
  entries.push({ type: kamType, recipient: kamUser, reason: 'kam' });

  // 4. Final Review tells the person who approved the price at G3 (Approve and Decline).
  const finalType = (effects.notifications as readonly PlannedNotification[])
    .map((n) => n.type)
    .find((t) => t === HANDOFF_TYPES.approved || t === HANDOFF_TYPES.declined);
  if (
    input.priceApproverId &&
    finalType &&
    effects.gateDecisionRecord.gateKey === RELEASE_GATE_KEY &&
    (event.kind === 'advance' || event.kind === 'close')
  ) {
    entries.push({
      type: finalType,
      recipient: user(input.priceApproverId),
      reason: 'price_approver',
    });
  }

  return { event, entries };
}

/** The KAM's resubmission resumed the quote where a send-back began (no scope change): who is told. */
export function planResume(
  originStageKey: string,
  quote: HandoffQuote,
  config: Pick<WorkflowConfig, 'stages'>,
  backupAssigners: readonly UserId[] = [],
): PlannedHandoff[] {
  return nextOwnerEntries(originStageKey, quote, config, backupAssigners);
}

// ── Lead review ──────────────────────────────────────────────────────────────────────────────────

/** The assignee submits to their lead: the lead is told; the KAM sees progress, in-app only. */
export function planLeadSubmitted(kind: LeadReviewKind, quote: HandoffQuote): PlannedHandoff[] {
  return [
    ...rolesWithPermission(LEAD_REVIEW[kind].leadPermission).map((r): PlannedHandoff => ({
      type: HANDOFF_TYPES.submittedToLead,
      recipient: role(r),
      reason: 'next_owner',
    })),
    { type: HANDOFF_TYPES.leadReviewUpdate, recipient: user(quote.kamUserId), reason: 'kam' },
  ];
}

/** The lead sends the part back: the assignee is told; the KAM sees progress, in-app only. */
export function planLeadReturned(assigneeId: UserId | null, quote: HandoffQuote): PlannedHandoff[] {
  return [
    ...(assigneeId
      ? [
          {
            type: HANDOFF_TYPES.returnedByLead,
            recipient: user(assigneeId),
            reason: 'next_owner' as const,
          },
        ]
      : []),
    { type: HANDOFF_TYPES.leadReviewUpdate, recipient: user(quote.kamUserId), reason: 'kam' },
  ];
}

// ── Comments ─────────────────────────────────────────────────────────────────────────────────────

/**
 * A comment tells the quote's KAM, the current assignee, the current stage's lead and everyone who has
 * commented before. The author and anyone @mentioned (who gets the mention instead) are removed by
 * `resolveDeliveries`.
 */
export function planCommentRecipients(input: {
  stageKey: string;
  quote: HandoffQuote;
  previousCommenters: readonly UserId[];
}): PlannedHandoff[] {
  const type = HANDOFF_TYPES.commentPosted;
  const assignee = stageAssignee(input.stageKey, input.quote);
  return [
    { type, recipient: user(input.quote.kamUserId), reason: 'kam' },
    ...(assignee
      ? [
          {
            type,
            recipient: user(assignee),
            reason: 'next_owner' as const,
            asAssignee: true,
          },
        ]
      : []),
    ...stageLeadRoles(input.stageKey).map((r): PlannedHandoff => ({
      type,
      recipient: role(r),
      reason: 'next_owner',
    })),
    ...input.previousCommenters.map((id): PlannedHandoff => ({
      type,
      recipient: user(id),
      reason: 'declared',
    })),
  ];
}

// ── Resolution: roles to people, one notification each ───────────────────────────────────────────

export interface Delivery {
  userId: UserId;
  type: string;
  reason: HandoffReason;
  asAssignee: boolean;
}

/**
 * Turns entries into one delivery per person. `members` lists the active users holding a role. The
 * first entry that reaches a person wins, so declared targets and the next owner outrank the KAM's
 * progress notice. The actor is skipped, except through a role entry marked `viaRole`; `exclude` skips
 * anyone else who is told another way (an @mentioned user).
 */
export function resolveDeliveries(
  entries: readonly PlannedHandoff[],
  members: (role: Role) => readonly UserId[],
  actorId: UserId | string,
  exclude: ReadonlySet<string> = new Set(),
): Delivery[] {
  const seen = new Set<string>();
  const out: Delivery[] = [];
  for (const entry of entries) {
    const ids: readonly UserId[] =
      entry.recipient.kind === 'user' ? [entry.recipient.userId] : members(entry.recipient.role);
    for (const userId of ids) {
      if (seen.has(userId) || exclude.has(userId)) continue;
      const viaRole = entry.recipient.kind === 'role' && entry.viaRole === true;
      if (userId === actorId && !viaRole) continue;
      seen.add(userId);
      out.push({
        userId,
        type: entry.type,
        reason: entry.reason,
        asAssignee: entry.asAssignee === true,
      });
    }
  }
  return out;
}

/** Every role an entry list reaches (the API loads their members once). */
export const rolesIn = (entries: readonly PlannedHandoff[]): Role[] => [
  ...new Set(entries.flatMap((e) => (e.recipient.kind === 'role' ? [e.recipient.role] : []))),
];
