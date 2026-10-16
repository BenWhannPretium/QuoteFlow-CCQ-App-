import { z } from 'zod';

import { EngineeringDetail } from './eng-review';
import { IntakeAddress } from './intake';
import { QuoteOverridableField } from './overrides';
import { QuotingDetail } from './pricing';

// ── Priority (B-08, advisory) ────────────────────────────────────────────────────────────────────

export const ScoreBreakdownItem = z.object({
  key: z.string(),
  label: z.string(),
  weight: z.number(),
  /** What the attribute was scored on; null when unknown or restricted (commercial input). */
  raw: z.union([z.string(), z.number()]).nullable(),
  points: z.number(),
  contribution: z.number(),
  explanation: z.string(),
  unknown: z.boolean(),
  sensitive: z.boolean(),
});
export type ScoreBreakdownItem = z.infer<typeof ScoreBreakdownItem>;

/**
 * A quote's priority. `tier` is what to display: the override tier when an approved override set one
 * (B-09), else the computed tier. `computedTier` is always the score's own tier.
 * `visible: false` means the server withheld it (`kam_can_see_peer_scores` = false): every value is null.
 */
export const QuotePriority = z.object({
  visible: z.boolean(),
  score: z.number().nullable(),
  tier: z.string().nullable(),
  tierLabel: z.string().nullable(),
  computedTier: z.string().nullable(),
  computedTierLabel: z.string().nullable(),
  tierOverridden: z.boolean(),
  modelVersion: z.number().int().nullable(),
  /** The "Why this priority?" table; empty when not scored or hidden. */
  breakdown: z.array(ScoreBreakdownItem),
  /** Attribute keys scored neutral because their input is unknown (e.g. capital before G2). */
  unknowns: z.array(z.string()),
});
export type QuotePriority = z.infer<typeof QuotePriority>;

/** G1 qualification screens (D-06): warnings only, never a block. */
export const QualificationWarning = z.object({
  code: z.string(),
  field: z.string(),
  threshold: z.number(),
  actual: z.number(),
  message: z.string(),
});
export type QualificationWarning = z.infer<typeof QualificationWarning>;

// ── Gate actions (from the domain's availableActions) ────────────────────────────────────────────

export const MissingField = z.object({ field: z.string(), message: z.string() });
export type MissingField = z.infer<typeof MissingField>;

export const AvailableGateAction = z.object({
  gateKey: z.string(),
  gateLabel: z.string(),
  outcomeKey: z.string(),
  outcomeLabel: z.string(),
  requiresNote: z.boolean(),
  requiresReasonCode: z.boolean(),
  reasonCodes: z.array(
    z.object({ code: z.string(), label: z.string(), requiresNote: z.boolean() }),
  ),
  /** More than one: the decider chooses (`targetStageKey`). */
  targetStageKeys: z.array(z.string()),
  nextStatus: z.enum(['active', 'on_hold', 'closed']),
  /** The outcome needs a review date (sent as `holdUntil`). */
  requiresReviewDate: z.boolean(),
  /** A strategic exception note is required because the quote has qualification warnings. */
  requiresExceptionNote: z.boolean(),
  /** Quote fields this outcome needs that are still missing (the completeness summary). */
  missing: z.array(MissingField),
  /** B-12: the outcome releases the proposition (Final Review → Customer Decision): it sets the proposal dates. */
  releasesProposal: z.boolean(),
  /** B-12: `validity_days_default`, so the dialog can show "valid until"; null unless `releasesProposal`. */
  validityDays: z.number().int().nullable(),
});
export type AvailableGateAction = z.infer<typeof AvailableGateAction>;

// ── Quotes ───────────────────────────────────────────────────────────────────────────────────────

export const QuoteSummary = z.object({
  id: z.string(),
  quoteNumber: z.string(),
  stageKey: z.string(),
  status: z.string(),
  version: z.number().int(),
  sfOpportunityId: z.string(),
  opportunityName: z.string().nullable(),
  customerName: z.string().nullable(),
  customerStatus: z.string().nullable(),
  kamUserId: z.string(),
  kamName: z.string().nullable(),
  requestClass: z.string().nullable(),
  productFamily: z.string().nullable(),
  market: z.string().nullable(),
  resin: z.string().nullable(),
  estAnnualVolume: z.number().nullable(),
  estAnnualRevenue: z.number().nullable(),
  expectedCloseDate: z.string().nullable(),
  /** Null while the quote is back with the KAM for rework. */
  submittedAt: z.string().nullable(),
  reviewDate: z.string().nullable(),
  priority: QuotePriority,
  warnings: z.array(QualificationWarning),
});
export type QuoteSummary = z.infer<typeof QuoteSummary>;

