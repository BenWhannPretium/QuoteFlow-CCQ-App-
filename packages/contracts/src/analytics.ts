import { z } from 'zod';

// ── B-17 operational analytics (F-17 subset) ───────────────────────────────────────────────────
//
// Every block carries its own `info`: the definition and the time window, so the UI can show an info
// tooltip without hard-coding either. Every number is computed server-side from the `analytics_*`
// views (packages/db/sql/analytics). Rates are 0–1 or null ("not enough data"), never 0 by default.

/** The footer every analytics page shows. */
export const ANALYTICS_DISCLAIMER = 'Operational metrics from QuoteFlow; not yet D&A-certified.';
/** What the pipeline amount is, always labelled so it is never mistaken for price or revenue. */
export const SF_AMOUNT_LABEL = 'SF opportunity amount (as entered)';
/** Outcome capture below this share makes a win rate unreliable; the page says so beside it. */
export const LOW_CAPTURE_BELOW = 0.5;

const multi = z.union([z.string().max(500), z.array(z.string().max(200)).max(50)]).transform((v) =>
  (Array.isArray(v) ? v : [v])
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter(Boolean),
);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/**
 * Filters shared by every analytics chart. `from` / `to` are US Central calendar days, both inclusive;
 * the default window is the last 90 days. A snapshot chart (the pipeline) ignores the dates and says so.
 */
export const AnalyticsQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  market: multi.optional(),
  productFamily: multi.optional(),
  /** KAM user ids. */
  kam: multi.optional(),
  region: multi.optional(),
});
export type AnalyticsQuery = z.input<typeof AnalyticsQuery>;
export type AnalyticsParams = z.output<typeof AnalyticsQuery>;

export const ANALYTICS_FILTER_KEYS = Object.keys(AnalyticsQuery.shape) as (keyof AnalyticsParams)[];

export const MetricInfo = z.object({
  definition: z.string(),
  /** Plain-words time window, e.g. "Open quotes right now" or "Stays that ended 2026-08-01 to 2026-10-19". */
  window: z.string(),
});
export type MetricInfo = z.infer<typeof MetricInfo>;

/** The window the response was computed for (echoes the filters after defaults). */
export const AnalyticsWindow = z.object({
  from: z.string(),
  to: z.string(),
});
export type AnalyticsWindow = z.infer<typeof AnalyticsWindow>;

const rate = z.number().nullable();
const days = z.number().nullable();

// ── Filters ────────────────────────────────────────────────────────────────────────────────────

export const AnalyticsFiltersResponse = z.object({
  markets: z.array(z.string()),
  productFamilies: z.array(z.string()),
  regions: z.array(z.string()),
  kams: z.array(z.object({ id: z.string(), name: z.string().nullable() })),
  /** Display labels for the value-list codes. */
  labels: z.object({
    market: z.record(z.string(), z.string()),
    productFamily: z.record(z.string(), z.string()),
  }),
  window: AnalyticsWindow,
});
export type AnalyticsFiltersResponse = z.infer<typeof AnalyticsFiltersResponse>;

// ── Pipeline ───────────────────────────────────────────────────────────────────────────────────

export const PipelineStage = z.object({
  stageKey: z.string(),
  label: z.string(),
  count: z.number(),
  sfAmount: z.number(),
  /** Quotes in the stage with no (or a 0) SF amount: the amount total understates by these. */
  amountMissing: z.number(),
  onHold: z.number(),
});
export const PipelineResponse = z.object({
  info: MetricInfo,
  amountLabel: z.string(),
  stages: z.array(PipelineStage),
  totals: z.object({ count: z.number(), sfAmount: z.number(), amountMissing: z.number() }),
});
export type PipelineResponse = z.infer<typeof PipelineResponse>;

// ── Cycle time ─────────────────────────────────────────────────────────────────────────────────

export const CycleStage = z.object({
  stageKey: z.string(),
  label: z.string(),
  n: z.number(),
  medianDays: days,
  p75Days: days,
  /** Median wall-clock days, next to the active median so the effect of holds is visible. */
  medianElapsedDays: days,
  heldStays: z.number(),
});
export const CycleWeek = z.object({
  week: z.string(),
  n: z.number(),
  medianDays: days,
  p75Days: days,
});
export const CycleTimeResponse = z.object({
  info: MetricInfo,
  endToEndInfo: MetricInfo,
  window: AnalyticsWindow,
  stages: z.array(CycleStage),
  endToEnd: z.object({
    n: z.number(),
    medianDays: days,
    p75Days: days,
    medianElapsedDays: days,
    weekly: z.array(CycleWeek),
  }),
  /** Below this many completed stays a median is shown but flagged as thin. */
  thinBelow: z.number(),
});
export type CycleTimeResponse = z.infer<typeof CycleTimeResponse>;

// ── Flow ───────────────────────────────────────────────────────────────────────────────────────

