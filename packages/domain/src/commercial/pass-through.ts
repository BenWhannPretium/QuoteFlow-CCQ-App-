import { z } from 'zod';

import { DomainError } from '../errors';

/**
 * B-26 (deck slide 12, open decision D-24): below a dollar amount Pricing sets, a price proceeds
 * without formal Pricing approval, so the new pricing gate does not become a bottleneck. Measured on
 * the quote's estimated annual revenue. `maxAnnualRevenueUsd: null` = off (the seed: Pricing has not
 * set the amount yet), so every price needs its approval.
 */
export interface PassThroughSetting {
  maxAnnualRevenueUsd: number | null;
}

export const PASS_THROUGH_SEED: PassThroughSetting = { maxAnnualRevenueUsd: null };

export const passThroughSchema = z
  .object({ maxAnnualRevenueUsd: z.number().finite().positive().nullable() })
  .strict();

export function parsePassThrough(input: unknown): PassThroughSetting {
  if (input === undefined || input === null) return { ...PASS_THROUGH_SEED };
  const parsed = passThroughSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError(
      'INVALID_CONFIG',
      'pricing_pass_through must be { maxAnnualRevenueUsd: number | null }',
    );
  }
  return parsed.data;
}

/** Strictly below the threshold, with a known revenue. Off when the threshold is not set. */
export function passThroughEligible(
  setting: PassThroughSetting,
  estAnnualRevenue: number | null | undefined,
): boolean {
  if (setting.maxAnnualRevenueUsd === null) return false;
  if (estAnnualRevenue === null || estAnnualRevenue === undefined) return false;
  return estAnnualRevenue < setting.maxAnnualRevenueUsd;
}
