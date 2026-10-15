import { z } from 'zod';

/**
 * Salesforce DTOs (read-only, DEC-12). Every CCQ quote starts from an SF Opportunity.
 * The connector maps raw SOQL records into these shapes in `@ccq/integrations` (salesforce/mapper.ts);
 * which SF field feeds which property is in salesforce/fieldMap.ts.
 *
 * SF data was backfilled by migration, so most fields are nullable. ERF number and quote source are
 * "used inconsistently": they are captured for reference and reporting, never trusted for logic.
 */

/** Structured address. Every part may be missing in SF. */
export const SfAddress = z.object({
  line1: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postal: z.string().nullable(),
  country: z.string().nullable(),
});
export type SfAddress = z.infer<typeof SfAddress>;

/** Data-quality flags raised by the mapper. They inform the UI; nothing is blocked on them. */
export const SF_DATA_QUALITY_FLAGS = [
  'amount_missing',
  /** Below the `sf_amount_suspect_below_usd` setting (seed $100), e.g. a $0.31 placeholder. */
  'amount_suspect',
  'account_missing',
  'owner_missing',
  'close_date_missing',
] as const;
export const SfDataQualityFlag = z.enum(SF_DATA_QUALITY_FLAGS);
export type SfDataQualityFlag = z.infer<typeof SfDataQualityFlag>;

export const SfOpportunity = z.object({
  id: z.string(),
  name: z.string(),
  accountId: z.string().nullable(),
  accountName: z.string().nullable(),
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  ownerAlias: z.string().nullable(),
  ownerEmail: z.string().nullable(),
  /** USD. Null when blank in SF. Placeholders (e.g. 0.31) are kept as-is and flagged. */
  amount: z.number().nullable(),
  /** YYYY-MM-DD. */
  closeDate: z.string().nullable(),
  stage: z.string().nullable(),
  isClosed: z.boolean(),
  isWon: z.boolean(),
  /** ERF number recorded in SF. Inconsistent: compare with the CCQ erf_number, never trust it. */
  erfNumber: z.string().nullable(),
  /** Quote source recorded in SF. Inconsistent. */
  quoteSource: z.string().nullable(),
  /** ISO timestamp; drives the delta sync. */
  systemModstamp: z.string().nullable(),
  dataQuality: z.array(SfDataQualityFlag),
});
export type SfOpportunity = z.infer<typeof SfOpportunity>;

export const SfAccount = z.object({
  id: z.string(),
  name: z.string(),
  /** Ship-to used as the customer's default (source pending the M3 crosswalk). */
  shipTo: SfAddress.nullable(),
});
export type SfAccount = z.infer<typeof SfAccount>;

/** One row of the custom "Opportunity Product Specification" object (API name confirmed at M3). */
export const SfProductSpec = z.object({
  id: z.string(),
  opportunityId: z.string(),
  name: z.string().nullable(),
  productType: z.string().nullable(),
  resin: z.string().nullable(),
  capacity: z.string().nullable(),
  neckFinish: z.string().nullable(),
  color: z.string().nullable(),
  annualVolume: z.number().nullable(),
});
export type SfProductSpec = z.infer<typeof SfProductSpec>;

// ── API: GET /api/v1/salesforce/opportunities ────────────────────────────────────────────────────

