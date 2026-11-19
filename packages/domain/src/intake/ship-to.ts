import { z } from 'zod';

/**
 * FB-24 (N17-01, D-18): where the intake pre-fills the ship / fill destination from. Ben (WT3a 0:10):
 * "make sure it fills the ship-to address off of the opportunity." Read-only toward Salesforce.
 *
 * The order is the provisional setting `ship_to_sources`; the first source with a city AND a state wins.
 * - `product_spec`: the opportunity's first product specification (item 1), whose Ship_To_City__c,
 *   Ship_To_State__c and Shipping_Country__c were confirmed by a read-only describe on 2026-11-19. It has
 *   no street or postal code.
 * - `account`: the Account's standard shipping address (filled on about 28 % of accounts).
 *
 * The opportunity's free-text Ship_to_Locations__c is never parsed into an address: the intake shows it
 * read-only so the KAM can copy from it. Pure: no I/O.
 */

/** The sources, as `SHIP_TO_SOURCE_VALUES` in the contracts. */
export const SHIP_TO_SOURCES = ['product_spec', 'account'] as const;
export type ShipToSourceKey = (typeof SHIP_TO_SOURCES)[number];

/** `app_setting.ship_to_sources` seed (provisional). */
export const SHIP_TO_SOURCES_SEED: readonly ShipToSourceKey[] = ['product_spec', 'account'];

/** What is used when the setting is missing or unreadable: the Account, as before FB-24. */
export const SHIP_TO_SOURCES_FALLBACK: readonly ShipToSourceKey[] = ['account'];

const isSource = (v: unknown): v is ShipToSourceKey =>
  typeof v === 'string' && (SHIP_TO_SOURCES as readonly string[]).includes(v);

/**
 * The setting as an ordered list: unknown entries dropped, duplicates removed (first kept). Anything
 * that leaves no source (missing, not a list, nothing known) falls back to the Account alone.
 */
export function parseShipToSources(setting: unknown): ShipToSourceKey[] {
  if (!Array.isArray(setting)) return [...SHIP_TO_SOURCES_FALLBACK];
  const out: ShipToSourceKey[] = [];
  for (const v of setting) if (isSource(v) && !out.includes(v)) out.push(v);
  return out.length > 0 ? out : [...SHIP_TO_SOURCES_FALLBACK];
}

/** The admin editor's check: an ordered list of known sources, at least one, none twice. */
export const shipToSourcesSchema = z
  .array(z.enum(SHIP_TO_SOURCES))
  .min(1, 'List at least one source')
  .refine((v) => new Set(v).size === v.length, 'List each source once');

export interface ShipToAddress {
  line1: string | null;
  city: string | null;
  state: string | null;
  postal: string | null;
  country: string | null;
}

/** The product specification's ship-to fields (`SfProductSpec`). */
export interface ProductSpecShipTo {
  shipToCity?: string | null | undefined;
  shipToState?: string | null | undefined;
  shipToCountry?: string | null | undefined;
}

type AddressLike = Partial<Record<keyof ShipToAddress, string | null | undefined>>;

const clean = (v: string | null | undefined): string | null => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t === '' ? null : t;
};

function fromSpec(spec: ProductSpecShipTo | null | undefined): ShipToAddress | null {
  if (!spec) return null;
  return {
    line1: null,
    city: clean(spec.shipToCity),
    state: clean(spec.shipToState),
    postal: null,
    country: clean(spec.shipToCountry),
  };
}

function fromAccount(a: AddressLike | null | undefined): ShipToAddress | null {
  if (!a) return null;
  return {
    line1: clean(a.line1),
    city: clean(a.city),
    state: clean(a.state),
    postal: clean(a.postal),
    country: clean(a.country),
  };
}

/**
 * The ship-to to pre-fill and where it came from: the first source (in `sources` order) whose address
 * has a city and a state. When none has both, a listed Account address with some part filled is still
 * pre-filled, as before FB-24 (the KAM completes it; filling a blank part needs no reason, FB-15). Null
 * otherwise (the KAM types it).
 */
export function pickShipTo(
  sources: readonly ShipToSourceKey[],
  candidates: {
    productSpec?: ProductSpecShipTo | null | undefined;
    account?: AddressLike | null | undefined;
  },
): { address: ShipToAddress; source: ShipToSourceKey } | null {
  for (const source of sources) {
    const address =
      source === 'product_spec'
        ? fromSpec(candidates.productSpec)
        : fromAccount(candidates.account);
    if (address?.city && address.state) return { address, source };
  }
  const partial = sources.includes('account') ? fromAccount(candidates.account) : null;
  if (partial && Object.values(partial).some((v) => v !== null)) {
    return { address: partial, source: 'account' };
  }
  return null;
}
