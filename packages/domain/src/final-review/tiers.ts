import { z } from 'zod';

import { DomainError } from '../errors';
import { RELEASE_GATE_KEY } from './release';
import type { Actor } from '../types/actor';
import { ROLES } from '../types/roles';

/**
 * Approver tiers for Final Review (B-12, D-10). Who may release which quote is an OPEN decision (Sarah
 * Brennan, Darren Miller, Paul Slomkowski, a sales leader within delegation, or a delegate; tiers
 * aligned to the CER matrix later), so this is a hook, not a rule: `app_setting.g4_tier_rules` is
 * `null` (disabled) until the business decides. Nobody is named in code: a tier names ROLES (the
 * Entra groups behind them, e.g. SG-CCQ-Approver) and, if needed, user ids held in config.
 *
 * Shape (the setting's value):
 * {
 *   "outcomeKeys": ["approve"],               // which outcomes the tiers gate (default: approve only)
 *   "tiers": [                                // ordered lowest → highest: the LAST tier that matches applies
 *     { "key": "t1", "label": "…", "minCapitalUsd": 250000, "approverRoles": ["Approver"] },
 *     { "key": "t2", "label": "…", "minCapitalUsd": 1000000, "minAnnualRevenueUsd": 5000000,
 *       "approverRoles": ["Leadership"], "approverUserIds": ["<app_user id>"] }
 *   ]
 * }
 * A tier matches when ANY of its thresholds is met (capital = the engineering preliminary capital
 * estimate; revenue = the estimated annual revenue). The actor satisfies a tier by holding one of its
 * roles or being one of its users. They must still hold `gate.G4.decide` and pass segregation.
 */
const tierSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    minCapitalUsd: z.number().nonnegative().optional(),
    minAnnualRevenueUsd: z.number().nonnegative().optional(),
    approverRoles: z.array(z.enum(ROLES)).default([]),
    approverUserIds: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .refine((t) => t.minCapitalUsd !== undefined || t.minAnnualRevenueUsd !== undefined, {
    message: 'a tier needs minCapitalUsd or minAnnualRevenueUsd',
  })
  .refine((t) => t.approverRoles.length + t.approverUserIds.length > 0, {
    message: 'a tier needs at least one approver role or user',
  });

export const approverTierRulesSchema = z
  .object({
    outcomeKeys: z.array(z.string().min(1)).min(1).default(['approve']),
    tiers: z.array(tierSchema).min(1),
  })
  .strict()
  .refine((r) => new Set(r.tiers.map((t) => t.key)).size === r.tiers.length, {
    message: 'tier keys must be unique',
  });

export type ApproverTier = z.infer<typeof tierSchema>;
export type ApproverTierRules = z.infer<typeof approverTierRulesSchema>;

/** The setting's seed: disabled. */
export const G4_TIER_RULES_SEED = null;

/** `g4_tier_rules`: null / undefined = disabled; anything else must match the schema or INVALID_CONFIG. */
export function parseApproverTierRules(input: unknown): ApproverTierRules | null {
  if (input === null || input === undefined) return null;
  const parsed = approverTierRulesSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new DomainError('INVALID_CONFIG', `g4_tier_rules failed validation: ${detail}`);
  }
  return parsed.data;
}

/** What a tier looks at. Both come from the quote's fields (snake_case, as the rules see them). */
export interface TierMetrics {
  capitalUsd: number | null;
  annualRevenueUsd: number | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export function tierMetrics(fields: Readonly<Record<string, unknown>>): TierMetrics {
  return {
    capitalUsd: num(fields.prelim_capital_usd),
    annualRevenueUsd: num(fields.est_annual_revenue),
  };
}

/** The highest tier the quote falls in (the last that matches), or null when none does. */
export function requiredApproverTier(
  rules: ApproverTierRules | null,
  metrics: TierMetrics,
): ApproverTier | null {
  if (!rules) return null;
  let found: ApproverTier | null = null;
  for (const tier of rules.tiers) {
    const byCapital =
      tier.minCapitalUsd !== undefined &&
      metrics.capitalUsd !== null &&
      metrics.capitalUsd >= tier.minCapitalUsd;
    const byRevenue =
      tier.minAnnualRevenueUsd !== undefined &&
      metrics.annualRevenueUsd !== null &&
      metrics.annualRevenueUsd >= tier.minAnnualRevenueUsd;
    if (byCapital || byRevenue) found = tier;
  }
  return found;
}

export function actorSatisfiesTier(actor: Actor, tier: ApproverTier): boolean {
  return (
    tier.approverRoles.some((role) => actor.roles.includes(role)) ||
    tier.approverUserIds.includes(actor.userId)
  );
}

/** Do the tier rules apply to this decision (gate G4 and one of the gated outcomes)? */
export function tierRulesApply(
  rules: ApproverTierRules | null,
  gateKey: string,
  outcomeKey: string,
): rules is ApproverTierRules {
  return !!rules && gateKey === RELEASE_GATE_KEY && rules.outcomeKeys.includes(outcomeKey);
}

/** The tier error for this actor and decision, or an empty list. Pure. */
export function approverTierErrors(
  rules: ApproverTierRules | null,
  fields: Readonly<Record<string, unknown>>,
  actor: Actor,
  gateKey: string,
  outcomeKey: string,
): DomainError[] {
  if (!tierRulesApply(rules, gateKey, outcomeKey)) return [];
  const tier = requiredApproverTier(rules, tierMetrics(fields));
  if (!tier || actorSatisfiesTier(actor, tier)) return [];
  return [
    new DomainError(
      'TIER_APPROVER_REQUIRED',
      `This quote needs approval from the "${tier.label}" approver tier`,
    ),
  ];
}

/** For the review screen: the tier this quote needs and whether the viewer satisfies it. */
export function approverRequirement(
  rules: ApproverTierRules | null,
  fields: Readonly<Record<string, unknown>>,
  actor: Actor,
): { tierKey: string; tierLabel: string; satisfied: boolean } | null {
  const tier = requiredApproverTier(rules, tierMetrics(fields));
  if (!rules || !tier) return null;
  return { tierKey: tier.key, tierLabel: tier.label, satisfied: actorSatisfiesTier(actor, tier) };
}
