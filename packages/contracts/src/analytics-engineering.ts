import { z } from 'zod';

import { AnalyticsWindow, MetricInfo } from './analytics';
import { QueueHealth } from './dashboards';

// ── B-26 (A5) the Engineering lens of /analytics ─────────────────────────────────────────────────
//
// `GET /api/v1/analytics/engineering` (engQueue.read). What helps upfront engineering run the queue,
// as opposed to the leadership report: load per engineer, aging, capacity sign-offs, G2 outcomes and
// time in Engineering Review. No commercial figures (prelim capital and capacity numbers stay on the
// quote, behind quote.read.commercialFields).

const days = z.number().nullable();
const Median = z.object({ info: MetricInfo, n: z.number(), medianDays: days });

export const EngineeringAnalyticsResponse = z.object({
  window: AnalyticsWindow,
  /** Snapshot: open Engineering Review quotes, how many have no engineer, and how long they waited. */
  queue: QueueHealth,
  load: z.object({
    info: MetricInfo,
    items: z.array(
      z.object({
        engineerId: z.string().nullable(),
        name: z.string(),
        open: z.number(),
        onHold: z.number(),
        /** Calendar days the oldest of them has been in the stage. */
        oldestDays: z.number().nullable(),
      }),
    ),
  }),
  /** Snapshot: the capacity owner's sign-off (G2 needs it) on the open Engineering Review quotes. */
  capacity: z.object({
    info: MetricInfo,
    pending: z.number(),
    approved: z.number(),
    blocked: z.number(),
  }),
  g2Outcomes: z.object({
    info: MetricInfo,
    total: z.number(),
    byOutcome: z.array(z.object({ key: z.string(), label: z.string(), count: z.number() })),
  }),
  stageTime: z.object({
    info: MetricInfo,
    n: z.number(),
    medianDays: days,
    p75Days: days,
  }),
  timeToAssign: Median,
  assignToG2: Median,
  returned: z.object({
    info: MetricInfo,
    total: z.number(),
    reasons: z.array(z.object({ label: z.string(), count: z.number() })),
  }),
});
export type EngineeringAnalyticsResponse = z.infer<typeof EngineeringAnalyticsResponse>;
