import { z } from 'zod';

import { LeadReviewView } from './lead-review';
import { SectionLockView } from './problem';

// B-11: no imports from quotes.ts here; QuoteDetail embeds QuotingDetail and the queue item extends
// QuoteSummary in pricing-queue.ts.

// ── Quoting tab (on quote detail) ────────────────────────────────────────────────────────────────

export const CapitalReadiness = z.enum(['not_required', 'pending', 'pre_approved', 'not_approved']);
export type CapitalReadiness = z.infer<typeof CapitalReadiness>;

const note = z.string().trim().max(4000).nullable();
const ref = z.string().trim().max(40);

/**
 * PUT /api/v1/quotes/:quoteNumber/pricing-record. Only the keys sent change; null clears a field.
 * There is no price figure anywhere: CCQ records the approval as a decision (DEC-23, PRD §9).
 */
export const PricingRecordBody = z
  .object({
    /** The price approver: an active Pricing user (defaults to the caller in the UI). */
    approvedBy: z.uuid().nullable(),
    /** When the price was approved. Omitted with an approver = now. */
    approvedAt: z.iso.datetime({ offset: true }).nullable(),
    /** e.g. resin index month, FOB terms. */
    pricingBasisNote: note,
    /** The approved negotiation range, as words (guardrails are D-10, open). */
    approvedRangeNote: note,
    /** B-26: legacy ERF numbers, a transition-only reference (no gate needs them; no BPR). */
    erfRefs: z.array(ref).max(20),
    /** CR-25 costing-before-pricing checkpoint: an attestation only (costing stays in Excel). */
    costingCompleted: z.boolean(),
  })
  .partial()
  .strict();
export type PricingRecordBody = z.infer<typeof PricingRecordBody>;

/** PUT /api/v1/quotes/:quoteNumber/capital-readiness. */
export const CapitalReadinessBody = z
  .object({
    capitalReadiness: CapitalReadiness,
    /** Capital expenditure request id (Apex), optional. */
    cerReference: z.string().trim().max(40).nullable().optional(),
    capitalNotes: note.optional(),
    /** Why G3 may be submitted with capital still pending (D-11 open: a warning, not a block). */
    capitalPendingJustification: note.optional(),
  })
  .strict();
export type CapitalReadinessBody = z.infer<typeof CapitalReadinessBody>;

export const QuotingWarning = z.object({ code: z.string(), message: z.string() });
export type QuotingWarning = z.infer<typeof QuotingWarning>;

/** One version's pricing record. Commercial: only roles with quote.read.commercialFields get it. */
export const PricingRecordView = z.object({
  quoteVersion: z.number().int(),
  priceApprovedBy: z.string().nullable(),
  priceApprovedByName: z.string().nullable(),
  priceApprovedAt: z.string().nullable(),
  pricingBasisNote: z.string().nullable(),
  approvedRangeNote: z.string().nullable(),
  /** B-26: legacy ERF numbers (transition only). */
  erfRefs: z.array(z.string()),
  costingCompleted: z.boolean(),
  costingAttestedByName: z.string().nullable(),
  costingAttestedAt: z.string().nullable(),
  capitalReadiness: CapitalReadiness.nullable(),
  cerReference: z.string().nullable(),
  capitalNotes: z.string().nullable(),
  capitalPendingJustification: z.string().nullable(),
  /** What the G3 decider and Final Review are warned about. */
  warnings: z.array(QuotingWarning),
  updatedAt: z.string().nullable(),
});
export type PricingRecordView = z.infer<typeof PricingRecordView>;

/**
 * The non-commercial approval status every quote reader sees: "Price approved ✓ on <date> by <name>".
 * It describes the current version.
 */
export const PriceApprovalStatus = z.object({
  approved: z.boolean(),
  approvedAt: z.string().nullable(),
  approvedByName: z.string().nullable(),
  quoteVersion: z.number().int(),
});
export type PriceApprovalStatus = z.infer<typeof PriceApprovalStatus>;

export const PricingRefFormatView = z.object({
  label: z.string(),
  pattern: z.string(),
  example: z.string(),
});

// ── FB-07 (D-001): costing, then ROI, then price approved, as steps inside Quoting ─────────────────

/** The current version of one Quoting model (file, version, uploader and date; never a figure). */
export const ModelFileView = z.object({
  id: z.uuid(),
  kind: z.enum(['cost_model', 'roi_model', 'price_table']),
  version: z.number().int(),
  fileName: z.string(),
  uploadedById: z.string(),
  uploadedByName: z.string().nullable(),
  uploadedAt: z.string(),
  /** False for metadata-only rows (synthetic data): nothing to download. */
  available: z.boolean(),
  /** How many versions are on file (removed uploads excluded). */
  versions: z.number().int(),
});
export type ModelFileView = z.infer<typeof ModelFileView>;

