import type { PublicConfigResponse } from '@ccq/contracts';
import { marketPath } from '@ccq/domain';

/** What the UI shows beside a value that has been taken off its list (FB-03's EBM wheel, FB-12's old markets). */
export const RETIRED_SUFFIX = ' (no longer offered)';

/**
 * A stored code's label: the active entry's label, else the label of a retired entry with
 * "(no longer offered)", else the code as stored. Null for no code.
 */
export function listLabel(
  config: Pick<PublicConfigResponse, 'valueLists' | 'retiredLabels'> | undefined,
  list: string,
  code: string | null | undefined,
): string | null {
  if (!code) return null;
  const active = config?.valueLists[list]?.find((v) => v.code === code);
  if (active) return active.label;
  const retired = config?.retiredLabels?.[list]?.[code];
  return retired !== undefined ? `${retired}${RETIRED_SUFFIX}` : code;
}

/** FB-12 (F-073): "Food › Snacks & Confections", or just the market when no sub-market is picked. */
export function marketText(
  config: Pick<PublicConfigResponse, 'valueLists' | 'retiredLabels'> | undefined,
  market: string | null | undefined,
  subMarket: string | null | undefined,
): string | null {
  return marketPath(
    listLabel(config, 'market', market),
    listLabel(config, 'sub_market', subMarket),
  );
}

/** The market a sub-market belongs to (its value-list `meta.market`), or null. */
export function parentMarket(
  config: Pick<PublicConfigResponse, 'valueLists'> | undefined,
  subMarket: string,
): string | null {
  const market = config?.valueLists.sub_market?.find((e) => e.code === subMarket)?.meta.market;
  return typeof market === 'string' ? market : null;
}
