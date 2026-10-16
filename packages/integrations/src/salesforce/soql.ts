import {
  ACCOUNT_FIELDS,
  OPPORTUNITY_FIELDS,
  OPPORTUNITY_OBJECT,
  PRODUCT_SPEC_FIELDS,
  PRODUCT_SPEC_OBJECT,
  ACCOUNT_OBJECT,
  resolvedFields,
  selectList,
  type FieldRef,
} from './fieldMap';

/**
 * SOQL builders. Explicit field lists only (no FIELDS(ALL)). Every user-supplied value goes through
 * `literal` or `likeContains`, never string concatenation.
 */

/** Which custom fields exist per object (null = not described: assume the whole map). */
export type AvailableFields = Partial<Record<string, ReadonlySet<string> | null>>;

const SF_ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

/** Throws unless `id` is a 15/18-character SF id, so ids can be inlined safely. */
export function assertSfId(id: string): string {
  if (!SF_ID.test(id)) throw new Error('Not a Salesforce id');
  return id;
}

const escapeString = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');

/** A quoted SOQL string literal. */
export const literal = (value: string) => `'${escapeString(value)}'`;

/** `'%term%'` with LIKE wildcards in the term escaped. */
export const likeContains = (term: string) =>
  `'%${escapeString(term).replace(/%/g, '\\%').replace(/_/g, '\\_')}%'`;

/** SOQL datetime literal (unquoted, UTC, second precision). */
export const dateTimeLiteral = (at: Date) => at.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Opportunity fields plus the account's name and ship-to through the Account relationship. */
export function opportunitySelect(available: AvailableFields = {}): string {
  const opp = resolvedFields(OPPORTUNITY_FIELDS, available[OPPORTUNITY_OBJECT] ?? null);
  const acct = resolvedFields(ACCOUNT_FIELDS, available[ACCOUNT_OBJECT] ?? null);
  const viaAccount: Record<string, FieldRef | null> = {};
  for (const [key, ref] of Object.entries(acct)) {
    viaAccount[`account_${key}`] = ref ? { path: `Account.${ref.path}` } : null;
  }
  return selectList({ ...opp, ...viaAccount });
}

export interface SearchSoqlParams {
  terms: string[];
  ownerEmail?: string | undefined;
  openOnly: boolean;
  limit: number;
}

/** Every term must match the opportunity name or the account name. */
export function searchSoql(p: SearchSoqlParams, available: AvailableFields = {}): string {
  const where: string[] = p.terms.map(
    (t) => `(Name LIKE ${likeContains(t)} OR Account.Name LIKE ${likeContains(t)})`,
  );
  if (p.ownerEmail) where.push(`Owner.Email = ${literal(p.ownerEmail)}`);
  if (p.openOnly) where.push('IsClosed = false');
  const limit = Math.max(1, Math.min(200, Math.trunc(p.limit)));
  return (
    `SELECT ${opportunitySelect(available)} FROM ${OPPORTUNITY_OBJECT}` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY SystemModstamp DESC LIMIT ${limit}`
  );
}

export const opportunityByIdSoql = (id: string, available: AvailableFields = {}) =>
  `SELECT ${opportunitySelect(available)} FROM ${OPPORTUNITY_OBJECT} WHERE Id = ${literal(assertSfId(id))} LIMIT 1`;

/** Delta query. Ordered by SystemModstamp so a partial run still advances in order. */
export const changedOpportunitiesSoql = (since: Date | null, available: AvailableFields = {}) =>
  `SELECT ${opportunitySelect(available)} FROM ${OPPORTUNITY_OBJECT}` +
  (since ? ` WHERE SystemModstamp > ${dateTimeLiteral(since)}` : '') +
  ' ORDER BY SystemModstamp ASC, Id ASC';

export const accountByIdSoql = (id: string, available: AvailableFields = {}) =>
  `SELECT ${selectList(resolvedFields(ACCOUNT_FIELDS, available[ACCOUNT_OBJECT] ?? null))} FROM ${ACCOUNT_OBJECT} WHERE Id = ${literal(assertSfId(id))} LIMIT 1`;

/** Null when the lookup field to Opportunity isn't in the org (the object can't be filtered). */
export function productSpecsSoql(
  opportunityId: string,
  available: AvailableFields = {},
): string | null {
  const fields = resolvedFields(PRODUCT_SPEC_FIELDS, available[PRODUCT_SPEC_OBJECT] ?? null);
  if (!fields.opportunityId) return null;
  return (
    `SELECT ${selectList(fields)} FROM ${PRODUCT_SPEC_OBJECT}` +
    ` WHERE ${fields.opportunityId.path} = ${literal(assertSfId(opportunityId))}` +
    ' ORDER BY Name ASC LIMIT 200'
  );
}