export const FlowResponse = z.object({
  info: MetricInfo,
  wipInfo: MetricInfo,
  window: AnalyticsWindow,
  weekly: z.array(z.object({ week: z.string(), created: z.number(), closed: z.number() })),
  wip: z.object({
    stages: z.array(z.object({ stageKey: z.string(), label: z.string() })),
    weeks: z.array(z.object({ week: z.string(), counts: z.record(z.string(), z.number()) })),
  }),
});
export type FlowResponse = z.infer<typeof FlowResponse>;

// ── Outcomes ───────────────────────────────────────────────────────────────────────────────────

/** Win rate and capture rate, always together (S-06/S-07). */
export const OutcomeRates = z.object({
  awarded: z.number(),
  lost: z.number(),
  expired: z.number(),
  awaiting: z.number(),
  goneDark: z.number(),
  recorded: z.number(),
  /** awarded ÷ (awarded + lost); expired is not a loss. */
  winRate: rate,
  /** recorded ÷ (recorded + gone dark). */
  captureRate: rate,
  awardedAmount: z.number(),
  lostAmount: z.number(),
  /** Win rate by amount: awarded SF amount ÷ (awarded + lost). */
  winRateByAmount: rate,
  /** True when the capture rate is low enough that the win rate may mislead. */
  lowCapture: z.boolean(),
});
export type OutcomeRates = z.infer<typeof OutcomeRates>;

export const OutcomeSplitRow = OutcomeRates.extend({
  key: z.string(),
  label: z.string(),
});
export type OutcomeSplitRow = z.infer<typeof OutcomeSplitRow>;

export const OutcomesResponse = z.object({
  info: MetricInfo,
  captureInfo: MetricInfo,
  window: AnalyticsWindow,
  amountLabel: z.string(),
  lowCaptureBelow: z.number(),
  total: OutcomeRates,
  byMarket: z.array(OutcomeSplitRow),
  byProductFamily: z.array(OutcomeSplitRow),
  byKam: z.array(OutcomeSplitRow),
  lossReasonsInfo: MetricInfo,
  lossReasons: z.array(
    z.object({
      code: z.string().nullable(),
      label: z.string(),
      count: z.number(),
      amount: z.number(),
      /** Running share of all losses, for the Pareto line. */
      cumulativeShare: z.number(),
    }),
  ),
});
export type OutcomesResponse = z.infer<typeof OutcomesResponse>;

// ── Quality and governance ─────────────────────────────────────────────────────────────────────

export const FirstPassResponse = z.object({
  info: MetricInfo,
  window: AnalyticsWindow,
  resolved: z.number(),
  firstPass: z.number(),
  rate,
  reworkReasonsInfo: MetricInfo,
  reworkReasons: z.array(
    z.object({
      gateKey: z.string(),
      code: z.string().nullable(),
      label: z.string(),
      count: z.number(),
    }),
  ),
});
export type FirstPassResponse = z.infer<typeof FirstPassResponse>;

export const G1YieldResponse = z.object({
  info: MetricInfo,
  window: AnalyticsWindow,
  total: z.number(),
  outcomes: z.array(
    z.object({ key: z.string(), label: z.string(), count: z.number(), share: z.number() }),
  ),
});
export type G1YieldResponse = z.infer<typeof G1YieldResponse>;

export const OverridesResponse = z.object({
  info: MetricInfo,
  window: AnalyticsWindow,
  quotesCreated: z.number(),
  total: z.number(),
  /** Override requests per quote created in the window. */
  perQuote: rate,
  byField: z.array(z.object({ field: z.string(), count: z.number(), applied: z.number() })),
  byApprover: z.array(z.object({ approver: z.string(), count: z.number() })),
});
export type OverridesResponse = z.infer<typeof OverridesResponse>;

export const GateComplianceResponse = z.object({
  info: MetricInfo,
  window: AnalyticsWindow,
  proposals: z.number(),
  compliant: z.number(),
  rate,
  gates: z.array(z.object({ gateKey: z.string(), label: z.string(), recorded: z.number() })),
});
export type GateComplianceResponse = z.infer<typeof GateComplianceResponse>;

// ── Priority ───────────────────────────────────────────────────────────────────────────────────

export const PriorityResponse = z.object({
  info: MetricInfo,
  assignInfo: MetricInfo,
  window: AnalyticsWindow,
  tiers: z.array(z.object({ tier: z.string(), count: z.number(), share: z.number() })),
  assignByTier: z.array(
    z.object({ tier: z.string(), n: z.number(), medianDays: days, p75Days: days }),
  ),
  /** Does a higher tier get assigned no later (median) than a lower one? `unknown` without enough data. */
  queueHonoursPriority: z.enum(['yes', 'no', 'unknown']),
});
export type PriorityResponse = z.infer<typeof PriorityResponse>;

// ── Adoption ───────────────────────────────────────────────────────────────────────────────────

export const AdoptionResponse = z.object({
  info: MetricInfo,
  intakesInfo: MetricInfo,
  window: AnalyticsWindow,
  roles: z.array(z.string()),
  weeklyActive: z.array(z.object({ week: z.string(), byRole: z.record(z.string(), z.number()) })),
  intakes: z.array(z.object({ week: z.string(), count: z.number() })),
});
export type AdoptionResponse = z.infer<typeof AdoptionResponse>;
