import type {
  SfAccount,
  SfAddress,
  SfDataQualityFlag,
  SfOpportunity,
  SfProductSpec,
} from '@ccq/contracts';

import {
  ACCOUNT_FIELDS,
  OPPORTUNITY_FIELDS,
  PRODUCT_SPEC_FIELDS,
  readPath,
  type FieldRef,
} from './fieldMap';

/**
 * Pure mapping from raw SOQL records to `@ccq/contracts` DTOs. No I/O, no logging.
 * SF data was backfilled by migration, so every field is treated as possibly missing, blank or junk.
 */

/** Seed for the `sf_amount_suspect_below_usd` setting: amounts under this are flagged (e.g. $0.31). */
export const DEFAULT_SUSPECT_AMOUNT_BELOW = 100;

export interface MapOptions {
  /** Amounts below this (USD) are flagged `amount_suspect`. Defaults to $100. */
  suspectAmountBelow?: number;
}

type Raw = Record<string, unknown>;

const get = (record: Raw, ref: FieldRef) => readPath(record, ref.path);

/** Trimmed string; blank → null. Numbers are stringified (SF text fields sometimes come back numeric). */
export function str(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Finite number from a number or numeric string; anything else → null. */
export function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(/[,$\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const bool = (value: unknown): boolean => value === true || value === 'true';

/** YYYY-MM-DD, or null when the value isn't a date. */
export function dateOnly(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return match && !Number.isNaN(Date.parse(match[1]!)) ? match[1]! : null;
}

/** ISO-8601 UTC timestamp. SF sends `2026-10-15T15:00:00.000+0000`, which Date.parse accepts. */
export function timestamp(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  // Date.parse doesn't accept a +0000 offset without the colon on every runtime; normalise it.
  const ms = Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function isSuspectAmount(
  amount: number | null,
  suspectBelow = DEFAULT_SUSPECT_AMOUNT_BELOW,
): boolean {
  return amount !== null && amount < suspectBelow;
}

export function opportunityQualityFlags(
  o: Pick<SfOpportunity, 'amount' | 'accountId' | 'ownerEmail' | 'ownerAlias' | 'closeDate'>,
  { suspectAmountBelow = DEFAULT_SUSPECT_AMOUNT_BELOW }: MapOptions = {},
): SfDataQualityFlag[] {
  const flags: SfDataQualityFlag[] = [];
  if (o.amount === null) flags.push('amount_missing');
  else if (isSuspectAmount(o.amount, suspectAmountBelow)) flags.push('amount_suspect');
  if (!o.accountId) flags.push('account_missing');
  if (!o.ownerEmail && !o.ownerAlias) flags.push('owner_missing');
  if (!o.closeDate) flags.push('close_date_missing');
  return flags;
}

/** Map one Opportunity record. Returns null when it has no Id (never seen, but SF data is messy). */
export function mapOpportunity(record: Raw, options: MapOptions = {}): SfOpportunity | null {
  const f = OPPORTUNITY_FIELDS;
  const id = str(get(record, f.id));
  if (!id) return null;
  const accountId = str(get(record, f.accountId));
  const base = {
    id,
    name: str(get(record, f.name)) ?? '(unnamed opportunity)',
    accountId,
    // Account.Name can be present without AccountId only in malformed fixtures; trust AccountId.
    accountName: accountId ? str(get(record, f.accountName)) : null,
    ownerId: str(get(record, f.ownerId)),
    ownerName: str(get(record, f.ownerName)),
    ownerAlias: str(get(record, f.ownerAlias)),
    ownerEmail: str(get(record, f.ownerEmail))?.toLowerCase() ?? null,
    amount: num(get(record, f.amount)),
    closeDate: dateOnly(get(record, f.closeDate)),
    stage: str(get(record, f.stage)),
    isClosed: bool(get(record, f.isClosed)),
    isWon: bool(get(record, f.isWon)),
    erfNumber: str(get(record, f.erfNumber)),
    quoteSource: str(get(record, f.quoteSource)),
    systemModstamp: timestamp(get(record, f.systemModstamp)),
  };
  return { ...base, dataQuality: opportunityQualityFlags(base, options) };
}

/** Structured address, or null when every part is blank. The first street line is kept. */
export function mapAddress(parts: {
  street: unknown;
  city: unknown;
  state: unknown;
  postal: unknown;
  country: unknown;
}): SfAddress | null {
  const address: SfAddress = {
    line1: str(parts.street)?.split(/\r?\n/)[0]?.trim() || null,
    city: str(parts.city),
    state: str(parts.state),
    postal: str(parts.postal),
    country: str(parts.country),
  };
  return Object.values(address).some((v) => v !== null) ? address : null;
}

export function mapAccount(record: Raw): SfAccount | null {
  const f = ACCOUNT_FIELDS;
  const id = str(get(record, f.id));
  if (!id) return null;
  return {
    id,
    name: str(get(record, f.name)) ?? '(unnamed account)',
    shipTo: mapAddress({
      street: get(record, f.shipToStreet),
      city: get(record, f.shipToCity),
      state: get(record, f.shipToState),
      postal: get(record, f.shipToPostal),
      country: get(record, f.shipToCountry),
    }),
  };
}

export function mapProductSpec(record: Raw): SfProductSpec | null {
  const f = PRODUCT_SPEC_FIELDS;
  const id = str(get(record, f.id));
  const opportunityId = str(get(record, f.opportunityId));
  if (!id || !opportunityId) return null;
  return {
    id,
    opportunityId,
    name: str(get(record, f.name)),
    productType: str(get(record, f.productType)),
    resin: str(get(record, f.resin)),
    capacity: str(get(record, f.capacity)),
    neckFinish: str(get(record, f.neckFinish)),
    color: str(get(record, f.color)),
    annualVolume: num(get(record, f.annualVolume)),
  };
}

/** Map a list, dropping records that can't be mapped. Returns how many were dropped. */
export function mapAll<T>(
  records: readonly Raw[],
  map: (r: Raw) => T | null,
): { items: T[]; dropped: number } {
  const items: T[] = [];
  for (const r of records) {
    const item = map(r);
    if (item) items.push(item);
  }
  return { items, dropped: records.length - items.length };
}

/** The raw record without SF's `attributes` envelopes, for the snapshot `raw` column. */
export function stripAttributes(record: Raw): Raw {
  const out: Raw = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'attributes') continue;
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? stripAttributes(value as Raw)
        : value;
  }
  return out;
}

/**
 * An Opportunity record with its account taken from the `Account` relationship (the opportunity
 * SOQL selects the account's name and ship-to through it). Null when the record has no Id.
 */
export function mapOpportunityRecord(
  record: Raw,
  options: MapOptions = {},
): { opportunity: SfOpportunity; account: SfAccount | null; raw: Raw } | null {
  const opportunity = mapOpportunity(record, options);
  if (!opportunity) return null;
  const nested = record.Account;
  const account =
    opportunity.accountId && nested && typeof nested === 'object'
      ? mapAccount({ ...(nested as Raw), Id: opportunity.accountId })
      : null;
  return { opportunity, account, raw: stripAttributes(record) };
}
