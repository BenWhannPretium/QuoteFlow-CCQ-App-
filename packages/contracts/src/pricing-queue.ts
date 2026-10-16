import { z } from 'zod';

import { CapitalReadiness } from './pricing';
import { QuoteSummary } from './quotes';

// ── B-11 Pricing queue (DEC-19/20) ───────────────────────────────────────────────────────────────

const csv = z
  .string()
  .max(500)
  .transform((s) =>
    s
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  );

/** GET /api/v1/queue/pricing. List filters are comma-separated (`g2=capital_required,proceed_with_risk`). */
export const PricingQueueQuery = z.object({
  tier: csv.optional(),
  /** Latest G2 outcome keys. */
  g2: csv.optional(),
  /** Capital readiness values; `none` = not recorded yet. */
  capital: csv.optional(),
  /** `yes` = price approval recorded for the current version, `no` = not yet. */
  approved: z.enum(['yes', 'no']).optional(),
  productFamily: csv.optional(),
  /** A KAM's user id. */
  kam: z.string().max(64).optional(),
  q: z.string().max(200).optional(),
});
export type PricingQueueQuery = z.input<typeof PricingQueueQuery>;
export type PricingQueueFilters = z.output<typeof PricingQueueQuery>;

export const PricingQueueItem = QuoteSummary.extend({
  /** When the quote entered Quoting this time. */
  enteredStageAt: z.string().nullable(),
  /** Time in Quoting excluding holds (ms). */
  activeMsInStage: z.number(),
  /** "Product summary": standard description, else the free-text description (truncated). */
  productSummary: z.string().nullable(),
  g2Outcome: z.string().nullable(),
  g2OutcomeLabel: z.string().nullable(),
  /** Flag Pricing: "Capital required" or "Proceed with risk". */
  g2Flag: z.boolean(),
  /** Commercial (stripped for roles without quote.read.commercialFields; the queue's roles all hold it). */
  capitalReadiness: CapitalReadiness.nullable().optional(),
  priceApproved: z.boolean(),
  priceApprovedAt: z.string().nullable(),
  assignedEngineerId: z.string().nullable(),
  assignedEngineerName: z.string().nullable(),
  /** The caller may edit this quote's Quoting tab. */
  canEdit: z.boolean(),
});
export type PricingQueueItem = z.infer<typeof PricingQueueItem>;

export const PricingQueueResponse = z.object({
  stage: z.object({ key: z.string(), label: z.string() }),
  /** Quotes in the queue before filters. */
  total: z.number().int(),
  /** Over the whole queue the caller can see, before filters. */
  counts: z.object({
    awaitingApproval: z.number().int(),
    capitalPending: z.number().int(),
    flagged: z.number().int(),
  }),
  /** Record approvals (quoting.edit). */
  canEdit: z.boolean(),
  /** Decide G3 (gate.G3.submit). */
  canDecide: z.boolean(),
  /** G2 outcome keys and labels for the filter. */
  g2Outcomes: z.array(z.object({ key: z.string(), label: z.string() })),
  items: z.array(PricingQueueItem),
});
export type PricingQueueResponse = z.infer<typeof PricingQueueResponse>;
