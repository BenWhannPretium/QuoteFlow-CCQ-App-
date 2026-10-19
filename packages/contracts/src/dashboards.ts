import { z } from 'zod';

import { MetricInfo, OutcomeRates } from './analytics';

// ── B-17 role dashboards (F-02) ────────────────────────────────────────────────────────────────
//
// `GET /api/v1/dashboards/:role`. Blocks are scope-filtered by row-level security (a KAM sees what the
// KAM's data scope allows) and the KAM blocks are about the caller. Each block has an `info` with its
// definition and time window.

export const DASHBOARD_ROLES = [
  'KAM',
  'SalesLeader',
  'EngLead',
  'Engineer',
  'Pricing',
  'Approver',
  'Leadership',
] as const;
export const DashboardRole = z.enum(DASHBOARD_ROLES);
export type DashboardRole = z.infer<typeof DashboardRole>;

export const DashboardParams = z.object({ role: DashboardRole });

/** A quote row on a dashboard list. */
export const DashQuote = z.object({
  quoteNumber: z.string(),
  account: z.string(),
  stageKey: z.string(),
  stageLabel: z.string(),
  tier: z.string().nullable(),
  status: z.string(),
  kamName: z.string().nullable(),
  /** Calendar days in the current stage (holds included); null when unknown. */
  daysInStage: z.number().nullable(),
});
export type DashQuote = z.infer<typeof DashQuote>;

const Count = z.object({ info: MetricInfo, count: z.number() });

const StageCount = z.object({
  stageKey: z.string(),
  label: z.string(),
  count: z.number(),
  sfAmount: z.number(),
  quotes: z.array(DashQuote),
});
export const StagePipeline = z.object({
  info: MetricInfo,
  stages: z.array(StageCount),
  total: z.number(),
});
export type StagePipeline = z.infer<typeof StagePipeline>;

export const DashAgingBucket = z.object({ key: z.string(), label: z.string(), count: z.number() });

export const QueueHealth = z.object({
  info: MetricInfo,
  total: z.number(),
  /** Null where the queue has no assignment step (Quoting). */
  unassigned: z.number().nullable(),
  onHold: z.number(),
  buckets: z.array(DashAgingBucket),
});
export type QueueHealth = z.infer<typeof QueueHealth>;

export const ExpiringProposal = z.object({
  quoteNumber: z.string(),
  account: z.string(),
  validityUntil: z.string(),
  /** Days until validity ends (negative once lapsed). */
  daysLeft: z.number(),
  lapsed: z.boolean(),
  kamName: z.string().nullable(),
});
export type ExpiringProposal = z.infer<typeof ExpiringProposal>;

export const KamDashboard = z.object({
  role: z.literal('KAM'),
  drafts: z.object({
    info: MetricInfo,
    items: z.array(
      z.object({
        draftId: z.string(),
        opportunity: z.string().nullable(),
        step: z.number(),
        updatedAt: z.string(),
        reworkOfQuoteNumber: z.string().nullable(),
      }),
    ),
  }),
  returned: z.object({
    info: MetricInfo,
    items: z.array(
      z.object({
        quoteNumber: z.string(),
        account: z.string(),
        gateKey: z.string().nullable(),
        reason: z.string().nullable(),
        note: z.string().nullable(),
        returnedAt: z.string().nullable(),
        returnedBy: z.string().nullable(),
        /** The rework draft, if the KAM has started it. */
        draftId: z.string().nullable(),
      }),
    ),
  }),
  pipeline: StagePipeline,
  expiring: z.object({
    info: MetricInfo,
    withinDays: z.number(),
    items: z.array(ExpiringProposal),
  }),
  capture: z.object({ info: MetricInfo, rates: OutcomeRates }),
});
export type KamDashboard = z.infer<typeof KamDashboard>;

export const SalesLeaderDashboard = z.object({
  role: z.literal('SalesLeader'),
  toQualify: z.object({ info: MetricInfo, count: z.number(), items: z.array(DashQuote) }),
  pendingOverrides: z.object({
    info: MetricInfo,
    count: z.number(),
    items: z.array(
      z.object({
        overrideId: z.string(),
        quoteNumber: z.string(),
        field: z.string(),
        requestedBy: z.string().nullable(),
        requestedAt: z.string(),
        justification: z.string(),
      }),
    ),
  }),
  pipeline: StagePipeline,
  lackingOutcomes: z.object({
    info: MetricInfo,
    count: z.number(),
    items: z.array(ExpiringProposal),
  }),
});
export type SalesLeaderDashboard = z.infer<typeof SalesLeaderDashboard>;

const Median = z.object({ info: MetricInfo, medianDays: z.number().nullable(), n: z.number() });

/** EngLead and Engineer share one dashboard; `mine` is the Engineer's own open assignments. */
export const EngineeringDashboard = z.object({
  role: z.enum(['EngLead', 'Engineer']),
  queue: QueueHealth,
  load: z.object({
    info: MetricInfo,
    items: z.array(
      z.object({ engineerId: z.string().nullable(), name: z.string(), open: z.number() }),
    ),
  }),
  timeToAssign: Median,
  assignToG2: Median,
  returned: z.object({
    info: MetricInfo,
    total: z.number(),
    reasons: z.array(z.object({ label: z.string(), count: z.number() })),
  }),
  mine: z.object({ info: MetricInfo, items: z.array(DashQuote) }),
});
export type EngineeringDashboard = z.infer<typeof EngineeringDashboard>;

export const PricingDashboard = z.object({
  role: z.literal('Pricing'),
  queue: QueueHealth,
  capitalPending: Count,
  medianInQuoting: Median,
});
export type PricingDashboard = z.infer<typeof PricingDashboard>;

export const ApproverDashboard = z.object({
  role: z.literal('Approver'),
  pending: z.object({
    info: MetricInfo,
    count: z.number(),
    items: z.array(DashQuote),
  }),
  decided: z.object({
    info: MetricInfo,
    total: z.number(),
    mine: z.number(),
    byOutcome: z.array(z.object({ key: z.string(), label: z.string(), count: z.number() })),
    recent: z.array(
      z.object({
        quoteNumber: z.string(),
        outcomeLabel: z.string(),
        decidedBy: z.string().nullable(),
        decidedAt: z.string(),
      }),
    ),
  }),
});
export type ApproverDashboard = z.infer<typeof ApproverDashboard>;

export const LeadershipDashboard = z.object({
  role: z.literal('Leadership'),
  openQuotes: z.object({
    info: MetricInfo,
    count: z.number(),
    sfAmount: z.number(),
    amountLabel: z.string(),
  }),
  outcomes: z.object({ info: MetricInfo, rates: OutcomeRates, lowCaptureBelow: z.number() }),
  endToEnd: z.object({ info: MetricInfo, n: z.number(), medianDays: z.number().nullable() }),
  firstPass: z.object({ info: MetricInfo, rate: z.number().nullable(), resolved: z.number() }),
  pipeline: StagePipeline,
});
export type LeadershipDashboard = z.infer<typeof LeadershipDashboard>;

export const DashboardResponse = z.discriminatedUnion('role', [
  KamDashboard,
  SalesLeaderDashboard,
  EngineeringDashboard,
  PricingDashboard,
  ApproverDashboard,
  LeadershipDashboard,
]);
export type DashboardResponse = z.infer<typeof DashboardResponse>;
