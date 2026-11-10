import type { PublicConfigResponse } from '@ccq/contracts';

/**
 * A stored value-list code as a label. A code that is no longer offered (an inactive entry, FB-03
 * EBM_WHEEL, FB-09 retired resins) still shows its label, marked "(no longer offered)"; an unknown
 * code shows as it is. `fallback` is returned for an empty code.
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
  return retired ? `${retired} (no longer offered)` : code;
}
