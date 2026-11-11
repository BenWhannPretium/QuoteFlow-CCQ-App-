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

/** A code from any value list as its label (the first list that knows it), or the code itself. */
function anyListLabel(
  config: Pick<PublicConfigResponse, 'valueLists' | 'retiredValues'> | undefined,
  code: string,
): string {
  for (const [list, entries] of Object.entries(config?.valueLists ?? {})) {
    if (entries.some((e) => e.code === code)) return valueListLabel(config, list, code) ?? code;
  }
  for (const [list, codes] of Object.entries(config?.retiredValues ?? {})) {
    if (codes && code in codes) return valueListLabel(config, list, code) ?? code;
  }
  return code;
}

/**
 * DR-kam-sales-leader-03: a score explanation in plain words. The domain explains a map attribute with
 * its stored codes ("HOME_CARE (not listed, default) → 50 points", "BOTTLE+HDPE (not listed, default)");
 * the screen shows the labels ("Home Care", "Bottle + HDPE") and says what "not listed" means.
 */
export function scoreExplanationText(
  config: Pick<PublicConfigResponse, 'valueLists' | 'retiredValues'> | undefined,
  raw: string | number | null,
  explanation: string,
): string {
  let text = explanation.replace(
    '(not listed, default)',
    '(no points set for it: neutral default)',
  );
  if (typeof raw === 'string' && raw && text.includes(raw)) {
    const label = raw
      .split('+')
      .map((part) => anyListLabel(config, part))
      .join(' + ');
    text = text.replace(raw, label);
  }
  return text;
}
