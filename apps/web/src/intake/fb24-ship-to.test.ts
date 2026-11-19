import type { PublicConfigResponse, SfOpportunityDetail } from '@ccq/contracts';
import { describe, expect, it } from 'vitest';

import { prefillFromOpportunity, wizardConfig } from './model';

/**
 * FB-24 (N17-01): "make sure it fills the ship-to address off of the opportunity" (Ben, WT3a 0:10). The
 * intake pre-fills the ship-to from the first source in `ship_to_sources` with a city and a state, records
 * where it came from, and keeps the opportunity's free-text "Ship to Locations" to show (never parsed).
 * Synthetic values only.
 */

const config = (shipToSources?: unknown): PublicConfigResponse => ({
  stages: [],
  gates: [],
  outcomes: [],
  reasonCodes: [],
  tiers: [],
  valueLists: { request_class: [{ code: 'CCQ', label: 'CCQ', sort: 10, meta: {} }] },
  settings: {
    intake_required_fields: [],
    intake_volume_placeholder: { values: [], roundMultiple: null },
    intake_default_request_class: 'CCQ',
    intake_allowed_request_classes: ['CCQ'],
    intake_redirect_message: 'Elsewhere.',
    ...(shipToSources === undefined ? {} : { ship_to_sources: shipToSources }),
  },
});

const account = {
  line1: '1 Test St',
  city: 'Testville',
  state: 'MO',
  postal: '64000',
  country: 'US',
};
const spec = (ship: { city?: string | null; state?: string | null } = {}) => ({
  id: 'a0PSYN000000000001',
  opportunityId: '006SYN000000000001',
  name: 'PS-000001',
  productType: null,
  resin: null,
  capacity: null,
  neckFinish: null,
  color: null,
  annualVolume: null,
  shipToCity: ship.city === undefined ? 'Springfield' : ship.city,
  shipToState: ship.state === undefined ? 'Illinois' : ship.state,
  shipToCountry: 'United States of America',
});

const detail = (opts: {
  specs?: ReturnType<typeof spec>[];
  accountShipTo?: typeof account | null;
  shipToLocations?: string | null;
}) =>
  ({
    opportunity: {
      id: '006SYN000000000001',
      name: 'Synthetic opportunity',
      accountId: '001SYN',
      accountName: 'Synthetic Co',
      ownerId: null,
      ownerName: null,
      ownerAlias: null,
      ownerEmail: null,
      amount: 100_000,
      closeDate: null,
      stage: null,
      isClosed: false,
      isWon: false,
      erfNumber: null,
      quoteSource: null,
      shipToLocations: opts.shipToLocations ?? null,
      systemModstamp: null,
      dataQuality: [],
    },
    account: {
      id: '001SYN',
      name: 'Synthetic Co',
      shipTo: opts.accountShipTo === undefined ? account : opts.accountShipTo,
    },
    productSpecs: opts.specs ?? [],
    productSpecsStatus: (opts.specs ?? []).length > 0 ? 'found' : 'none',
    ccqStageHint: null,
    snapshotSyncedAt: null,
    liveRefreshedAt: null,
    liveError: null,
    deletedInSf: false,
  }) as unknown as SfOpportunityDetail;

describe('FB-24 (N17-01): the ship-to comes from the opportunity', () => {
  const cfg = wizardConfig(config(['product_spec', 'account']))!;

  it("the opportunity's product wins over the account, and the source is recorded", () => {
    const out = prefillFromOpportunity(detail({ specs: [spec()] }), cfg);
    const expected = {
      line1: null,
      city: 'Springfield',
      state: 'Illinois',
      postal: null,
      country: 'United States of America',
    };
    expect(out.shipTo).toEqual(expected);
    // The default is what was pre-filled: changing it needs a reason, as before.
    expect(out.shipToDefault).toEqual(expected);
    expect(out.shipToSource).toBe('product_spec');
  });

  it('a product with no state falls back to the account', () => {
    const out = prefillFromOpportunity(detail({ specs: [spec({ state: null })] }), cfg);
    expect(out.shipTo).toEqual(account);
    expect(out.shipToSource).toBe('account');
  });

  it('nothing to pre-fill: no ship-to and no source (the KAM types it)', () => {
    const out = prefillFromOpportunity(detail({ accountShipTo: null }), cfg);
    expect(out.shipTo).toBeNull();
    expect(out.shipToDefault).toBeNull();
    expect(out.shipToSource).toBeNull();
  });

  it('the free-text "Ship to Locations" is kept as typed (trimmed), never parsed into the address', () => {
    const out = prefillFromOpportunity(
      detail({ specs: [], accountShipTo: null, shipToLocations: '  Dallas, TX\nReno, NV ' }),
      cfg,
    );
    expect(out.sfShipToLocations).toBe('Dallas, TX\nReno, NV');
    expect(out.shipTo).toBeNull();
    expect(prefillFromOpportunity(detail({ shipToLocations: '   ' }), cfg).sfShipToLocations).toBe(
      null,
    );
  });

  it('the setting decides the order; without it the account is used, as before FB-24', () => {
    const accountFirst = wizardConfig(config(['account', 'product_spec']))!;
    expect(accountFirst.shipToSources).toEqual(['account', 'product_spec']);
    expect(prefillFromOpportunity(detail({ specs: [spec()] }), accountFirst).shipToSource).toBe(
      'account',
    );
    const unset = wizardConfig(config())!;
    expect(unset.shipToSources).toEqual(['account']);
    const out = prefillFromOpportunity(detail({ specs: [spec()] }), unset);
    expect(out.shipTo).toEqual(account);
    expect(out.shipToSource).toBe('account');
  });
});
