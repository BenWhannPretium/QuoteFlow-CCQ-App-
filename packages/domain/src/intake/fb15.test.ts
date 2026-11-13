import { describe, expect, it } from 'vitest';

import { isSharedFunding, isValidCustomerShare } from './commercial-inputs';
import { intakeConfigFromSources } from './config-sources';
import {
  customValuePicked,
  evaluateIntake,
  inapplicableIntakeFields,
  shipToChanged,
} from './intake';

/**
 * FB-15 (Nov 13 walkthrough): the intake fixes in the domain. Synthetic values only.
 */

const present = (field: string) => ({ field, op: 'present' });

/** Settings and active lists as `/config/public` (the wizard) and the database (the API) give them. */
const settings = {
  intake_required_fields: [
    present('sf_opportunity_id'),
    present('customer.name'),
    present('ship_to.city'),
    present('ship_to.state'),
    present('product_family'),
    present('resin'),
    present('est_annual_volume'),
    present('quote_needed_by'),
    present('product_needed_by'),
    // FB-15 (W13-02): Market and Sub-market are required (D-006, Bailey Schmitt; provisional).
    present('market'),
    present('sub_market'),
  ],
  intake_volume_placeholder: { values: [1_000_000], roundMultiple: null },
  intake_default_request_class: 'CCQ',
  intake_allowed_request_classes: ['CCQ'],
  intake_redirect_message: 'Stock stays in the pricing application.',
  intake_other_description_max_length: 200,
  intake_min_spec_fields: ['resin'],
};
const entry = (code: string, meta: Record<string, unknown> = {}) => ({ code, meta });
const lists = {
  request_class: [entry('CCQ')],
  product_family: [entry('BOTTLE'), entry('OTHER', { freeText: true })],
  component: [
    entry('CONTAINER'),
    entry('DECORATION', { followUps: ['decoration_type', 'decoration_print_colors'] }),
    entry('OTHER', { freeText: true }),
  ],
  decoration_type: [entry('SILK_SCREEN'), entry('OTHER', { freeText: true })],
  market: [entry('FOOD'), entry('BEVERAGE')],
  sub_market: [
    entry('FOOD_SNACKS', { market: 'FOOD' }),
    entry('BEV_SPIRITS', { market: 'BEVERAGE' }),
  ],
  resin: [entry('HDPE'), entry('PET'), entry('OTHER', { freeText: true })],
  color_type: [
    entry('NATURAL'),
    entry('STOCK_WHITE', { resins: ['HDPE', 'PP'] }),
    entry('CUSTOM', { freeText: true }),
  ],
  additive: [entry('NONE'), entry('FLUORINATION'), entry('OTHER', { freeText: true })],
  drawing_status: [entry('HAVE_DRAWING', { hasDrawing: true })],
  price_basis: [entry('FOB_PLANT'), entry('DELIVERED', { delivered: true })],
  freight_type: [entry('VAN'), entry('OTHER', { freeText: true })],
  tooling_funding_model: [
    entry('NOT_DISCUSSED', { defaultAtIntake: true }),
    entry('SHARED', { customerShare: true }),
  ],
};
const config = intakeConfigFromSources({ settings, lists });

const base = {
  sf_opportunity_id: '006SYN000000000001',
  customer: { status: 'existing', sf_account_id: '001SYN', name: 'Synthetic Co' },
  ship_to: { line1: '1 Test St', city: 'Testville', state: 'MO', postal: null, country: 'US' },
  ship_to_default: {
    line1: '1 Test St',
    city: 'Testville',
    state: 'MO',
    postal: null,
    country: 'US',
  },
  request_class: 'CCQ',
  product_family: 'BOTTLE',
  components: ['CONTAINER'],
  market: 'FOOD',
  sub_market: 'FOOD_SNACKS',
  resin: 'HDPE',
  est_annual_volume: 750_000,
  quote_needed_by: '2026-12-15',
  product_needed_by: '2027-03-01',
  has_drawing_attachment: true,
};
const NOW = new Date('2026-11-13T15:00:00Z');
const blockingFields = (values: Record<string, unknown>) =>
  evaluateIntake(values, config, NOW).blocking.map((b) => `${b.code}:${b.field}`);

describe('intakeConfigFromSources (W13-01: one config for wizard and API)', () => {
  it('carries the active list codes, so a retired code is caught before Submit', () => {
    expect(config.listCodes?.resin).toEqual(['HDPE', 'PET', 'OTHER']);
    expect(blockingFields({ ...base, resin: 'PCR_HDPE' })).toContain('INVALID_VALUE:resin');
  });

  it('keeps a code the reworked quote already holds', () => {
    const issues = evaluateIntake({ ...base, resin: 'PCR_HDPE' }, config, NOW, {
      resin: 'PCR_HDPE',
    }).blocking;
    expect(issues).toEqual([]);
  });

  it('derives the freight Other, shared funding and custom codes from list meta', () => {
    expect(config.freightOtherCodes).toEqual(['OTHER']);
    expect(config.sharedFundingCodes).toEqual(['SHARED']);
    expect(config.customCodes.product_family).toEqual(['OTHER']);
    expect(config.customCodes.component).toEqual(['OTHER']);
    expect(config.otherDescriptionMaxLength).toBe(200);
  });

  it('throws when a required setting is missing (the wizard then says settings are missing)', () => {
    expect(() =>
      intakeConfigFromSources({ settings: { ...settings, intake_redirect_message: '' }, lists }),
    ).toThrow();
  });
});

