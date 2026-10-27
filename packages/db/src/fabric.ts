/**
 * B-27 (L-8): what keeps the schema mirror-safe for Fabric mirroring (CLAUDE.md rule 10).
 *
 * Fabric mirroring from Azure Database for PostgreSQL copies only columns of the types below
 * (Microsoft Learn, "Troubleshoot Fabric mirrored databases from Azure Database for PostgreSQL",
 * checked 2026-10-26). Everything else (jsonb, json, arrays, interval, inet, ranges, …) is silently
 * left out of the mirror, and an unbounded `numeric` lands as Decimal(38, 0), losing its decimals.
 *
 * A column of another type gets a `<column>_json text` companion holding `to_jsonb(<column>)::text`,
 * kept in step by the `zz_fabric_json` trigger (migration 0022); append-only tables use a side table
 * (`FABRIC_SIDE_TABLES`). The companion columns are deliberately
 * **not** in the Drizzle schema: the app never reads or writes them, so they can't reach an API
 * response past redaction (a JSON string hides the keys `redact` matches on). Fabric reads them.
 */

/** `information_schema.columns.data_type` values Fabric mirrors (numeric only with precision ≤ 38). */
export const FABRIC_MIRRORED_TYPES = [
  'bigint',
  'boolean',
  'bytea',
  'character',
  'character varying',
  'date',
  'double precision',
  'integer',
  'money',
  'numeric',
  'oid',
  'real',
  'smallint',
  'text',
  'time without time zone',
  'timestamp without time zone',
  'timestamp with time zone',
  'uuid',
] as const;

/** Largest numeric precision Fabric keeps; above it the value lands as NULL. */
export const FABRIC_MAX_NUMERIC_PRECISION = 38;

/** The companion trigger's name. `zz_` so it fires after any other BEFORE trigger on the table. */
export const FABRIC_COMPANION_TRIGGER = 'zz_fabric_json';

/**
 * Append-only tables can't take companion columns: filling them on existing rows would mean updating
 * audit rows (CLAUDE.md rule 3). Their companions live in an insert-only side table instead, keyed by
 * the source row's id and written by an AFTER INSERT trigger (`fabric_side_copy`).
 */
export const FABRIC_SIDE_TABLES: Readonly<
  Record<string, { table: string; key: string; columns: readonly string[] }>
> = {
  audit_event: {
    table: 'audit_event_fabric',
    key: 'audit_event_id',
    columns: ['actor_roles', 'before', 'after'],
  },
};

/**
 * Every column Fabric can't mirror, by table (append-only tables: `FABRIC_SIDE_TABLES`). Add a column here **and** in a migration (companion
 * column, trigger argument, backfill) when a schema change introduces one: `fabricCompat.test.ts`
 * fails until both agree with the Drizzle schema, and the integration test checks the database.
 */
export const FABRIC_JSON_COMPANIONS: Readonly<Record<string, readonly string[]>> = {
  activity_event: ['payload'],
  app_setting: ['value'],
  comment: ['mentions'],
  customer: ['default_ship_to', 'contact'],
  gate_decision: ['evidence', 'payload'],
  gate_definition: ['required_fields'],
  gate_outcome_definition: ['required_fields', 'notify'],
  integration_run: ['counts'],
  notification: ['payload'],
  override: ['original_value', 'requested_value'],
  pricing_history_record: ['fields'],
  pricing_record: ['pricing_refs'],
  quote: [
    'components',
    'priority_breakdown',
    'ship_to',
    'ship_to_original',
    'structured_description',
  ],
  quote_draft: ['data'],
  role_permission: ['qualifier'],
  scoring_model: ['attributes', 'tier_thresholds'],
  segregation_rule: ['gate_keys', 'outcome_keys'],
  sf_opportunity_snapshot: ['data_quality', 'raw'],
  transition_rule: ['target_stage_keys'],
  user_preference: ['value'],
  user_scope: ['values'],
  value_list: ['meta'],
};

/** The companions of every unmirrorable column, wherever they live. */
export function fabricCompanionColumns(): {
  table: string;
  column: string;
  companionTable: string;
}[] {
  const rows = Object.entries(FABRIC_JSON_COMPANIONS).flatMap(([table, columns]) =>
    columns.map((column) => ({ table, column, companionTable: table })),
  );
  for (const [table, side] of Object.entries(FABRIC_SIDE_TABLES))
    for (const column of side.columns) rows.push({ table, column, companionTable: side.table });
  return rows;
}

/** `payload` → `payload_json`. */
export function fabricCompanionName(column: string): string {
  return `${column}_json`;
}

/**
 * Whether Fabric mirrors a column, from its Postgres type as Drizzle (`getSQLType()`) or
 * information_schema spells it: `numeric(14, 2)` yes, `numeric` (unbounded) no, `text[]` no.
 */
export function isFabricMirroredType(sqlType: string, numericPrecision?: number | null): boolean {
  const type = sqlType.trim().toLowerCase();
  if (type.endsWith('[]') || type === 'array') return false;
  const numeric = /^(numeric|decimal)(?:\s*\(\s*(\d+)\s*(?:,\s*\d+\s*)?\))?$/.exec(type);
  if (numeric) {
    const precision = numeric[2] !== undefined ? Number(numeric[2]) : numericPrecision;
    return precision != null && precision <= FABRIC_MAX_NUMERIC_PRECISION;
  }
  // Drizzle spells timestamps `timestamp (3) with time zone` and varchar `varchar(n)`.
  const normalised = type
    .replace(/\s*\(\s*\d+\s*\)/g, '')
    .replace(/^varchar$/, 'character varying')
    .replace(/^char$/, 'character')
    .replace(/^timestamptz$/, 'timestamp with time zone')
    .replace(/^timestamp$/, 'timestamp without time zone')
    .replace(/^time$/, 'time without time zone')
    .replace(/^(int|int4|serial)$/, 'integer')
    .replace(/^(int8|bigserial)$/, 'bigint')
    .replace(/^(int2|smallserial)$/, 'smallint')
    .replace(/^bool$/, 'boolean')
    .replace(/^float8$/, 'double precision')
    .replace(/^float4$/, 'real');
  return (FABRIC_MIRRORED_TYPES as readonly string[]).includes(normalised);
}
