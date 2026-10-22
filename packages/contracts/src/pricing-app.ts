import { z } from 'zod';

/**
 * B-15 (F-11), revised 2026-10-22: **pricing history**. There is no live connection to the legacy
 * pricing application (an unsupported .NET app being retired as QuoteFlow takes over its job).
 * Cory McGahan's back-end export (ERF, BPR and SPR sheets; approved for use) is imported into CCQ's
 * own database by an Admin (`POST /admin/pricing-history/import`) and read from there.
 *
 * B-26 still holds for quotes: a quote shows no BPR (the BPR is the price-implementation step after
 * CCQ). BPR records are imported as history and appear only on the Pricing history search page.
 *
 * Everything here is commercial (architecture §3.3): the read routes need
 * `quote.read.commercialFields`, and the domain's sensitivity registry strips the history subtrees
 * for any other role. History is never edited in CCQ; a corrected export is simply re-imported.
 *
 * **A zero estimate is unknown, not zero.** The legacy app wrote 0 where a figure was blank (ERF
 * volume is 0 on ~99% of ERFs since FY23), so revenue, volume and prices of 0 come back `null` and the
 * UI says "Unknown". Net capital keeps its 0 ("no capital"): it is 0 on ~80% of ERFs in every year,
 * so it reads as a real value (provisional, to confirm with Pricing).
 */

export const PricingHistoryKind = z.enum(['erf', 'bpr', 'spr']);
export type PricingHistoryKind = z.infer<typeof PricingHistoryKind>;

/** Derived from the export's flags; `displayStatus` keeps the legacy app's own label. */
export const PricingHistoryStatus = z.enum([
  'open',
  'on_hold',
  'accepted',
  'rejected',
  'abandoned',
  'completed',
]);
export type PricingHistoryStatus = z.infer<typeof PricingHistoryStatus>;

const decision = z.object({
  type: z.string().nullable(),
  by: z.string().nullable(),
  /** YYYY-MM-DD. */
  on: z.string().nullable(),
  reason: z.string().nullable(),
});

/** Fields every history record has. Dates are YYYY-MM-DD. */
const base = {
  /** The legacy request number, e.g. ERF25-123 (EP… for older ERFs). Not unique on its own. */
  requestNumber: z.string(),
  fiscalYear: z.number().int(),
  status: PricingHistoryStatus,
  displayStatus: z.string().nullable(),
  customer: z.string().nullable(),
  productDescription: z.string().nullable(),
  itemNumber: z.string().nullable(),
  salesPerson: z.string().nullable(),
  market: z.string().nullable(),
  process: z.string().nullable(),
  resin: z.string().nullable(),
  plant: z.string().nullable(),
  /** Sales submitted, else created. */
  submittedOn: z.string().nullable(),
  /** USD per year. Null = unknown (blank or 0 in the export). */
  estRevenueUsd: z.number().nullable(),
  /** Units per year. Null = unknown (blank or 0 in the export). */
  estVolume: z.number().nullable(),
  /** Free text from the legacy app (kept for context; may be removed later). */
  comments: z.string().nullable(),
};

/** An ERF (Engineering Request Form). Not "ERS" (X-33). */
export const PricingErf = z.object({
  kind: z.literal('erf'),
  ...base,
  priority: z.number().nullable(),
  productClass: z.string().nullable(),
  channel: z.string().nullable(),
  machine: z.string().nullable(),
  leadEngineer: z.string().nullable(),
  /** USD. 0 = no capital (kept as a value). */
  estNetCapitalUsd: z.number().nullable(),
  decision,
  engineeringComments: z.string().nullable(),
  /** Price confirmation text from the legacy app. */
  priceConfirmation: z.string().nullable(),
  attachmentCount: z.number().int().nullable(),
  milestones: z.object({
    engineerAssignedOn: z.string().nullable(),
    eceApprovedOn: z.string().nullable(),
    priceConfirmedOn: z.string().nullable(),
    proposalSubmittedOn: z.string().nullable(),
    contractFinalizedOn: z.string().nullable(),
  }),
  /** Days from submission, as the legacy app computed them. Null = not reached. */
  elapsedDays: z.object({
    engineerAssigned: z.number().nullable(),
    eceApproved: z.number().nullable(),
    priceConfirmed: z.number().nullable(),
    firstToLast: z.number().nullable(),
  }),
});
export type PricingErf = z.infer<typeof PricingErf>;

