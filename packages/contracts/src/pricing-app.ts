import { z } from 'zod';

/**
 * B-15 (F-11): read-only records from the legacy pricing application (ERF, BPR; SPR as history).
 * The connector in `@ccq/integrations` (pricing/) maps view rows into these shapes; which column feeds
 * which property is in pricing/columnMap.ts (confirmed with Cory McGahan and Gemma Cebolla at M5).
 *
 * Everything here is commercial (architecture §3.3): the routes need `quote.read.commercialFields`,
 * and the domain's sensitivity registry strips the `erfRecord(s)` / `bprRecord(s)` / `sprHistory`
 * subtrees for any other role. CCQ never edits or writes back a pricing-app figure (CLAUDE.md rule 5).
 *
 * Blank figures are **unknown, not zero**: revenue, volume and net capital blank themselves from
 * ~FY25/26 on in the legacy app (cause unknown), so they are `null` and the UI says "Unknown".
 */

/** ERF outcome from the accepted / rejected / abandoned flags; `open` when none is set. */
export const PricingErfStatus = z.enum(['open', 'accepted', 'rejected', 'abandoned']);
export type PricingErfStatus = z.infer<typeof PricingErfStatus>;

/** An ERF (Engineering Request Form) in the pricing app. Not "ERS" (X-33). */
export const PricingErf = z.object({
  erfNumber: z.string(),
  customerName: z.string().nullable(),
  /** The SF opportunity id, if the pricing app carries one. */
  sfOpportunityId: z.string().nullable(),
  /** Short description of the request. */
  title: z.string().nullable(),
  status: PricingErfStatus,
  /** YYYY-MM-DD. */
  submittedOn: z.string().nullable(),
  priority: z.string().nullable(),
  productClass: z.string().nullable(),
  channel: z.string().nullable(),
  plant: z.string().nullable(),
  machine: z.string().nullable(),
  /** USD. Null = unknown (blank in the pricing app), never zero. */
  estRevenueUsd: z.number().nullable(),
  /** Units per year. Null = unknown. */
  estVolume: z.number().nullable(),
  /** USD. Null = unknown. */
  estNetCapitalUsd: z.number().nullable(),
  decision: z.object({
    type: z.string().nullable(),
    by: z.string().nullable(),
    /** YYYY-MM-DD. */
    on: z.string().nullable(),
    reason: z.string().nullable(),
  }),
  attachmentCount: z.number().int().nullable(),
  /** Days from submission to each milestone, as the pricing app computes them. Null = not reached / unknown. */
  elapsedDays: z.object({
    engineerAssigned: z.number().nullable(),
    eceApproved: z.number().nullable(),
    priceConfirmed: z.number().nullable(),
  }),
});
export type PricingErf = z.infer<typeof PricingErf>;

/** A BPR (price implementation request). It always follows an approved quote. */
export const PricingBpr = z.object({
  bprNumber: z.string(),
  /** The ERF it follows. ERF↔BPR is not strictly 1:1 (Cory is validating the cardinality). */
  erfNumber: z.string().nullable(),
  customerName: z.string().nullable(),
  itemDescription: z.string().nullable(),
  status: z.string().nullable(),
  requestedBy: z.string().nullable(),
  /** YYYY-MM-DD. */
  requestedOn: z.string().nullable(),
  /** YYYY-MM-DD. */
  effectiveOn: z.string().nullable(),
});
export type PricingBpr = z.infer<typeof PricingBpr>;

/** An SPR (stock pricing request). Historical only: retired Nov 2025, no stage in CCQ. */
export const PricingSpr = z.object({
  sprNumber: z.string(),
  customerName: z.string().nullable(),
  itemDescription: z.string().nullable(),
  status: z.string().nullable(),
  /** YYYY-MM-DD. */
  requestedOn: z.string().nullable(),
  /** YYYY-MM-DD. */
  decidedOn: z.string().nullable(),
});
export type PricingSpr = z.infer<typeof PricingSpr>;

export const PricingAppMode = z.enum(['fake', 'sqlserver', 'fabric']);
export type PricingAppMode = z.infer<typeof PricingAppMode>;

/** Most rows any pricing-app query returns. */
export const PRICING_APP_MAX_RESULTS = 50;

const ref = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9 _./-]+$/, 'Letters, digits, spaces and - _ . / only');

export const PricingErfParams = z.object({ erfNumber: ref });
export const PricingBprParams = z.object({ bprNumber: ref });