/** done · waiting (this step is next) · blocked (an earlier step first) · not_required (ROI only). */
export const QuotingStepStatus = z.enum(['done', 'waiting', 'blocked', 'not_required']);
export type QuotingStepStatus = z.infer<typeof QuotingStepStatus>;

export const QuotingStepsView = z.object({
  /** The step waiting on someone, or `done` once the price is approved. */
  current: z.enum(['costing', 'roi', 'price', 'done']),
  costing: z.object({
    status: QuotingStepStatus,
    model: ModelFileView.nullable(),
    attested: z.boolean(),
    attestedByName: z.string().nullable(),
    attestedAt: z.string().nullable(),
    /** Grandfathered (in Quoting before FB-07): "no model on file" instead of a block. */
    noModelOnFile: z.boolean(),
    /** The caller may upload a new costing model now (Pricing, in Quoting, unlocked). */
    canUpload: z.boolean(),
  }),
  roi: z.object({
    status: QuotingStepStatus,
    required: z.boolean(),
    /** Why an ROI is needed, in words ("Engineering (G2): Advance – capital required"). */
    reasons: z.array(z.string()),
    /** Why not, when not required. */
    notRequiredText: z.string().nullable(),
    model: ModelFileView.nullable(),
    /** The ROI was uploaded before the current costing model (Finance may need to rebuild it). */
    olderThanCostModel: z.boolean(),
    /** The caller may upload a new ROI model now (Finance, or the fallbacks). */
    canUpload: z.boolean(),
  }),
  price: z.object({
    status: QuotingStepStatus,
    /** G3 "Advance – price approved": who and when (null until decided). */
    confirmedByName: z.string().nullable(),
    confirmedAt: z.string().nullable(),
    /** The optional updated price table; without one the price in the models stands. */
    priceTable: ModelFileView.nullable(),
    canUploadPriceTable: z.boolean(),
  }),
});
export type QuotingStepsView = z.infer<typeof QuotingStepsView>;

/** The Quoting tab of a quote. Included in `QuoteDetail.quoting`. */
export const QuotingDetail = z.object({
  /** The quote is in Quoting now. */
  inQuoting: z.boolean(),
  approval: PriceApprovalStatus,
  /** Engineering's latest feasibility outcome (G2), not commercial. */
  g2: z
    .object({
      outcomeKey: z.string(),
      outcomeLabel: z.string(),
      decidedAt: z.string(),
      decidedByName: z.string().nullable(),
      note: z.string().nullable(),
    })
    .nullable(),
  /** The current version's record; absent for roles without commercial access. */
  pricingRecord: PricingRecordView.nullable().optional(),
  /** Prior versions' records (history, newest first); absent for roles without commercial access. */
  pricingRecords: z.array(PricingRecordView).optional(),
  /** Commercial details were withheld from this response. */
  commercialRedacted: z.boolean(),
  canEdit: z.boolean(),
  /** FB-01 (F-001): read-only after G3 is decided, until a send-back reopens it. */
  lock: SectionLockView,
  /** The pricer the pricing lead assigned (B-26), like the Engineering tab's assigned engineer. */
  assignedPricerId: z.string().nullable(),
  assignedPricerName: z.string().nullable(),
  pricerAssignedAt: z.string().nullable(),
  /** The caller may assign or reassign the pricer here (in Quoting, `pricingQueue.assign`). */
  canAssign: z.boolean(),
  /** Lead review: the pricer's submission to the pricing lead. */
  leadReview: LeadReviewView,
  /** The price-approver picker (empty unless canEdit). */
  pricingUsers: z.array(z.object({ id: z.string(), displayName: z.string() })),
  /** Format hint for the legacy ERF numbers (app_setting `pricing_ref_formats`). */
  refFormats: z.object({ erf: PricingRefFormatView }),
  /** FB-07 (D-001): costing → ROI → price approved, each with who and when. Every reader sees it. */
  steps: QuotingStepsView,
});
export type QuotingDetail = z.infer<typeof QuotingDetail>;

export const PRICING_PROBLEM_CODES = {
  notFound: 'not_found',
  notPermitted: 'not_permitted',
  rejected: 'pricing_change_rejected',
  conflict: 'pricing_conflict',
} as const;
