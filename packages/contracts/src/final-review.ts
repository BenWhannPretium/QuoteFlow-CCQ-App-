import { z } from 'zod';

import { EngineeringDetail } from './eng-review';
import { IntakeAddress } from './intake';
import { CapitalReadiness, QuotingDetail } from './pricing';
import { AvailableGateAction, GateDecisionSummary, QuoteSummary } from './quotes';

// ── B-12 Final Review (G4, internal approval; X-88) ──────────────────────────────────────────────
// G4 approve / decline never set Awarded or Lost: only the customer outcome (G5, B-13) does.

const csv = z
  .string()
  .max(500)
  .transform((s) =>
    s
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  );

/** GET /api/v1/approvals?gate=G4. Only G4 is served here: G1 and overrides have their own routes. */
export const FinalReviewQueueQuery = z.object({
  gate: z.literal('G4').default('G4'),
  tier: csv.optional(),
  /** Latest G2 outcome keys. */
  g2: csv.optional(),
  /** Capital readiness values; `none` = not recorded. */
  capital: csv.optional(),
  /** A KAM's user id. */
  kam: z.string().max(64).optional(),
  q: z.string().max(200).optional(),
});
export type FinalReviewQueueQuery = z.input<typeof FinalReviewQueueQuery>;
export type FinalReviewQueueFilters = z.output<typeof FinalReviewQueueQuery>;

export const FinalReviewItem = QuoteSummary.extend({
  /** When the quote entered Final Review this time. */
  enteredStageAt: z.string().nullable(),
  /** Time waiting in Final Review (ms). */
  waitingMs: z.number(),
  productSummary: z.string().nullable(),
  g2Outcome: z.string().nullable(),
  g2OutcomeLabel: z.string().nullable(),
  /** "Capital required" or "Proceed with risk": flag it for the approver. */
  g2Flag: z.boolean(),
  /** Commercial (the queue's roles all read it). */
  capitalReadiness: CapitalReadiness.nullable().optional(),
  priceApproved: z.boolean(),
  priceApprovedAt: z.string().nullable(),
  priceApproverId: z.string().nullable(),
  priceApproverName: z.string().nullable(),
  /** The caller may record a G4 decision on this quote now. */
  canDecide: z.boolean(),
  /** Why not, when the caller holds the Approver permission but a rule bars them (segregation, tier). */
  blockedBy: z.array(z.string()),
});
export type FinalReviewItem = z.infer<typeof FinalReviewItem>;

export const FinalReviewQueueResponse = z.object({
  gate: z.object({
    key: z.string(),
    label: z.string(),
    stageKey: z.string(),
    enabled: z.boolean(),
  }),
  stage: z.object({ key: z.string(), label: z.string() }),
  /** Quotes in the queue before filters. */
  total: z.number().int(),
  counts: z.object({
    flagged: z.number().int(),
    capitalPending: z.number().int(),
    /** Quotes the caller may decide now. */
    decidable: z.number().int(),
  }),
  /** The caller holds the G4 decider permission (an Approver). Leadership reads without it. */
  canDecide: z.boolean(),
  g2Outcomes: z.array(z.object({ key: z.string(), label: z.string() })),
  items: z.array(FinalReviewItem),
});
export type FinalReviewQueueResponse = z.infer<typeof FinalReviewQueueResponse>;

// ── The review screen: the one-page snapshot ─────────────────────────────────────────────────────

export const ReviewWarning = z.object({
  code: z.string(),
  severity: z.enum(['risk', 'info']),
  message: z.string(),
});
export type ReviewWarning = z.infer<typeof ReviewWarning>;

export const ReviewAttachment = z.object({
  id: z.string(),
  kind: z.string(),
  fileName: z.string(),
  size: z.number(),
  mime: z.string(),
  uploadedByName: z.string().nullable(),
  uploadedAt: z.string(),
  /** SharePoint's own link (null for Blob/local); the UI downloads through the audited route. */
  webUrl: z.string().nullable(),
  /** B-16: false for metadata-only rows (no stored bytes). */
  available: z.boolean(),
});
export type ReviewAttachment = z.infer<typeof ReviewAttachment>;

/** GET /api/v1/quotes/:quoteNumber/review-summary. */
export const ReviewSummary = z.object({
  /** Header, customer, product and volume, priority (score + "why") and the qualification screens. */
  quote: QuoteSummary,
  intake: z.object({
    description: z.string().nullable(),
    standardDescription: z.string().nullable(),
    components: z.array(z.string()),
    drawingStatus: z.string().nullable(),
    neckFinish: z.string().nullable(),
    packagingType: z.string().nullable(),
    packagingNotes: z.string().nullable(),
    commentsForEngineering: z.string().nullable(),
    shipTo: IntakeAddress.nullable(),
  }),
  /** Solution + capacity evidence; the numbers are commercial and stripped per role. */
  engineering: EngineeringDetail,
  /** Price approval status for everyone; basis, range note and capital readiness for commercial roles. */
  quoting: QuotingDetail,
  attachments: z.array(ReviewAttachment),
  /** Everything the approver should weigh that does not block the decision. */
  warnings: z.array(ReviewWarning),
  /** Every gate decision on the quote, newest first (earlier Final Review returns included). */
  decisions: z.array(GateDecisionSummary),
  proposal: z.object({
    issuedAt: z.string().nullable(),
    validityUntil: z.string().nullable(),
    /** `validity_days_default` (provisional, D-12). */
    validityDaysDefault: z.number().int().nullable(),
  }),
  /** The quote is in Final Review and open. */
  inFinalReview: z.boolean(),
  /** What the caller may do at G4 now. */
  availableActions: z.array(AvailableGateAction),
  canDecide: z.boolean(),
  blockedBy: z.array(z.string()),
  /** The approver tier this quote falls in when `g4_tier_rules` is on; null while the hook is disabled. */
  requirement: z
    .object({ tierKey: z.string(), tierLabel: z.string(), satisfied: z.boolean() })
    .nullable(),
  /** Withheld: the caller cannot read commercial fields. */
  commercialRedacted: z.boolean(),
});
export type ReviewSummary = z.infer<typeof ReviewSummary>;

export const FINAL_REVIEW_PROBLEM_CODES = {
  notFound: 'not_found',
  notPermitted: 'not_permitted',
} as const;
