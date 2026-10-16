import { z } from 'zod';

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

export * from './eng-review';
