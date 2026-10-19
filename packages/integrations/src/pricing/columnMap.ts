/**
 * Pricing-app column map: the ONLY place the legacy pricing app's view and column names live (B-15).
 *
 * Status of each name:
 * - `evidence`: the column name appears in Cory McGahan's back-end export (2026-09-22: ERF 8,536 × 99,
 *   BPR 26,561 × 62, SPR 12,190 × 91) as quoted in the evidence base. The exact spelling in the views
 *   Cory exposes still needs his confirmation.
 * - `placeholder`: a guess. **TODO(M5)**: confirm with Cory McGahan (schema) and Gemma Cebolla (scope).
 * - `confirmed`: confirmed at M5. Change the status here when it is, and record it in
 *   docs/build-guide/03-build-steps.md (B-15).
 *
 * The DTOs map **only** these columns: nothing else is selected. The SQL readers check the views'
 * columns once per connection (INFORMATION_SCHEMA) and drop an optional column the view doesn't have
 * (logging the column name, never data), so a wrong placeholder degrades to `null` ("unknown") instead
 * of failing every query. Key columns are required: if one is missing, every call fails with
 * COLUMN_MISSING and the UI falls back to manual references. Run the live contract test
 * (`PRICING_LIVE_TEST=1`) after any change here.
 */

export type ColumnStatus = 'evidence' | 'placeholder' | 'confirmed';

export interface ColumnRef {
  /** Column name in the view, as SQL Server spells it (bracket-quoted in queries). */
  column: string;
  status: ColumnStatus;
  /** Key columns must exist; the rest may be missing (mapped as null). */
  required?: boolean;
}

const evidence = (column: string): ColumnRef => ({ column, status: 'evidence' });
const placeholder = (column: string): ColumnRef => ({ column, status: 'placeholder' });
const key = (ref: ColumnRef): ColumnRef => ({ ...ref, required: true });

export type PricingObject = 'erf' | 'bpr' | 'spr';

/**
 * The views (or tables) read per route. TODO(M5): Route A = views Cory exposes on a replica of the
 * pricing app DB (names are placeholders in a `ccq` schema); Route B = the tables D&A lands in Fabric
 * (Brennan Paul; placeholder names in `dbo`). A read-only login sees only these.
 */
export const PRICING_OBJECTS: Record<'sqlserver' | 'fabric', Record<PricingObject, string>> = {
  sqlserver: { erf: 'ccq.v_ERF', bpr: 'ccq.v_BPR', spr: 'ccq.v_SPR' },
  fabric: { erf: 'dbo.pricing_erf', bpr: 'dbo.pricing_bpr', spr: 'dbo.pricing_spr' },
};

export const ERF_COLUMNS = {
  erfNumber: key(placeholder('ERF_Number')),
  customerName: placeholder('Customer_Name'),
  /** TODO(M5): does the pricing app carry the SF opportunity id at all? */
  sfOpportunityId: placeholder('SF_Opportunity_ID'),
  title: placeholder('Description'),
  submittedOn: placeholder('Date_Submitted'),
  priority: evidence('Priority'),
  productClass: evidence('Product_Class'),
  channel: evidence('Channel'),
  plant: evidence('Plant'),
  machine: evidence('Machine'),
  /** Blank from ~FY25/26 on (cause unknown): blank = unknown, never zero. */
  estRevenue: evidence('Est_Revenue'),
  estVolume: evidence('Est_Volume'),
  estNetCapital: evidence('Est_Net_Capital'),
  decisionType: evidence('Decision_Type'),
  decisionBy: evidence('Decision_By'),
  decisionDate: evidence('Decision_Date'),
  decisionReason: evidence('Decision_Reason'),
  /** TODO(M5): the evidence names "accepted/rejected/abandoned flags"; exact column names unknown. */
  acceptedFlag: placeholder('Accepted'),
  rejectedFlag: placeholder('Rejected'),
  abandonedFlag: placeholder('Abandoned'),
  attachmentCount: evidence('Attachment_Count'),
  daysToEngineerAssigned: evidence('Days_Submitted_To_Engineer_Assigned'),
  daysToEceApproved: evidence('Days_Submitted_To_ECE_Approved'),
  daysToPriceConfirmed: evidence('Days_Submitted_To_Price_Confirmed'),
} as const satisfies Record<string, ColumnRef>;

