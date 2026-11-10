import type { PublicConfigResponse } from '@ccq/contracts';
import { marketPath } from '@ccq/domain';

/** What the UI shows beside a value that has been taken off its list (FB-03's EBM wheel, FB-09's retired resins, FB-12's old markets). */
export const RETIRED_SUFFIX = ' (no longer offered)';

/**
 * A stored value-list code as a label. A code that is no longer offered (an inactive entry, FB-03
 * EBM_WHEEL, FB-09 retired resins, FB-12 old markets) still shows its label, marked "(no longer offered)";
 * an unknown code shows as it is. `fallback` is returned for an empty code.
 */
export function valueListLabel(
  config: Pick<PublicConfigResponse, 'valueLists' | 'retiredValues'> | undefined,
  list: string,
  code: string | null | undefined,
  fallback: string | null = null,
): string | null {
  if (!code) return fallback;
  const active = config?.valueLists[list]?.find((v) => v.code === code);
  if (active) return active.label;
  const retired = config?.retiredValues?.[list]?.[code];
  return retired ? `${retired}${RETIRED_SUFFIX}` : code;
}

/** FB-12 (F-073): "Food › Snacks & Confections", or just the market when no sub-market is picked. */
export function marketText(
  config: Pick<PublicConfigResponse, 'valueLists' | 'retiredValues'> | undefined,
  market: string | null | undefined,
  subMarket: string | null | undefined,
): string | null {
  return marketPath(
    valueListLabel(config, 'market', market),
    valueListLabel(config, 'sub_market', subMarket),
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
