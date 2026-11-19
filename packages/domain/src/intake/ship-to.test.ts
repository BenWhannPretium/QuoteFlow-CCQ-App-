import { describe, expect, it } from 'vitest';

import {
  parseShipToSources,
  pickShipTo,
  SHIP_TO_SOURCES_SEED,
  shipToSourcesSchema,
} from './ship-to';

/** FB-24 (N17-01): the ship-to pre-fill source order. Synthetic places only. */
const spec = { shipToCity: 'Springfield', shipToState: 'Illinois', shipToCountry: 'United States' };
const account = {
  line1: '1 Test Way',
  city: 'Toledo',
  state: 'OH',
  postal: '43601',
  country: 'US',
};

describe('parseShipToSources', () => {
  it('keeps the known sources in order, once each', () => {
    expect(parseShipToSources(['product_spec', 'account'])).toEqual(['product_spec', 'account']);
    expect(parseShipToSources(['account', 'product_spec', 'account'])).toEqual([
      'account',
      'product_spec',
    ]);
    expect(parseShipToSources(['opportunity', 'account'])).toEqual(['account']);
  });

  it('falls back to the Account when the setting is missing or unreadable', () => {
    for (const v of [undefined, null, 'account', {}, [], ['nope'], [1]]) {
      expect(parseShipToSources(v)).toEqual(['account']);
    }
  });

  it('the seed is valid for the admin editor; empty or repeated lists are not', () => {
    expect(shipToSourcesSchema.safeParse(SHIP_TO_SOURCES_SEED).success).toBe(true);
    expect(shipToSourcesSchema.safeParse([]).success).toBe(false);
    expect(shipToSourcesSchema.safeParse(['account', 'account']).success).toBe(false);
    expect(shipToSourcesSchema.safeParse(['opportunity']).success).toBe(false);
  });
});

describe('pickShipTo', () => {
  it('the product specification wins when listed first; it gives city, state and country only', () => {
    expect(pickShipTo(['product_spec', 'account'], { productSpec: spec, account })).toEqual({
      source: 'product_spec',
      address: {
        line1: null,
        city: 'Springfield',
        state: 'Illinois',
        postal: null,
        country: 'United States',
      },
    });
  });

  it('the order is the setting: account first wins when listed first', () => {
    expect(pickShipTo(['account', 'product_spec'], { productSpec: spec, account })).toEqual({
      source: 'account',
      address: account,
    });
  });

  it('a source needs both a city and a state; blanks fall through to the next', () => {
    const noState = { ...spec, shipToState: '  ' };
    expect(pickShipTo(['product_spec', 'account'], { productSpec: noState, account })?.source).toBe(
      'account',
    );
    expect(pickShipTo(['product_spec', 'account'], { productSpec: null, account })?.source).toBe(
      'account',
    );
  });

  it('a source not listed is never used', () => {
    expect(pickShipTo(['account'], { productSpec: spec, account: null })).toBeNull();
    expect(pickShipTo(['product_spec'], { productSpec: null, account })).toBeNull();
  });

  it('with no complete source, a partial Account address is still pre-filled (as before FB-24)', () => {
    const partial = { city: 'Toledo', state: null };
    expect(
      pickShipTo(['product_spec', 'account'], { productSpec: null, account: partial }),
    ).toEqual({
      source: 'account',
      address: { line1: null, city: 'Toledo', state: null, postal: null, country: null },
    });
    expect(pickShipTo(['product_spec', 'account'], {})).toBeNull();
    expect(
      pickShipTo(['product_spec', 'account'], { account: { city: ' ', state: '' } }),
    ).toBeNull();
  });

  it('trims what it copies', () => {
    expect(
      pickShipTo(['product_spec'], {
        productSpec: { shipToCity: ' Reno ', shipToState: 'Nevada ', shipToCountry: '' },
      })?.address,
    ).toEqual({ line1: null, city: 'Reno', state: 'Nevada', postal: null, country: null });
  });
});
