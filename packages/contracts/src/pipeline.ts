import { z } from 'zod';

import { CapitalReadiness } from './pricing';
import { QuoteSummary } from './quotes';

// ── B-14 Pipeline views (F-07): quote list, prioritization, board, CSV export ───────────────────────

/**
 * A multi-value filter: repeated keys (`stage=QUOTING&stage=FINAL_REVIEW`), `stage[]=…` (the route
 * renames those) or comma-separated (`stage=QUOTING,FINAL_REVIEW`). Always parsed to an array.
 */
const multi = z.union([z.string().max(500), z.array(z.string().max(200)).max(50)]).transform((v) =>
  (Array.isArray(v) ? v : [v])
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter(Boolean),
);

const flag = z.enum(['true', 'false']).transform((v) => v === 'true');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** Sort keys of `GET /quotes` (the "inline sort"). Each has a natural default direction. */
export const QUOTE_SORT_KEYS = ['score', 'tier', 'age', 'closeDate', 'amount', 'updated'] as const;
export const QuoteSortKey = z.enum(QUOTE_SORT_KEYS);
export type QuoteSortKey = z.infer<typeof QuoteSortKey>;
/** Default direction per sort key: highest score/tier/amount, oldest, soonest close, latest update. */
export const QUOTE_SORT_DEFAULT_DIR: Record<QuoteSortKey, 'asc' | 'desc'> = {
  score: 'desc',
  tier: 'desc',
  age: 'desc',
  closeDate: 'asc',
  amount: 'desc',
  updated: 'desc',
};

/** `status`: a quote status, or `open` (anything not closed). */
export const QuoteStatusFilter = z.enum(['open', 'active', 'on_hold', 'closed']);
export type QuoteStatusFilter = z.infer<typeof QuoteStatusFilter>;

/** The shared filters of the list, board and export (the URL carries exactly these). */
export const QuoteFilterQuery = z.object({
  /** Quote number, opportunity name, account (customer / SF account) or description; trigram-indexed. */
  q: z.string().max(200).optional(),
  stage: multi.optional(),
  /** Tier keys (display tier: the override when one applies). Withheld priorities never match. */
  tier: multi.optional(),
  /** KAM user ids; `me` is the caller. */
  kam: multi.optional(),
  /** Assigned engineer user ids; `me` is the caller, `unassigned` no engineer. */
  engineer: multi.optional(),
  productFamily: multi.optional(),
  market: multi.optional(),
  resin: multi.optional(),
  status: QuoteStatusFilter.optional(),
  /** In the current stage for more than N calendar days (time on hold included). */
  agedOverDays: z.coerce.number().int().min(0).max(3650).optional(),
  /** Expected close date range (inclusive). */
  closeDateFrom: isoDate.optional(),
  closeDateTo: isoDate.optional(),
  /** Only quotes with (true) or without (false) G1 qualification warnings. */
  hasWarnings: flag.optional(),
  /** Only quotes whose Salesforce stage disagrees on the outcome (B-13), or that agree. */
  sfMismatch: flag.optional(),
});
export type QuoteFilterQuery = z.input<typeof QuoteFilterQuery>;
export type QuoteFilters = z.output<typeof QuoteFilterQuery>;

/** The filter keys, in URL order (the web app serializes exactly these). */
export const QUOTE_FILTER_KEYS = Object.keys(QuoteFilterQuery.shape) as (keyof QuoteFilters)[];

export const QUOTE_LIST_MAX_PAGE_SIZE = 200;

/** `GET /api/v1/quotes`. */
export const QuoteListQuery = QuoteFilterQuery.extend({
  sort: QuoteSortKey.optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(QUOTE_LIST_MAX_PAGE_SIZE).optional(),
});
export type QuoteListQuery = z.input<typeof QuoteListQuery>;
export type QuoteListParams = z.output<typeof QuoteListQuery>;

/** Commercial columns of a list row: null for roles without `quote.read.commercialFields`. */
export const QuoteListCommercial = z.object({
  prelimCapitalUsd: z.number().nullable(),
  capitalReadiness: CapitalReadiness.nullable(),
});
export type QuoteListCommercial = z.infer<typeof QuoteListCommercial>;

export const QuoteListItem = QuoteSummary.extend({
  /** The Salesforce opportunity amount: visible to everyone (mirrors SF visibility). */
  amount: z.number().nullable(),
  accountName: z.string().nullable(),
  /** "Product one-liner": the standard description, else the free text, truncated. */
  productSummary: z.string().nullable(),
  assignedEngineerId: z.string().nullable(),
  assignedEngineerName: z.string().nullable(),
  /** When the quote entered its current stage, and whole days since (holds included). */
  stageEnteredAt: z.string().nullable(),
  daysInStage: z.number().int(),
  sfStage: z.string().nullable(),
  sfMismatch: z.boolean(),
  validityUntil: z.string().nullable(),
  /** B-13: the proposal's validity has passed with no outcome recorded. */
  validityExpired: z.boolean(),
  updatedAt: z.string(),
  commercial: QuoteListCommercial.nullable(),
});
export type QuoteListItem = z.infer<typeof QuoteListItem>;

/** People the filters can pick from: KAMs and assigned engineers on quotes in the caller's scope. */
export const PipelineFilterOptions = z.object({
  kams: z.array(z.object({ id: z.string(), displayName: z.string() })),
  engineers: z.array(z.object({ id: z.string(), displayName: z.string() })),
});
export type PipelineFilterOptions = z.infer<typeof PipelineFilterOptions>;

