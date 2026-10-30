import { z } from 'zod';

import { LeadReviewFilter } from './lead-review';
import { QuoteSummary } from './quotes';

// ── B-10 Engineering queue (F-04, F-07, DEC-26) ──────────────────────────────────────────────────

export const AgingBucket = z.enum(['fresh', 'aging', 'old']);
export type AgingBucket = z.infer<typeof AgingBucket>;

const csv = z
  .string()
  .max(500)
  .transform((s) =>
    s
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  );

/** GET /api/v1/queue/engineering. List filters are comma-separated (`tier=CRITICAL,HIGH`). */
export const EngQueueQuery = z.object({
  tier: csv.optional(),
  /** An engineer's user id, `unassigned`, or `me`. */
  engineer: z.string().max(64).optional(),
  /** Only quotes in the queue for more than N business days. */
  agedOver: z.coerce.number().int().min(0).max(365).optional(),
  bucket: csv.pipe(z.array(AgingBucket)).optional(),
  productFamily: csv.optional(),
  q: z.string().max(200).optional(),
  /** Lead review: `ready` = only what waits on the lead's review ("Ready for my review"). */
  review: LeadReviewFilter.optional(),
});
export type EngQueueQuery = z.input<typeof EngQueueQuery>;
/** The query after parsing (what the route hands the service). */
export type EngQueueFilters = z.output<typeof EngQueueQuery>;

export const CompletenessWarning = z.object({
  code: z.string(),
  field: z.string(),
  message: z.string(),
});
export type CompletenessWarning = z.infer<typeof CompletenessWarning>;

export const EngQueueItem = QuoteSummary.extend({
  /** When the quote entered Engineering Review this time (time in queue runs from here). */
  enteredQueueAt: z.string().nullable(),
  businessDaysInQueue: z.number().int(),
  agingBucket: AgingBucket,
  /** Time in the stage excluding holds (ms), from `computeTimeInStage`. */
  activeMsInStage: z.number(),
  assignedEngineerId: z.string().nullable(),
  assignedEngineerName: z.string().nullable(),
  assignedAt: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  /** unassigned → assigned (awaiting acceptance) → accepted (review in progress). */
  queueStatus: z.enum(['unassigned', 'assigned', 'accepted']),
  /** Lead review: submitted to the lead (waiting on them), sent back, or neither. */
  leadReview: z.enum(['none', 'submitted', 'returned']),
  /** When the assignee submitted it (null unless `submitted`). */
  submittedAt: z.string().nullable(),
  /** Pinned by an applied queue_position override. */
  pinned: z.boolean(),
  queuePosition: z.number().int().nullable(),
  drawingStatus: z.string().nullable(),
  sfCloseDate: z.string().nullable(),
  completeness: z.array(CompletenessWarning),
  /** The caller may edit this quote's Engineering Review. */
  canEdit: z.boolean(),
});
export type EngQueueItem = z.infer<typeof EngQueueItem>;

export const AssignableEngineer = z.object({
  id: z.string(),
  displayName: z.string(),
  roles: z.array(z.string()),
  /** Open quotes in Engineering Review assigned to them. */
  openCount: z.number().int(),
});
export type AssignableEngineer = z.infer<typeof AssignableEngineer>;

export const EngQueueResponse = z.object({
  stage: z.object({ key: z.string(), label: z.string() }),
  /** Business-day aging buckets (config `eng_queue_aging_days`). Not an SLA (D-20). */
  aging: z.object({
    edges: z.object({ aging: z.number().int(), old: z.number().int() }),
    labels: z.record(AgingBucket, z.string()),
    /** Over the whole queue the caller can see, before filters. */
    counts: z.record(AgingBucket, z.number().int()),
  }),
  /** Quotes in the queue before filters. */
  total: z.number().int(),
  /** Assign / reassign (queue.assign or the backup-assigner setting). */
  canAssign: z.boolean(),
  /** Decide G2 (gate.G2.decide). */
  canDecide: z.boolean(),
  /** Pin to top (a self-applied queue_position override, B-09). */
  canPin: z.boolean(),
  /** The engineer picker (empty unless canAssign). */
  engineers: z.array(AssignableEngineer),
  /** Lead review: quotes waiting on the lead's review (before filters), for the tab's count. */
  readyForReview: z.number().int(),
  /** Quotes assigned to the caller (unfiltered), default order. */
  mine: z.array(EngQueueItem),
  /** The queue, filtered, in the default order (pinned → tier → score → oldest). */
  items: z.array(EngQueueItem),
});
export type EngQueueResponse = z.infer<typeof EngQueueResponse>;

// ── Assignment and acceptance ────────────────────────────────────────────────────────────────────

export const AssignmentBody = z.object({ engineerId: z.uuid() });
export type AssignmentBody = z.infer<typeof AssignmentBody>;

export const AssignmentResponse = z.object({
  quoteNumber: z.string(),
  assignedEngineerId: z.string(),
  assignedEngineerName: z.string().nullable(),
  assignedAt: z.string().nullable(),
  /** False when the engineer was already assigned (nothing recorded). */
  changed: z.boolean(),
});
export type AssignmentResponse = z.infer<typeof AssignmentResponse>;

/**
 * B-26 (CCQ demo, 10/20, Bailey): when someone leaves or changes role, move all their open work, or a
 * chosen set, to another person in one go. POST /queue/engineering/reassign and /queue/pricing/reassign.
 * `quoteNumbers` omitted = every open quote assigned to `fromUserId` in that queue.
 */
export const BulkReassignBody = z
  .object({
    fromUserId: z.uuid(),
    toUserId: z.uuid(),
    quoteNumbers: z.array(z.string().max(20)).min(1).max(200).optional(),
  })
  .strict();
export type BulkReassignBody = z.infer<typeof BulkReassignBody>;

export const BulkReassignResponse = z.object({
  /** Quotes now assigned to `toUserId`. */
  reassigned: z.array(z.string()),
  /** Listed quotes that were not moved, with why (not in the queue, not assigned to the person…). */
  skipped: z.array(z.object({ quoteNumber: z.string(), reason: z.string() })),
  toUserName: z.string().nullable(),
});
export type BulkReassignResponse = z.infer<typeof BulkReassignResponse>;

export * from './eng-review';
