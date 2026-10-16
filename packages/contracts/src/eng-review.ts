import { z } from 'zod';

// B-10: no imports from quotes.ts here; QuoteDetail embeds EngineeringDetail.

// ── Engineering Review (on quote detail, tab "Engineering") ──────────────────────────────────────

const text = (max: number) => z.string().trim().max(max).nullable();

/**
 * PUT /api/v1/quotes/:quoteNumber/eng-review. Only the keys sent change; null clears a field.
 * `prelimCapitalUsd` is commercial: an Engineer may write it but never reads it back.
 */
export const EngReviewBody = z
  .object({
    processType: z.string().max(40).nullable(),
    machineType: z.string().max(40).nullable(),
    plantCode: z.string().max(40).nullable(),
    cavitation: z.number().int().min(1).max(512).nullable(),
    cycleTimeS: z.number().positive().max(999_999).nullable(),
    toolingNotes: text(4000),
    downstreamEquipmentNotes: text(4000),
    prelimCapitalUsd: z.number().min(0).max(999_999_999_999).nullable(),
    technicalConceptNotes: text(4000),
  })
  .partial()
  .strict();
export type EngReviewBody = z.infer<typeof EngReviewBody>;

const pct = z.number().min(0).max(100);

export const CapacityEvidenceRowBody = z
  .object({
    id: z.uuid().optional(),
    site: z.string().trim().min(1).max(40),
    lineAsset: z.string().trim().max(120).nullable().optional(),
    /** Required on a new row, never defaulted (DF-22: quotes assumed 85% vs ~70% demonstrated). */
    assumedEffectivenessPct: pct.nullable().optional(),
    cycleTimeS: z.number().positive().max(999_999).nullable().optional(),
    utilizationPct: pct.nullable().optional(),
    bufferPct: pct.nullable().optional(),
    analysisDate: z.iso.date(),
    analystId: z.uuid(),
    notes: z.string().trim().max(4000).nullable().optional(),
  })
  .strict();
export type CapacityEvidenceRowBody = z.infer<typeof CapacityEvidenceRowBody>;

/** PUT /api/v1/quotes/:quoteNumber/capacity-evidence: the full set (rows not sent are removed). */
export const CapacityEvidenceBody = z
  .object({ rows: z.array(CapacityEvidenceRowBody).max(50) })
  .strict();
export type CapacityEvidenceBody = z.infer<typeof CapacityEvidenceBody>;

export const EngReviewFields = z.object({
  processType: z.string().nullable(),
  machineType: z.string().nullable(),
  plantCode: z.string().nullable(),
  cavitation: z.number().nullable(),
  cycleTimeS: z.number().nullable(),
  toolingNotes: z.string().nullable(),
  downstreamEquipmentNotes: z.string().nullable(),
  /** Absent for roles without commercial access. */
  prelimCapitalUsd: z.number().nullable().optional(),
  technicalConceptNotes: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type EngReviewFields = z.infer<typeof EngReviewFields>;

export const CapacityEvidenceRow = z.object({
  id: z.string(),
  site: z.string(),
  lineAsset: z.string().nullable(),
  /** The four numbers are absent for roles without commercial access (architecture §3.3). */
  assumedEffectivenessPct: z.number().optional(),
  cycleTimeS: z.number().optional(),
  utilizationPct: z.number().optional(),
  bufferPct: z.number().nullable().optional(),
  analysisDate: z.string(),
  analystId: z.string(),
  analystName: z.string().nullable(),
  notes: z.string().nullable(),
});
export type CapacityEvidenceRow = z.infer<typeof CapacityEvidenceRow>;

/** The Engineering tab of a quote. Included in `QuoteDetail.engineering`. */
export const EngineeringDetail = z.object({
  /** The quote is in Engineering Review now. */
  inQueue: z.boolean(),
  assignedEngineerId: z.string().nullable(),
  assignedEngineerName: z.string().nullable(),
  assignedAt: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  acceptedByName: z.string().nullable(),
  review: EngReviewFields,
  capacityEvidence: z.array(CapacityEvidenceRow),
  /** Commercial numbers were withheld from this response: inputs for them are write-only. */
  commercialRedacted: z.boolean(),
  canEdit: z.boolean(),
  canAccept: z.boolean(),
  canAssign: z.boolean(),
});
export type EngineeringDetail = z.infer<typeof EngineeringDetail>;

// ── Time in stage (B-10, feeds B-17) ─────────────────────────────────────────────────────────────

export const StageTimeTotal = z.object({
  stageKey: z.string(),
  label: z.string(),
  visits: z.number().int(),
  elapsedMs: z.number(),
  heldMs: z.number(),
  /** Excluding holds (CR-57). */
  activeMs: z.number(),
  current: z.boolean(),
});
export type StageTimeTotal = z.infer<typeof StageTimeTotal>;

export const StageTimesResponse = z.object({
  quoteNumber: z.string(),
  asOf: z.string(),
  stages: z.array(StageTimeTotal),
  visits: z.array(
    z.object({
      stageKey: z.string(),
      enteredAt: z.string(),
      exitedAt: z.string().nullable(),
      elapsedMs: z.number(),
      heldMs: z.number(),
      activeMs: z.number(),
    }),
  ),
});
export type StageTimesResponse = z.infer<typeof StageTimesResponse>;

// ── In-app notifications (B-10 minimum feed; B-18 adds email and per-item read) ─────────────────

export const NotificationItem = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  quoteNumber: z.string().nullable(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});
export type NotificationItem = z.infer<typeof NotificationItem>;

export const NotificationListResponse = z.object({
  unread: z.number().int(),
  items: z.array(NotificationItem),
});
export type NotificationListResponse = z.infer<typeof NotificationListResponse>;

export const MarkNotificationsReadResponse = z.object({ marked: z.number().int() });
export type MarkNotificationsReadResponse = z.infer<typeof MarkNotificationsReadResponse>;

export const ENGINEERING_PROBLEM_CODES = {
  notFound: 'not_found',
  notPermitted: 'not_permitted',
  rejected: 'engineering_change_rejected',
  conflict: 'engineering_conflict',
} as const;