export const QuoteListResponse = z.object({
  items: z.array(QuoteListItem),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  sort: QuoteSortKey,
  dir: z.enum(['asc', 'desc']),
  /** The caller may download the CSV (`export.csv`). */
  canExport: z.boolean(),
  /** The caller sees commercial columns (`quote.read.commercialFields`). */
  commercialVisible: z.boolean(),
  /** False when `kam_can_see_peer_scores` withholds peers' priority from the caller. */
  peerPriorityVisible: z.boolean(),
  filterOptions: PipelineFilterOptions,
});
export type QuoteListResponse = z.infer<typeof QuoteListResponse>;

// ── Board ────────────────────────────────────────────────────────────────────────────────────────

export const BoardQuery = QuoteFilterQuery.extend({
  /** Include the cards of terminal stages (the "Closed (n)" lane is collapsed by default). */
  includeClosed: flag.optional(),
});
export type BoardQuery = z.input<typeof BoardQuery>;
export type BoardParams = z.output<typeof BoardQuery>;

/** An available gate action, reduced to what the board needs (from the domain's `availableActions`). */
export const BoardAction = z.object({
  gateKey: z.string(),
  gateLabel: z.string(),
  outcomeKey: z.string(),
  outcomeLabel: z.string(),
  targetStageKeys: z.array(z.string()),
  nextStatus: z.enum(['active', 'on_hold', 'closed']),
});
export type BoardAction = z.infer<typeof BoardAction>;

export const BoardCard = z.object({
  id: z.string(),
  quoteNumber: z.string(),
  stageKey: z.string(),
  status: z.string(),
  /** Withheld (`kam_can_see_peer_scores`): tier and score are null. */
  priorityVisible: z.boolean(),
  score: z.number().nullable(),
  tier: z.string().nullable(),
  tierLabel: z.string().nullable(),
  tierOverridden: z.boolean(),
  accountName: z.string().nullable(),
  productSummary: z.string().nullable(),
  estAnnualVolume: z.number().nullable(),
  amount: z.number().nullable(),
  kamUserId: z.string(),
  kamName: z.string().nullable(),
  kamInitials: z.string(),
  stageEnteredAt: z.string().nullable(),
  daysInStage: z.number().int(),
  /** Reasons for the warnings dot (qualification warnings, validity expired, SF mismatch). */
  warnings: z.array(z.string()),
  /** What the caller may decide on this quote now; empty = the card can't be dragged. */
  actions: z.array(BoardAction),
});
export type BoardCard = z.infer<typeof BoardCard>;

export const BoardColumn = z.object({
  stageKey: z.string(),
  label: z.string(),
  terminal: z.boolean(),
  count: z.number().int(),
  /** Sum of the SF opportunity amounts in the column (not commercial: mirrors SF). */
  totalAmount: z.number(),
  /** Empty for terminal columns unless `includeClosed=true`. */
  cards: z.array(BoardCard),
});
export type BoardColumn = z.infer<typeof BoardColumn>;

export const BoardResponse = z.object({
  columns: z.array(BoardColumn),
  closed: z.object({ count: z.number().int(), totalAmount: z.number(), included: z.boolean() }),
  /** The gate deciding each stage (for the "why can't I drop here" text). */
  gates: z.array(
    z.object({ key: z.string(), stageKey: z.string(), label: z.string(), enabled: z.boolean() }),
  ),
  filterOptions: PipelineFilterOptions,
});
export type BoardResponse = z.infer<typeof BoardResponse>;

// ── CSV export ───────────────────────────────────────────────────────────────────────────────────

/** Export cap: more matching rows than this is a 422 asking to narrow the filters. */
export const QUOTE_EXPORT_MAX_ROWS = 5_000;

/**
 * Columns the list can show and the CSV can contain (key → header). Commercial keys (per the domain's
 * sensitivity registry: `prelimCapitalUsd`, `capitalReadiness`) are dropped for roles without
 * `quote.read.commercialFields`, whatever the request asks for.
 */
export const QUOTE_LIST_COLUMNS = {
  quoteNumber: 'Quote',
  stage: 'Stage',
  status: 'Status',
  tier: 'Tier',
  score: 'Score',
  customerName: 'Account',
  opportunityName: 'Opportunity',
  productSummary: 'Product',
  productFamily: 'Product family',
  market: 'Market',
  resin: 'Resin',
  estAnnualVolume: 'Volume / yr',
  amount: 'Amount (SF)',
  kamName: 'KAM',
  assignedEngineerName: 'Engineer',
  daysInStage: 'Days in stage',
  expectedCloseDate: 'Close date',
  sfStage: 'SF stage',
  warnings: 'Warnings',
  validityUntil: 'Valid until',
  updatedAt: 'Updated',
  prelimCapitalUsd: 'Prelim capital (USD)',
  capitalReadiness: 'Capital readiness',
} as const;
export type QuoteListColumnKey = keyof typeof QUOTE_LIST_COLUMNS;
export const QUOTE_LIST_COLUMN_KEYS = Object.keys(QUOTE_LIST_COLUMNS) as QuoteListColumnKey[];
/** Shown when the user hasn't chosen columns. */
export const QUOTE_LIST_DEFAULT_COLUMNS: QuoteListColumnKey[] = [
  'quoteNumber',
  'tier',
  'customerName',
  'productSummary',
  'stage',
  'kamName',
  'estAnnualVolume',
  'amount',
  'daysInStage',
  'expectedCloseDate',
];

export const QuoteExportQuery = QuoteListQuery.omit({ page: true, pageSize: true }).extend({
  /** The visible list columns, comma-separated, in order. Default: QUOTE_LIST_DEFAULT_COLUMNS. */
  columns: multi.optional(),
});
export type QuoteExportQuery = z.input<typeof QuoteExportQuery>;
export type QuoteExportParams = z.output<typeof QuoteExportQuery>;

export const PIPELINE_PROBLEM_CODES = {
  exportTooLarge: 'export_too_large',
  badFilter: 'bad_filter',
} as const;
