/**
 * Salesforce field mapping: the ONLY place SF object and field API names live.
 *
 * Standard fields are fixed by Salesforce. Custom field (`__c`) names were read from the production
 * org with describe() on 2026-10-24 (counts in docs/build-guide/03-build-steps.md, B-06). What a field
 * *means* still needs Zac Cairns / Graham Parle (`TODO(M3)`). When a name changes, change it here and
 * run the live contract test (`SF_LIVE_TEST=1`), which checks every mapped field resolves in the org.
 *
 * Never map a price, cost, margin, revenue or capital field: the org has many (e.g. Gross Margin,
 * Piece Part Price, Capital Estimate) and the integration user can read them. fieldMap.test.ts fails
 * on one; CCQ's field-sensitivity rules (CLAUDE.md rule 2) would have to cover it first.
 *
 * The live reader describes each object once per session and drops any mapped custom field the org
 * doesn't have (logging the field name, never data), so a wrong placeholder degrades to `null`
 * instead of failing every query.
 */

export const OPPORTUNITY_OBJECT = 'Opportunity';
export const ACCOUNT_OBJECT = 'Account';

/** The custom "Opportunity Product Specifications" object (plural; 17,919 records on 2026-10-24). */
export const PRODUCT_SPEC_OBJECT = 'Opportunity_Product_Specifications__c';

/** A mapped field. `custom` fields are optional: missing in the org → mapped as null. */
export interface FieldRef {
  /** SOQL path, e.g. `Owner.Email`. */
  path: string;
  custom?: boolean;
}

const std = (path: string): FieldRef => ({ path });
const custom = (path: string): FieldRef => ({ path, custom: true });

export const OPPORTUNITY_FIELDS = {
  id: std('Id'),
  name: std('Name'),
  accountId: std('AccountId'),
  accountName: std('Account.Name'),
  ownerId: std('OwnerId'),
  ownerName: std('Owner.Name'),
  ownerAlias: std('Owner.Alias'),
  ownerEmail: std('Owner.Email'),
  amount: std('Amount'),
  closeDate: std('CloseDate'),
  stage: std('StageName'),
  isClosed: std('IsClosed'),
  isWon: std('IsWon'),
  systemModstamp: std('SystemModstamp'),
  /**
   * "ERF Number" (its label is the format hint "ERF17-001/SPRxx-xxx/STOCK/CBM/PATRICK"): filled on
   * 47 %, and holds SPR numbers, STOCK and initials too. Capture, don't trust.
   */
  erfNumber: custom('ERF_Number__c'),
  /** Labelled "Quote Source": a picklist (SPR, ERF, Stock Bottle Price List, Price List); 17 % filled. */
  quoteSource: custom('Quote_Type__c'),
} as const satisfies Record<string, FieldRef>;

/**
 * TODO(M3, D-18): ship-to source. The standard Account shipping address, the MVP default, is filled on
 * only 1,714 of 6,199 accounts (28 %). The org also has a free-text Opportunity `Ship_to_Locations__c`
 * (55 % filled) and `Ship_To_City__c` / `Ship_To_State__c` on each product spec. Not mapped yet.
 */
export const ACCOUNT_FIELDS = {
  id: std('Id'),
  name: std('Name'),
  shipToStreet: std('ShippingStreet'),
  shipToCity: std('ShippingCity'),
  shipToState: std('ShippingState'),
  shipToPostal: std('ShippingPostalCode'),
  shipToCountry: std('ShippingCountry'),
} as const satisfies Record<string, FieldRef>;

/**
 * Opportunity Product Specifications fields (names from describe(); TODO(M3): Zac / Graham confirm the
 * meaning, e.g. Resin Type vs Resin Group, and Capacity text vs Capacity (Volume) + (Measure)).
 */
export const PRODUCT_SPEC_FIELDS = {
  id: std('Id'),
  name: std('Name'),
  /** Lookup to the Opportunity. */
  opportunityId: custom('Opportunity__c'),
  productType: custom('Product_Type__c'),
  resin: custom('Resin_Type__c'),
  capacity: custom('Capacity__c'),
  neckFinish: custom('Neck_Finish__c'),
  color: custom('Color__c'),
  annualVolume: custom('Line_Annual_Volume__c'),
} as const satisfies Record<string, FieldRef>;

export type OpportunityField = keyof typeof OPPORTUNITY_FIELDS;
export type AccountField = keyof typeof ACCOUNT_FIELDS;
export type ProductSpecField = keyof typeof PRODUCT_SPEC_FIELDS;

/** Every object the connector reads, with its mapped fields. Used by describe-based resolution. */
export const MAPPED_OBJECTS = {
  [OPPORTUNITY_OBJECT]: OPPORTUNITY_FIELDS,
  [ACCOUNT_OBJECT]: ACCOUNT_FIELDS,
  [PRODUCT_SPEC_OBJECT]: PRODUCT_SPEC_FIELDS,
} as const;

/** Read a dotted SOQL path (`Owner.Email`) from a raw record. Missing parents read as undefined. */
export function readPath(record: unknown, path: string): unknown {
  let value: unknown = record;
  for (const part of path.split('.')) {
    if (value === null || value === undefined || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/**
 * The fields of `map` that resolve in the org. `available` is the set of SOQL paths known to exist
 * (null = not described yet: use the whole map). Standard fields are always kept.
 */
export function resolvedFields<M extends Record<string, FieldRef>>(
  map: M,
  available: ReadonlySet<string> | null,
): { [K in keyof M]: FieldRef | null } {
  const out = {} as { [K in keyof M]: FieldRef | null };
  for (const key of Object.keys(map) as (keyof M)[]) {
    const ref = map[key]!;
    out[key] = !ref.custom || !available || available.has(ref.path) ? ref : null;
  }
  return out;
}

/** The SELECT list for a resolved map (duplicates removed, order kept). */
export function selectList(map: Record<string, FieldRef | null>): string {
  const paths = Object.values(map)
    .filter((ref): ref is FieldRef => ref !== null)
    .map((ref) => ref.path);
  return [...new Set(paths)].join(', ');
}
