/**
 * Salesforce field mapping: the ONLY place SF object and field API names live.
 *
 * Standard fields are fixed by Salesforce. Custom fields (`__c`) are placeholders until Zac Cairns and
 * Graham Parle confirm the crosswalk at M3. Each one carries a `TODO(M3)` marker. When a name is
 * confirmed, change it here, note it in docs/build-guide/03-build-steps.md (B-06), and run the live
 * contract test (`SF_LIVE_TEST=1`), which checks every mapped field resolves in the UAT org.
 *
 * The live reader describes each object once per session and drops any mapped custom field the org
 * doesn't have (logging the field name, never data), so a wrong placeholder degrades to `null`
 * instead of failing every query.
 */

export const OPPORTUNITY_OBJECT = 'Opportunity';
export const ACCOUNT_OBJECT = 'Account';

/**
 * TODO(M3): API name of the custom "Opportunity Product Specification" object (Zac / Graham).
 * Placeholder follows the SF convention for the label.
 */
export const PRODUCT_SPEC_OBJECT = 'Opportunity_Product_Specification__c';

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
  /** TODO(M3): ERF number field on Opportunity ("used inconsistently"; capture, don't trust). */
  erfNumber: custom('ERF_Number__c'),
  /** TODO(M3): quote source field on Opportunity ("used inconsistently"). */
  quoteSource: custom('Quote_Source__c'),
} as const satisfies Record<string, FieldRef>;

/**
 * TODO(M3): ship-to source. Seeded as the standard Account shipping address; confirm whether Pretium
 * keeps ship-to on the Account, on a custom ship-to object, or per opportunity.
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

/** TODO(M3): every field on the Opportunity Product Specification object is a placeholder. */
export const PRODUCT_SPEC_FIELDS = {
  id: std('Id'),
  name: std('Name'),
  /** TODO(M3): lookup from the spec to its Opportunity. */
  opportunityId: custom('Opportunity__c'),
  productType: custom('Product_Type__c'),
  resin: custom('Resin__c'),
  capacity: custom('Capacity__c'),
  neckFinish: custom('Neck_Finish__c'),
  color: custom('Color__c'),
  annualVolume: custom('Annual_Volume__c'),
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