export const SfOpportunitySearchQuery = z.object({
  q: z.string().trim().max(200).default(''),
  /** Only opportunities the caller owns in SF (email/alias matched to the SF owner). */
  mine: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  openOnly: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SfOpportunitySearchQuery = z.infer<typeof SfOpportunitySearchQuery>;

export const SfOpportunitySummary = z.object({
  id: z.string(),
  name: z.string(),
  accountId: z.string().nullable(),
  accountName: z.string().nullable(),
  ownerAlias: z.string().nullable(),
  ownerEmail: z.string().nullable(),
  amount: z.number().nullable(),
  closeDate: z.string().nullable(),
  stage: z.string().nullable(),
  isClosed: z.boolean(),
  erfNumber: z.string().nullable(),
  quoteSource: z.string().nullable(),
  dataQuality: z.array(SfDataQualityFlag),
  /** Where this row came from: the local snapshot or a live SF search. */
  source: z.enum(['snapshot', 'live']),
});
export type SfOpportunitySummary = z.infer<typeof SfOpportunitySummary>;

export const SfOpportunitySearchResponse = z.object({
  items: z.array(SfOpportunitySummary),
  /** True when the snapshot had too few hits and SF was searched live. */
  liveSearched: z.boolean(),
  /** Set when the live search was attempted and failed; snapshot results are still returned. */
  liveError: z.string().nullable(),
});
export type SfOpportunitySearchResponse = z.infer<typeof SfOpportunitySearchResponse>;

// ── API: GET /api/v1/salesforce/opportunities/:id ────────────────────────────────────────────────

export const SfOpportunityIdParams = z.object({
  /** 15- or 18-character SF id. */
  id: z.string().regex(/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/, 'Not a Salesforce id'),
});

export const SfOpportunityDetail = z.object({
  opportunity: SfOpportunity,
  account: SfAccount.nullable(),
  productSpecs: z.array(SfProductSpec),
  /** CCQ stage hint for the SF stage (sf_stage_map), for side-by-side display. */
  ccqStageHint: z.string().nullable(),
  /** When the local snapshot was last written by the sync, if there is one. */
  snapshotSyncedAt: z.string().nullable(),
  /** When SF was last read live for this record (cached 60 s). Null if the live read failed. */
  liveRefreshedAt: z.string().nullable(),
  /** Set when the live refresh failed and the snapshot is shown instead. */
  liveError: z.string().nullable(),
  /** True when SF reports the record deleted or no longer returns it. */
  deletedInSf: z.boolean(),
});
export type SfOpportunityDetail = z.infer<typeof SfOpportunityDetail>;

// ── API: admin ───────────────────────────────────────────────────────────────────────────────────

export const INTEGRATION_RUN_STATUSES = ['running', 'succeeded', 'failed', 'partial'] as const;

export const IntegrationRun = z.object({
  id: z.string(),
  source: z.string(),
  status: z.enum(INTEGRATION_RUN_STATUSES),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  counts: z.record(z.string(), z.number()),
  error: z.string().nullable(),
});
export type IntegrationRun = z.infer<typeof IntegrationRun>;

export const IntegrationRunsQuery = z.object({
  source: z.enum(['salesforce', 'pricing', 'sharepoint']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const IntegrationRunsResponse = z.object({ items: z.array(IntegrationRun) });
export type IntegrationRunsResponse = z.infer<typeof IntegrationRunsResponse>;

export const SfSyncTriggerResponse = z.object({
  /** `skipped`: another instance holds the sync lock. `running`: still going after 25 s (see the runs list). */
  outcome: z.enum(['succeeded', 'partial', 'failed', 'skipped', 'running']),
  runId: z.string().nullable(),
  counts: z.record(z.string(), z.number()),
});
export type SfSyncTriggerResponse = z.infer<typeof SfSyncTriggerResponse>;

/** Quote ↔ SF ERF linkage (PRD success measure: % of SF opportunities linked to an ERF number). */
export const ErfLinkageRow = z.object({
  quoteNumber: z.string(),
  stageKey: z.string(),
  sfOpportunityId: z.string(),
  sfOpportunityName: z.string().nullable(),
  sfStage: z.string().nullable(),
  sfErfNumber: z.string().nullable(),
  ccqErfNumber: z.string().nullable(),
  /** both_missing | sf_only | ccq_only | match | mismatch (compared ignoring case and spacing). */
  linkage: z.enum(['both_missing', 'sf_only', 'ccq_only', 'match', 'mismatch']),
  mismatch: z.boolean(),
  sfStatusFlag: z.string().nullable(),
});
export type ErfLinkageRow = z.infer<typeof ErfLinkageRow>;

export const ErfLinkageResponse = z.object({
  items: z.array(ErfLinkageRow),
  summary: z.object({
    quotes: z.number().int(),
    /** Quotes whose SF opportunity carries an ERF number. */
    sfLinked: z.number().int(),
    /** sfLinked / quotes, 0–1 (0 when there are no quotes). */
    sfLinkedPct: z.number(),
    ccqLinked: z.number().int(),
    mismatches: z.number().int(),
  }),
});
export type ErfLinkageResponse = z.infer<typeof ErfLinkageResponse>;