/**
 * A BPR (price implementation request), history only: shown on the Pricing history page, never on a
 * quote (B-26). The export carries **no link to an ERF**.
 */
export const PricingBpr = z.object({
  kind: z.literal('bpr'),
  ...base,
  bprType: z.string().nullable(),
  packout: z.string().nullable(),
  /** The agreed price as the legacy app recorded it. Null = unknown. Commercial. */
  priceAgreedTo: z.number().nullable(),
  priceConfirmedOn: z.string().nullable(),
  oracleUpdatedOn: z.string().nullable(),
  daysToPriceConfirmed: z.number().nullable(),
  csSetupText: z.string().nullable(),
  abandonedReason: z.string().nullable(),
});
export type PricingBpr = z.infer<typeof PricingBpr>;

/** An SPR (stock pricing request). Historical only: retired Nov 2025, no stage in CCQ. */
export const PricingSpr = z.object({
  kind: z.literal('spr'),
  ...base,
  sprType: z.string().nullable(),
  competitorName: z.string().nullable(),
  competitiveOffer: z.string().nullable(),
  /** Null = unknown. Commercial. */
  currentPrice: z.number().nullable(),
  targetPrice: z.number().nullable(),
  decision,
  priceConfirmedOn: z.string().nullable(),
});
export type PricingSpr = z.infer<typeof PricingSpr>;

export const PricingHistoryRecord = z.discriminatedUnion('kind', [
  PricingErf,
  PricingBpr,
  PricingSpr,
]);
export type PricingHistoryRecord = z.infer<typeof PricingHistoryRecord>;

/** Most rows any pricing-history query returns. */
export const PRICING_APP_MAX_RESULTS = 50;

const ref = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9 _./-]+$/, 'Letters, digits, spaces and - _ . / only');

export const PricingErfParams = z.object({ erfNumber: ref });

/** GET /api/v1/pricing/history?kind=&customer=&q=: at least a customer or a search text. */
export const PricingHistorySearchQuery = z
  .object({
    kind: PricingHistoryKind.default('erf'),
    /** Customer name contains this. */
    customer: z.string().trim().min(2).max(120).optional(),
    /** Request number, product description, item number or customer contains this. */
    q: z.string().trim().min(2).max(120).optional(),
    fiscalYearFrom: z.coerce.number().int().min(2000).max(2100).optional(),
    fiscalYearTo: z.coerce.number().int().min(2000).max(2100).optional(),
    limit: z.coerce.number().int().min(1).max(PRICING_APP_MAX_RESULTS).default(25),
  })
  .refine((q) => q.customer || q.q, {
    message: 'Give a customer or a search text',
    path: ['q'],
  });
export type PricingHistorySearchQuery = z.infer<typeof PricingHistorySearchQuery>;

/** What has been imported, and when. */
export const PricingHistorySource = z.object({
  /** False until an Admin has imported the export: the UI says so and manual entry still works. */
  imported: z.boolean(),
  importedAt: z.string().nullable(),
  counts: z.object({ erf: z.number().int(), bpr: z.number().int(), spr: z.number().int() }),
});
export type PricingHistorySource = z.infer<typeof PricingHistorySource>;

/** GET /api/v1/pricing/erf/:erfNumber. Several rows can share a number: the newest is returned. */
export const PricingErfResponse = z.object({
  source: PricingHistorySource,
  erfRecord: PricingErf,
  /** Other ERFs with the same number (the export has a few duplicates). */
  sameNumber: z.number().int(),
});
export type PricingErfResponse = z.infer<typeof PricingErfResponse>;

export const PricingHistorySearchResponse = z.object({
  source: PricingHistorySource,
  historyRecords: z.array(PricingHistoryRecord),
  /** The limit was reached: narrow the search. */
  truncated: z.boolean(),
});
export type PricingHistorySearchResponse = z.infer<typeof PricingHistorySearchResponse>;