describe('W13-02: Market and Sub-market are required', () => {
  it('a blank market or sub-market blocks', () => {
    expect(blockingFields({ ...base, market: null, sub_market: null })).toEqual([
      'MISSING_FIELD:market',
      'MISSING_FIELD:sub_market',
    ]);
  });

  it('a sub-market of another market still blocks with its own message', () => {
    expect(blockingFields({ ...base, market: 'BEVERAGE' })).toEqual(['INVALID_VALUE:sub_market']);
  });
});

describe('W13-03: "Other" asks what it is', () => {
  it('product family Other needs its description', () => {
    expect(blockingFields({ ...base, product_family: 'OTHER' })).toEqual([
      'MISSING_FIELD:product_family_other',
    ]);
    expect(
      blockingFields({ ...base, product_family: 'OTHER', product_family_other: 'Squeeze tube' }),
    ).toEqual([]);
  });

  it('component Other among several picks needs its description', () => {
    expect(blockingFields({ ...base, components: ['CONTAINER', 'OTHER'] })).toEqual([
      'MISSING_FIELD:component_other',
    ]);
    expect(customValuePicked({ components: ['CONTAINER'] }, config, 'component')).toBe(false);
  });

  it('decoration Other counts only while Decoration is a picked component', () => {
    const decorated = {
      ...base,
      components: ['CONTAINER', 'DECORATION'],
      decoration_type: 'OTHER',
      decoration_print_colors: 2,
    };
    expect(blockingFields(decorated)).toEqual(['MISSING_FIELD:decoration_type_other']);
    // Decoration unpicked: the stale decoration type asks nothing and its description is cleared.
    const unpicked = { ...base, decoration_type: 'OTHER', decoration_type_other: 'Foil' };
    expect(blockingFields(unpicked)).toEqual([]);
    expect(inapplicableIntakeFields(unpicked, config)).toContain('decoration_type_other');
  });

  it('unpicking Other clears the description', () => {
    const cleared = inapplicableIntakeFields(
      { ...base, product_family: 'BOTTLE', product_family_other: 'Tube' },
      config,
    );
    expect(cleared).toEqual(expect.arrayContaining(['product_family_other', 'component_other']));
  });

  it('a description over the setting is refused', () => {
    expect(
      blockingFields({ ...base, product_family: 'OTHER', product_family_other: 'x'.repeat(201) }),
    ).toEqual(['INVALID_VALUE:product_family_other']);
  });

  it('freight Other requires the special arrangements, only for a delivered price', () => {
    const delivered = { ...base, price_basis: 'DELIVERED', freight_type: 'OTHER' };
    expect(blockingFields(delivered)).toEqual(['MISSING_FIELD:freight_special_arrangements']);
    expect(
      blockingFields({ ...delivered, freight_special_arrangements: 'Customer pickup at dock' }),
    ).toEqual([]);
    expect(blockingFields({ ...delivered, price_basis: 'FOB_PLANT' })).toEqual([]);
  });
});

describe('W13-09: customer share of Shared funding', () => {
  it('accepts 0–100 with at most one decimal and refuses the rest', () => {
    for (const ok of [0, 40, 37.5, 100]) expect(isValidCustomerShare(ok)).toBe(true);
    for (const bad of [-1, 100.1, 33.33, Number.NaN, '40'])
      expect(isValidCustomerShare(bad)).toBe(false);
  });

  it('blocks an out-of-range share while funding is Shared', () => {
    const shared = { ...base, tooling_funding_model: 'SHARED' };
    expect(blockingFields({ ...shared, customer_share_pct: 40 })).toEqual([]);
    expect(blockingFields({ ...shared, customer_share_pct: 120 })).toEqual([
      'INVALID_VALUE:customer_share_pct',
    ]);
    expect(blockingFields({ ...shared, customer_share_pct: null })).toEqual([]);
  });

  it('is cleared for any other funding', () => {
    expect(isSharedFunding('NOT_DISCUSSED', config.sharedFundingCodes)).toBe(false);
    expect(
      inapplicableIntakeFields(
        { ...base, tooling_funding_model: 'NOT_DISCUSSED', customer_share_pct: 40 },
        config,
      ),
    ).toContain('customer_share_pct');
    expect(
      inapplicableIntakeFields({ ...base, tooling_funding_model: 'SHARED' }, config),
    ).not.toContain('customer_share_pct');
  });
});

describe('W13-01 (d): filling a blank part of the Salesforce ship-to', () => {
  const sfDefault = {
    line1: '1 Test St',
    city: 'Testville',
    state: null,
    postal: null,
    country: 'US',
  };

  it('is not a change and needs no reason', () => {
    expect(shipToChanged({ ...sfDefault, state: 'MO' }, sfDefault)).toBe(false);
    expect(
      blockingFields({
        ...base,
        ship_to: { ...sfDefault, state: 'MO' },
        ship_to_default: sfDefault,
      }),
    ).toEqual([]);
  });

  it('changing or clearing a part Salesforce has is still a change', () => {
    expect(shipToChanged({ ...sfDefault, city: 'Elsewhere' }, sfDefault)).toBe(true);
    expect(shipToChanged({ ...sfDefault, city: null }, sfDefault)).toBe(true);
  });

  it('a default without a state blocks until the state is filled', () => {
    expect(blockingFields({ ...base, ship_to: sfDefault, ship_to_default: sfDefault })).toEqual([
      'MISSING_FIELD:ship_to.state',
    ]);
  });
});

describe('W13-01 (f): a rework whose need-by dates have passed', () => {
  it('names both dates', () => {
    expect(
      blockingFields({ ...base, quote_needed_by: '2026-11-01', product_needed_by: '2026-10-01' }),
    ).toEqual(['INVALID_VALUE:quote_needed_by', 'INVALID_VALUE:product_needed_by']);
  });
});
