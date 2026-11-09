import { z } from 'zod';

import { getFact, toNumber } from './inputs';
import type { ScoringFacts } from './inputs';
import type { WorkflowConfig } from '../types/workflow-config';

/**
 * FB-10 (T-011, F-005, D-004 open): volume-band routing at intake. When switched on, a submitted quote
 * whose volume (or revenue) is OUTSIDE the band goes to the sales leader to qualify (G1); a quote IN
 * the band goes straight to Engineering (the SUBMIT gate). The band, the metric and the switch are config
 * (`g1_volume_routing`), seeded OFF: until D-004 sets the band the G1 / SUBMIT choice stays the plain
 * `g1_enabled` switch. Pure: nothing here reads a database.
 *
 * Deviation noted for the PR: the tracker row T-011 says "revenue bands"; the FB-10 prompt and D-004
 * say volume bands from the machine platform guide. The metric is therefore a setting, seeded as volume.
 */

export const VOLUME_ROUTING_METRICS = ['est_annual_volume', 'est_annual_revenue'] as const;
export type VolumeRoutingMetric = (typeof VOLUME_ROUTING_METRICS)[number];

export const volumeRoutingSchema = z
  .object({
    enabled: z.boolean(),
    metric: z.enum(VOLUME_ROUTING_METRICS),
    /** In the band when value >= min (null = no lower limit). */
    min: z.number().finite().nonnegative().nullable(),
    /** ... and value < max (null = no upper limit). */
    max: z.number().finite().nonnegative().nullable(),
  })
  .strict()
  .refine((v) => v.min === null || v.max === null || v.min < v.max, {
    message: 'The band minimum must be below its maximum',
    path: ['min'],
  });
export type VolumeRoutingSettings = z.infer<typeof volumeRoutingSchema>;

/**
 * Seed (provisional, OFF). Minimum 1,000,000 units: the lowest new-mold planning minimum in the machine
 * platform guide (RHB, Injection, EBM; ISBM and IBM are 3M), so a quote under it is under every platform's
 * minimum. No upper limit is agreed (D-004), hence `max: null`.
 */
export const VOLUME_ROUTING_SEED: VolumeRoutingSettings = {
  enabled: false,
  metric: 'est_annual_volume',
  min: 1_000_000,
  max: null,
};

export function parseVolumeRouting(value: unknown): VolumeRoutingSettings {
  const parsed = volumeRoutingSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...VOLUME_ROUTING_SEED, enabled: false };
}

export interface VolumeRoute {
  /** False when the switch is off: the plain `g1_enabled` choice stands. */
  applies: boolean;
  /** Only meaningful when `applies`. */
  route: 'sales_leader' | 'engineering' | null;
  inBand: boolean | null;
  /** One line for the audit event, the notification and the G1 screen. */
  reason: string | null;
}

const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const METRIC_LABEL: Record<VolumeRoutingMetric, string> = {
  est_annual_volume: 'annual volume',
  est_annual_revenue: 'annual revenue',
};

function describeBand(s: VolumeRoutingSettings): string {
  if (s.min !== null && s.max !== null) return `${fmt.format(s.min)} to under ${fmt.format(s.max)}`;
  if (s.min !== null) return `${fmt.format(s.min)} or more`;
  if (s.max !== null) return `under ${fmt.format(s.max)}`;
  return 'any value';
}

/**
 * Where does this quote go? A value that is missing can't be shown to be in the band, so it goes to the
 * sales leader (the safe side: a person looks at it).
 */
export function routeByVolumeBand(
  settings: VolumeRoutingSettings,
  facts: ScoringFacts,
): VolumeRoute {
  if (!settings.enabled) return { applies: false, route: null, inBand: null, reason: null };
  const label = METRIC_LABEL[settings.metric];
  const band = describeBand(settings);
  const value = toNumber(getFact(facts, `quote.${settings.metric}`));
  if (value === null) {
    return {
      applies: true,
      route: 'sales_leader',
      inBand: null,
      reason: `No ${label} given, so it cannot be checked against the ${band} band: the sales leader qualifies it`,
    };
  }
  const inBand =
    (settings.min === null || value >= settings.min) &&
    (settings.max === null || value < settings.max);
  return {
    applies: true,
    route: inBand ? 'engineering' : 'sales_leader',
    inBand,
    reason: inBand
      ? `${label[0]!.toUpperCase()}${label.slice(1)} ${fmt.format(value)} is in the ${band} band: straight to Engineering`
      : `${label[0]!.toUpperCase()}${label.slice(1)} ${fmt.format(value)} is outside the ${band} band: the sales leader qualifies it`,
  };
}

/**
 * The workflow as it applies to THIS submit: G1 on and SUBMIT off for a quote the band sends to the sales
 * leader, the reverse for one it sends to Engineering. Returns the workflow unchanged when the switch is
 * off or a gate is missing. Not persisted: the stored config (`g1_enabled`) is untouched.
 */
export function workflowForRoute(workflow: WorkflowConfig, route: VolumeRoute): WorkflowConfig {
  if (!route.applies || route.route === null) return workflow;
  const hasBoth = ['G1', 'SUBMIT'].every((k) => workflow.gates.some((g) => g.key === k));
  if (!hasBoth) return workflow;
  const toEngineering = route.route === 'engineering';
  return {
    ...workflow,
    gates: workflow.gates.map((g) =>
      g.key === 'G1'
        ? { ...g, enabled: !toEngineering }
        : g.key === 'SUBMIT'
          ? { ...g, enabled: toEngineering }
          : g,
    ),
  };
}