/** CCQ ERF number vs the one on the SF opportunity (same rules as the admin ERF linkage report). */
export const ErfLinkageStatus = z.enum([
  'match',
  'mismatch',
  'sf_only',
  'ccq_only',
  'both_missing',
]);
export type ErfLinkageStatus = z.infer<typeof ErfLinkageStatus>;

/**
 * GET /api/v1/quotes/:quoteNumber/pricing-context: the quote's legacy ERF numbers (quote.erf_number,
 * the pricing record's Legacy ERF #, the SF opportunity's ERF number) resolved in the imported
 * history, plus the customer's other ERFs and SPR history, matched by customer name (the export has
 * no Salesforce id). No BPR (B-26).
 */
export const PricingContext = z.object({
  source: PricingHistorySource,
  refs: z.object({
    quoteErfNumber: z.string().nullable(),
    sfErfNumber: z.string().nullable(),
    erfRefs: z.array(z.string()),
  }),
  linkage: z.object({ status: ErfLinkageStatus, mismatch: z.boolean() }),
  /** The referenced ERFs. */
  erfRecords: z.array(PricingErf),
  /** References the history does not know. */
  notFound: z.object({ erf: z.array(z.string()) }),
  /** The customer name the history was matched on, or null without a customer. */
  customerMatch: z.string().nullable(),
  /** The customer's other ERFs, newest first (at most 10): candidates for "Use as reference". */
  customerErfs: z.array(PricingErf),
  /** The customer's SPRs, newest first, at most 20. History only (retired Nov 2025). */
  sprHistory: z.array(PricingSpr),
  /** The caller may add an ERF as the Legacy ERF # ("Use as reference"): Pricing, in Quoting. */
  canUseAsReference: z.boolean(),
});
export type PricingContext = z.infer<typeof PricingContext>;

// ── Admin import ──────────────────────────────────────────────────────────────────────────────────

/** POST /api/v1/admin/pricing-history/import?apply=: multipart, one `file` part (the .xlsx). */
export const PricingHistoryImportQuery = z.object({
  /** false (default) = check the file and report; true = write it. */
  apply: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export const PricingHistorySheetSummary = z.object({
  kind: PricingHistoryKind,
  sheet: z.string(),
  rows: z.number().int(),
  /** Rows with a request id and number (imported). */
  valid: z.number().int(),
  /** Rows without a request id or number (skipped). */
  skipped: z.number().int(),
  /** Request numbers used by more than one row (kept: the key is the request id). */
  duplicateNumbers: z.number().int(),
  /** Estimates and prices of 0 read as unknown. */
  zeroAsUnknown: z.number().int(),
  fiscalYears: z.object({ from: z.number().int().nullable(), to: z.number().int().nullable() }),
  /** Columns CCQ maps that the sheet lacks (their values become null). */
  missingColumns: z.array(z.string()),
  /** Rows not yet in CCQ / already there (before this import). */
  newRows: z.number().int(),
  existingRows: z.number().int(),
});
export type PricingHistorySheetSummary = z.infer<typeof PricingHistorySheetSummary>;

export const PricingHistoryImportResponse = z.object({
  applied: z.boolean(),
  fileName: z.string(),
  sheets: z.array(PricingHistorySheetSummary),
  /** When applied: rows inserted, changed, and left as they were. */
  written: z
    .object({
      inserted: z.number().int(),
      updated: z.number().int(),
      unchanged: z.number().int(),
    })
    .nullable(),
  /** The integration_run row of an applied import. */
  runId: z.string().nullable(),
  durationMs: z.number().int(),
});
export type PricingHistoryImportResponse = z.infer<typeof PricingHistoryImportResponse>;

/** GET /api/v1/admin/pricing-history: what is loaded and the latest imports. */
export const PricingHistoryStatusResponse = z.object({
  source: PricingHistorySource,
  imports: z.array(
    z.object({
      runId: z.string(),
      at: z.string(),
      status: z.string(),
      counts: z.record(z.string(), z.number()),
      error: z.string().nullable(),
    }),
  ),
});
export type PricingHistoryStatusResponse = z.infer<typeof PricingHistoryStatusResponse>;

export const PRICING_APP_PROBLEM_CODES = {
  notFound: 'not_found',
  invalidFile: 'pricing_history_invalid_file',
} as const;