/** TODO(M5): every BPR column is a placeholder (BPR export: 62 columns, back to FY2012). */
export const BPR_COLUMNS = {
  bprNumber: key(placeholder('BPR_Number')),
  /**
   * TODO(M5): how a BPR points at its ERF. A column on the BPR is assumed; if the link is a separate
   * table (ERF↔BPR is not strictly 1:1, Cory is validating), only this file and the query change.
   */
  erfNumber: key(placeholder('ERF_Number')),
  customerName: placeholder('Customer_Name'),
  itemDescription: placeholder('Item_Description'),
  status: placeholder('Status'),
  requestedBy: placeholder('Requested_By'),
  requestedOn: placeholder('Date_Requested'),
  effectiveOn: placeholder('Effective_Date'),
} as const satisfies Record<string, ColumnRef>;

/** TODO(M5): every SPR column is a placeholder. SPR is history only (retired Nov 2025). */
export const SPR_COLUMNS = {
  sprNumber: key(placeholder('SPR_Number')),
  customerName: placeholder('Customer_Name'),
  itemDescription: placeholder('Item_Description'),
  status: placeholder('Status'),
  requestedOn: placeholder('Date_Requested'),
  decidedOn: placeholder('Decision_Date'),
} as const satisfies Record<string, ColumnRef>;

export type ErfColumn = keyof typeof ERF_COLUMNS;
export type BprColumn = keyof typeof BPR_COLUMNS;
export type SprColumn = keyof typeof SPR_COLUMNS;

export const PRICING_COLUMNS = {
  erf: ERF_COLUMNS,
  bpr: BPR_COLUMNS,
  spr: SPR_COLUMNS,
} as const satisfies Record<PricingObject, Record<string, ColumnRef>>;

/**
 * Identifiers can't be query parameters, so every view and column name is checked against these
 * before it reaches SQL (and again by a unit test): letters, digits, underscores and inner spaces,
 * no brackets, quotes or semicolons.
 */
export const COLUMN_NAME = /^[A-Za-z_][A-Za-z0-9_ ]{0,127}$/;
export const OBJECT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}\.[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** `[Column Name]`. Throws on a name that isn't a plain identifier. */
export function quoteColumn(column: string): string {
  if (!COLUMN_NAME.test(column) || column.endsWith(' ')) {
    throw new Error(`Invalid pricing-app column name in columnMap.ts: ${JSON.stringify(column)}`);
  }
  return `[${column}]`;
}

/** `[schema].[view]`. Throws on a name that isn't `schema.name`. */
export function quoteObject(name: string): string {
  if (!OBJECT_NAME.test(name)) {
    throw new Error(`Invalid pricing-app view name in columnMap.ts: ${JSON.stringify(name)}`);
  }
  const [schema, object] = name.split('.');
  return `[${schema}].[${object}]`;
}

/**
 * The columns of `map` that exist in the view. `available` holds the view's column names (null = not
 * checked yet: use the whole map). Returns the resolved map and the required columns that are missing.
 */
export function resolveColumns<M extends Record<string, ColumnRef>>(
  map: M,
  available: ReadonlySet<string> | null,
): {
  resolved: { [K in keyof M]: ColumnRef | null };
  missingRequired: string[];
  dropped: string[];
} {
  const resolved = {} as { [K in keyof M]: ColumnRef | null };
  const missingRequired: string[] = [];
  const dropped: string[] = [];
  const has = (c: string) =>
    !available ||
    available.has(c) ||
    [...available].some((a) => a.toLowerCase() === c.toLowerCase());
  for (const k of Object.keys(map) as (keyof M)[]) {
    const ref = map[k]!;
    if (has(ref.column)) {
      resolved[k] = ref;
    } else {
      resolved[k] = null;
      if (ref.required) missingRequired.push(ref.column);
      else dropped.push(ref.column);
    }
  }
  return { resolved, missingRequired, dropped };
}
