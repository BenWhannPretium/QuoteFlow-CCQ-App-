/**
 * Field-level sensitivity registry. Keys are matched in snake_case, so both the DB shape (`prelim_capital_usd`)
 * and the DTO shape (`prelimCapitalUsd`) are caught. Everything listed is tagged `commercial` (architecture §3.3).
 */
export const COMMERCIAL_FIELDS = {
  /** Exact keys, at any depth. */
  keys: ['prelim_capital_usd'],
  /** Any key starting with one of these (price_approved_by, priceRange, margin_pct, …). */
  keyPrefixes: ['price', 'margin'],
  /** Keys whose whole value is dropped (price approval details, pricing-app figures). */
  subtrees: ['pricing_record'],
  /** Keys that are commercial only beneath an ancestor: the capacity-evidence numbers. */
  scopedKeys: {
    capacity_evidence: [
      'assumed_effectiveness_pct',
      'cycle_time_s',
      'utilization_pct',
      'buffer_pct',
    ],
  } as Readonly<Record<string, readonly string[]>>,
} as const;

/** `prelimCapitalUsd` and `prelim_capital_usd` both become `prelim_capital_usd`. */
export function toSnakeCase(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/** `ancestors` are the snake_cased keys of the objects/arrays the key sits inside. */
export function isCommercialKey(key: string, ancestors: readonly string[]): boolean {
  const name = toSnakeCase(key);
  if ((COMMERCIAL_FIELDS.keys as readonly string[]).includes(name)) return true;
  if (COMMERCIAL_FIELDS.keyPrefixes.some((prefix) => name.startsWith(prefix))) return true;
  if ((COMMERCIAL_FIELDS.subtrees as readonly string[]).includes(name)) return true;
  return ancestors.some(
    (ancestor) => COMMERCIAL_FIELDS.scopedKeys[ancestor]?.includes(name) ?? false,
  );
}