export const GateDecisionSummary = z.object({
  id: z.string(),
  gateKey: z.string(),
  outcomeKey: z.string(),
  decidedBy: z.string(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string(),
  note: z.string().nullable(),
  reasonCode: z.string().nullable(),
  quoteVersion: z.number().int(),
});
export type GateDecisionSummary = z.infer<typeof GateDecisionSummary>;

/** Shown to the KAM (and on the quote) while a quote is back for rework. */
export const ReworkRequest = z.object({
  gateKey: z.string(),
  reasonCode: z.string().nullable(),
  reasonLabel: z.string().nullable(),
  note: z.string().nullable(),
  decidedAt: z.string(),
  decidedByName: z.string().nullable(),
});
export type ReworkRequest = z.infer<typeof ReworkRequest>;

export const QuoteDetail = QuoteSummary.extend({
  description: z.string().nullable(),
  standardDescription: z.string().nullable(),
  components: z.array(z.string()),
  drawingStatus: z.string().nullable(),
  neckFinish: z.string().nullable(),
  packagingType: z.string().nullable(),
  packagingNotes: z.string().nullable(),
  commentsForEngineering: z.string().nullable(),
  shipTo: IntakeAddress.nullable(),
  outcome: z.string().nullable(),
  outcomeReasonCode: z.string().nullable(),
  closedAt: z.string().nullable(),
  /** B-12: set by the Final Review approval (the actual send date) and its validity date. */
  proposalIssuedAt: z.string().nullable(),
  validityUntil: z.string().nullable(),
  decisions: z.array(GateDecisionSummary),
  /** What the caller may decide now (rendered as the decision dialog's options). */
  availableActions: z.array(AvailableGateAction),
  rework: ReworkRequest.nullable(),
  /** B-09: the overridable fields (tier, ship-to, …) with pending / applied overrides and whether the caller may request one. */
  overridableFields: z.array(QuoteOverridableField),
  /** B-10: the Engineering tab (assignment, review, capacity evidence), commercial numbers redacted per role. */
  engineering: EngineeringDetail,
  /** B-11: the Quoting tab. Commercial parts are stripped for roles without commercial access. */
  quoting: QuotingDetail,
});
export type QuoteDetail = z.infer<typeof QuoteDetail>;

export const QuoteNumberParams = z.object({
  quoteNumber: z.string().regex(/^CCQ-\d{4}-\d{5}$/, 'A quote number looks like CCQ-2026-00001'),
});

// ── Gate decisions (generic: G1–G5) ──────────────────────────────────────────────────────────────

export const GateDecisionParams = QuoteNumberParams.extend({
  gateKey: z.string().min(1).max(40),
});

/** POST /api/v1/quotes/:quoteNumber/gates/:gateKey/decisions */
export const GateDecisionBody = z.object({
  outcomeKey: z.string().min(1),
  note: z.string().max(4000).optional(),
  reasonCode: z.string().max(80).optional(),
  /** Review date for a Hold (`YYYY-MM-DD`); stored as the quote's review_date. */
  holdUntil: z.iso.date().optional(),
  /** Only for outcomes with several target stages (returns / re-quotes). */
  targetStageKey: z.string().optional(),
  /**
   * Only for an outcome that releases the proposition (G4 Approve): the actual send date. Default now;
   * never in the future. `validity_until` is set from it (B-12).
   */
  proposalIssuedAt: z.iso.datetime({ offset: true }).optional(),
});
export type GateDecisionBody = z.infer<typeof GateDecisionBody>;

export const GateDecisionResponse = z.object({
  decision: GateDecisionSummary,
  quote: QuoteDetail,
});
export type GateDecisionResponse = z.infer<typeof GateDecisionResponse>;

/** GET /api/v1/gates/:gateKey/queue: quotes waiting for this gate, highest priority first. */
export const GateQueueParams = z.object({ gateKey: z.string().min(1).max(40) });
export const GateQueueResponse = z.object({
  gate: z.object({
    key: z.string(),
    label: z.string(),
    stageKey: z.string(),
    enabled: z.boolean(),
  }),
  /** The caller holds the gate's decider permission. */
  canDecide: z.boolean(),
  items: z.array(QuoteSummary),
});
export type GateQueueResponse = z.infer<typeof GateQueueResponse>;

/** Problem `code`s for quote and gate routes. A rejected decision lists every domain error. */
export const GATE_PROBLEM_CODES = {
  notFound: 'not_found',
  unknownGate: 'unknown_gate',
  rejected: 'gate_decision_rejected',
  notPermitted: 'not_permitted',
} as const;
