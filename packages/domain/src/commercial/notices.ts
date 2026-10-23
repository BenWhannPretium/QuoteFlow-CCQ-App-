import { z } from 'zod';

import { DomainError } from '../errors';
import { asUserId } from '../types/ids';
import type { PlannedNotification } from '../workflow/evaluate';

/**
 * B-26 early notices (deck slides 9-10). Awareness, never approval:
 *
 * - **Capital Management** gets early notice the first time a quote is flagged "capital likely". The
 *   standard that defines "significant capital" is open (D-27), so the flag is set by a person (Sales or
 *   upfront Engineering), not computed.
 * - **Market Development** is told when a qualified quote (one entering Engineering Review) is at or
 *   above a value threshold (estimated annual revenue). The threshold is open: `null` = off.
 *
 * Neither group is a CCQ role, so the recipients are named CCQ users (config). Each notice goes once
 * per quote. Empty recipients = nobody to tell yet.
 */

const recipients = z.array(z.uuid()).refine((v) => new Set(v).size === v.length, 'duplicate user');

export interface CapitalNoticeSetting {
  recipientUserIds: string[];
}
export const CAPITAL_NOTICE_SEED: CapitalNoticeSetting = { recipientUserIds: [] };
export const capitalNoticeSchema = z.object({ recipientUserIds: recipients }).strict();

export interface MarketDevNoticeSetting {
  /** At or above this estimated annual revenue (USD). null = off (D-27 threshold not set). */
  minAnnualRevenueUsd: number | null;
  recipientUserIds: string[];
}
export const MARKET_DEV_NOTICE_SEED: MarketDevNoticeSetting = {
  minAnnualRevenueUsd: null,
  recipientUserIds: [],
};
export const marketDevNoticeSchema = z
  .object({
    minAnnualRevenueUsd: z.number().finite().nonnegative().nullable(),
    recipientUserIds: recipients,
  })
  .strict();

function parser<T>(key: string, schema: z.ZodType<T>, seed: T) {
  return (input: unknown): T => {
    if (input === undefined || input === null) return structuredClone(seed);
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(value)'}: ${i.message}`)
        .join('; ');
      throw new DomainError('INVALID_CONFIG', `${key}: ${detail}`);
    }
    return parsed.data;
  };
}

export const parseCapitalNotice = parser(
  'capital_management_notice',
  capitalNoticeSchema,
  CAPITAL_NOTICE_SEED,
);
export const parseMarketDevNotice = parser(
  'market_development_notice',
  marketDevNoticeSchema,
  MARKET_DEV_NOTICE_SEED,
);

const toUsers = (type: string, ids: readonly string[]): PlannedNotification[] =>
  ids.map((id) => ({ type, recipient: { kind: 'user', userId: asUserId(id) } }));

/** Capital Management's notice when `capital_likely` is first set on a quote (once per quote). */
export function planCapitalNotice(
  setting: CapitalNoticeSetting,
  quote: { capitalLikely: boolean; capitalNoticeSentAt: Date | null },
): PlannedNotification[] {
  if (!quote.capitalLikely || quote.capitalNoticeSentAt) return [];
  return toUsers('quote.capital_likely', setting.recipientUserIds);
}

/** Market Development's notice when a quote at or above the threshold is qualified (once per quote). */
export function planMarketDevNotice(
  setting: MarketDevNoticeSetting,
  quote: { estAnnualRevenue: number | null; marketDevNoticeSentAt: Date | null },
): PlannedNotification[] {
  if (setting.minAnnualRevenueUsd === null || quote.marketDevNoticeSentAt) return [];
  if (quote.estAnnualRevenue === null || quote.estAnnualRevenue < setting.minAnnualRevenueUsd)
    return [];
  return toUsers('quote.market_dev', setting.recipientUserIds);
}
