/**
 * Field-level sensitivity registry. Keys are matched in snake_case, so both the DB shape (`prelim_capital_usd`)
 * and the DTO shape (`prelimCapitalUsd`) are caught. Everything listed is tagged `commercial` (architecture §3.3).
 */
export const COMMERCIAL_FIELDS = {
  /**
   * Exact keys, at any depth. B-15: the pricing app's estimated revenue / volume / net capital
   * (`PricingErf`), wherever they appear.
   */
  keys: [
    'prelim_capital_usd',
    'est_revenue_usd',
    'est_volume',
    'est_net_capital_usd',
    'current_price',
    'target_price',
  ],
  /** Any key starting with one of these (price_approved_by, priceRange, margin_pct, …). */
  keyPrefixes: ['price', 'margin'],
  /**
   * Keys whose whole value is dropped (price approval details, pricing-app figures). B-11: everything
   * on the Quoting tab is commercial, so the record's version history (`pricing_records`) and the
   * capital readiness status go too; other roles see only the approval status (who and when).
   *
   * B-15 (F-11): every pricing-app record (ERF, BPR, SPR history) is commercial as a whole, labels
   * included. The routes already need `quote.read.commercialFields`; this is the second layer.
   * TODO(M5): Gemma Cebolla confirms the sensitivity labels (architecture §3.3 role list, and whether
   * any ERF field, e.g. the decision or elapsed days, may go to KAMs/Engineers). Provisional until then:
   * the whole record stays commercial.
   */
  subtrees: [
    'pricing_record',
    'pricing_records',
    'capital_readiness',
    'erf_record',
    'erf_records',
    'bpr_record',
    'bpr_records',
    'spr_history',
    'pricing_context',
    'customer_erfs',
    'history_records',
  ],
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