/** GET /api/v1/pricing/erf?customer=&q=&opportunity=: at least one filter. */
export const PricingErfSearchQuery = z
  .object({
    /** Customer name contains this. */
    customer: z.string().trim().min(2).max(120).optional(),
    /** ERF number, title or customer contains this. */
    q: z.string().trim().min(2).max(120).optional(),
    /** The SF opportunity id the pricing app carries. */
    opportunity: z.string().trim().min(15).max(18).optional(),
    limit: z.coerce.number().int().min(1).max(PRICING_APP_MAX_RESULTS).default(20),
  })
  .refine((q) => q.customer || q.q || q.opportunity, {
    message: 'Give a customer, a search text or an opportunity id',
    path: ['q'],
  });
export type PricingErfSearchQuery = z.infer<typeof PricingErfSearchQuery>;

/** Where the records came from, and whether the reader answered. */
export const PricingAppSource = z.object({
  mode: PricingAppMode,
  /** False when the pricing app could not be read: the UI falls back to manual references. */
  available: z.boolean(),
  /** "Pricing app unavailable (ETIMEOUT)". A data-free code only. */
  error: z.string().nullable(),
  /** When these records were read from the pricing app (they are cached for 5 minutes). */
  readAt: z.string().nullable(),
});
export type PricingAppSource = z.infer<typeof PricingAppSource>;

/** GET /api/v1/pricing/erf/:erfNumber: the ERF with the BPRs that follow it. */
export const PricingErfResponse = z.object({
  source: PricingAppSource,
  erfRecord: PricingErf,
  bprRecords: z.array(PricingBpr),
});
export type PricingErfResponse = z.infer<typeof PricingErfResponse>;

export const PricingErfSearchResponse = z.object({
  source: PricingAppSource,
  erfRecords: z.array(PricingErf),
  /** The cap (50) or the requested limit was reached: narrow the search. */
  truncated: z.boolean(),
});
export type PricingErfSearchResponse = z.infer<typeof PricingErfSearchResponse>;

export const PricingBprResponse = z.object({ source: PricingAppSource, bprRecord: PricingBpr });
export type PricingBprResponse = z.infer<typeof PricingBprResponse>;

/** CCQ ERF number vs the one on the SF opportunity (same rules as the admin ERF linkage report). */
export const ErfLinkageStatus = z.enum([
  'match',
  'mismatch',
  'sf_only',
  'ccq_only',
  'both_missing',
]);
export type ErfLinkageStatus = z.infer<typeof ErfLinkageStatus>;

/** A BPR in the context panel, with why it is there. */
export const PricingContextBpr = PricingBpr.extend({
  /** `reference`: on the pricing record; `erf`: follows one of the quote's ERFs. */
  via: z.enum(['reference', 'erf']),
});
export type PricingContextBpr = z.infer<typeof PricingContextBpr>;

/**
 * GET /api/v1/quotes/:quoteNumber/pricing-context: the quote's `erf_number`, the current pricing
 * record's ERF/BPR references and the SF opportunity's ERF number, resolved in the pricing app.
 * When the reader is down, `source.available` is false and the record lists are empty; the refs and
 * linkage still come back so the Quoting tab can fall back to manual references.
 */
export const PricingContext = z.object({
  source: PricingAppSource,
  refs: z.object({
    /** `quote.erf_number`. */
    quoteErfNumber: z.string().nullable(),
    /** The ERF number on the SF opportunity ("used inconsistently": compared, never trusted). */
    sfErfNumber: z.string().nullable(),
    /** The current version's pricing record references. */
    erfRefs: z.array(z.string()),
    bprRefs: z.array(z.string()),
  }),
  linkage: z.object({
    status: ErfLinkageStatus,
    /** The SF ERF number differs from the CCQ one. */
    mismatch: z.boolean(),
  }),
  erfRecords: z.array(PricingErf),
  bprRecords: z.array(PricingContextBpr),
  /** SPRs for the customer: history only (retired Nov 2025), newest first. */
  sprHistory: z.array(PricingSpr),
  /** References the pricing app does not know. */
  notFound: z.object({ erf: z.array(z.string()), bpr: z.array(z.string()) }),
  /** The caller may add an ERF/BPR to the pricing record ("Use as reference"): Pricing, in Quoting. */
  canUseAsReference: z.boolean(),
});
export type PricingContext = z.infer<typeof PricingContext>;

export const PRICING_APP_PROBLEM_CODES = {
  notFound: 'not_found',
  unavailable: 'pricing_app_unavailable',
} as const;
