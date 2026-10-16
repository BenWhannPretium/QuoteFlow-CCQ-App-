import { describe, expect, it } from 'vitest';

import {
  evaluateIntake,
  isActiveQuoteStatus,
  isPlaceholderVolume,
  parseIntakeConfig,
  renderDescriptionTemplate,
  shipToChanged,
} from './intake';
import type { IntakeConfig } from './intake';

const present = (field: string) => ({ field, op: 'present' as const });

/** The provisional seed (app_setting intake_required_fields etc.). */
const config: IntakeConfig = parseIntakeConfig({
  requiredFields: [
    present('sf_opportunity_id'),
    present('customer.name'),
    present('ship_to.line1'),
    present('product_family'),
    present('resin'),
    present('est_annual_volume'),
  ],
  volumePlaceholder: { values: [1_000_000], roundMultiple: 1_000_000 },
  defaultRequestClass: 'CCQ',
  drawingProvidedCodes: ['HAVE_DRAWING'],
});

const address = {
  line1: '1 Main St',
  city: 'St. Louis',
  state: 'MO',
  postal: '63101',
  country: 'US',
};

const complete = {
  sf_opportunity_id: '006SYN000000000001',
  customer: { status: 'existing', sf_account_id: '001SYN', name: 'Acme (synthetic)' },
  ship_to: address,
  ship_to_default: address,
  request_class: 'CCQ',
  product_family: 'BOTTLE',
  components: ['CONTAINER'],
  market: 'FOOD',
  resin: 'HDPE',
  neck_finish: '28-410',
  packaging_type: 'BULK',
  packaging_notes: 'Max pallet height 96 in',
  est_annual_volume: 750_000,
  est_annual_revenue: 120_000,
  expected_close_date: '2027-03-01',
  container_size: '16 oz',
  standard_description: '16 oz Bottle, HDPE',
  drawing_status: 'HAVE_DRAWING',
};

const codes = (issues: { code: string; field: string }[]) =>
  issues.map((i) => `${i.code}:${i.field}`);

describe('evaluateIntake', () => {
  it('a complete intake is ready with no warnings', () => {
    const result = evaluateIntake(complete, config);
    expect(result).toEqual({ blocking: [], warnings: [], ready: true });
  });

  it('honours the configured required fields (blocking) and nothing else', () => {
    const result = evaluateIntake({}, config);
    expect(codes(result.blocking)).toEqual([
      'MISSING_FIELD:sf_opportunity_id',
      'MISSING_FIELD:customer.name',
      'MISSING_FIELD:ship_to.line1',
      'MISSING_FIELD:product_family',
      'MISSING_FIELD:resin',
      'MISSING_FIELD:est_annual_volume',
    ]);
    expect(result.ready).toBe(false);
  });

  it('a field that is not in the config never blocks, it warns instead', () => {
    const lenient = { ...config, requiredFields: [present('sf_opportunity_id')] };
    const { resin: _r, product_family: _p, ...rest } = complete;
    const result = evaluateIntake(rest, lenient);
    expect(result.ready).toBe(true);
    expect(codes(result.warnings)).toEqual(['ENRICH:product_family', 'ENRICH:resin']);
  });

  it('a stricter config makes an enrich field blocking (stop vs enrich is config)', () => {
    const strict = {
      ...config,
      requiredFields: [...config.requiredFields, present('neck_finish')],
    };
    const result = evaluateIntake({ ...complete, neck_finish: '' }, strict);
    expect(codes(result.blocking)).toEqual(['MISSING_FIELD:neck_finish']);
    expect(codes(result.warnings)).not.toContain('ENRICH:neck_finish');
  });

  it('missing optional fields are amber "Engineering may ask" warnings, never errors', () => {
    const { neck_finish: _n, packaging_type: _t, market: _m, ...rest } = complete;
    const result = evaluateIntake(rest, config);
    expect(result.ready).toBe(true);
    expect(result.warnings.map((w) => [w.code, w.field, w.message])).toEqual([
      ['ENRICH', 'market', 'Engineering may ask about this.'],
      ['ENRICH', 'neck_finish', 'Engineering may ask about this.'],
      ['ENRICH', 'packaging_type', 'Engineering may ask about this.'],
    ]);
  });

  it('free-text description and comments are never nudged', () => {
    const result = evaluateIntake(
      { ...complete, description: '', comments_for_engineering: null },
      config,
    );
    expect(result.warnings).toEqual([]);
  });

  describe('placeholder volume', () => {
    it('warns on exactly 1,000,000 until the KAM confirms it', () => {
      const result = evaluateIntake({ ...complete, est_annual_volume: 1_000_000 }, config);
      expect(result.ready).toBe(true);
      expect(codes(result.warnings)).toEqual(['VOLUME_PLACEHOLDER:est_annual_volume']);
      expect(result.warnings[0]!.message).toMatch(/real annual volume/);

      const confirmed = evaluateIntake(
        { ...complete, est_annual_volume: 1_000_000, est_annual_volume_confirmed: true },
        config,
      );
      expect(confirmed.warnings).toEqual([]);
    });

    it('warns on suspiciously round values', () => {
      expect(isPlaceholderVolume(5_000_000, config.volumePlaceholder)).toBe(true);
      expect(isPlaceholderVolume(1_250_000, config.volumePlaceholder)).toBe(false);
      expect(isPlaceholderVolume(750_000, config.volumePlaceholder)).toBe(false);
    });

    it('ignores non-numbers and zero; the guard can be switched off', () => {
      expect(isPlaceholderVolume(null, config.volumePlaceholder)).toBe(false);
      expect(isPlaceholderVolume('1000000', config.volumePlaceholder)).toBe(false);
      expect(isPlaceholderVolume(0, config.volumePlaceholder)).toBe(false);
      expect(isPlaceholderVolume(Number.NaN, config.volumePlaceholder)).toBe(false);
      const off = { values: [], roundMultiple: null };
      expect(isPlaceholderVolume(1_000_000, off)).toBe(false);
      expect(isPlaceholderVolume(500_000, { values: [500_000], roundMultiple: null })).toBe(true);
    });
  });

  it('rejects a non-positive or fractional volume and negative revenue', () => {
    expect(codes(evaluateIntake({ ...complete, est_annual_volume: 0 }, config).blocking)).toEqual([
      'INVALID_VALUE:est_annual_volume',
    ]);
    expect(
      codes(evaluateIntake({ ...complete, est_annual_volume: 12.5 }, config).blocking),
    ).toEqual(['INVALID_VALUE:est_annual_volume']);
    expect(codes(evaluateIntake({ ...complete, est_annual_revenue: -1 }, config).blocking)).toEqual(
      ['INVALID_VALUE:est_annual_revenue'],
    );
    expect(evaluateIntake({ ...complete, est_annual_revenue: 0 }, config).ready).toBe(true);
  });

  describe('drawing', () => {
    it.each([['NONE'], ['COMING'], ['SAMPLE_ONLY'], [null]])(
      '%s warns but never blocks',
      (status) => {
        const result = evaluateIntake({ ...complete, drawing_status: status }, config);
        expect(result.ready).toBe(true);
        expect(result.warnings).toEqual([
          {
            code: 'DRAWING_MISSING',
            field: 'drawing_status',
            message: 'Quotes without a drawing usually take longer.',
          },
        ]);
      },
    );
  });

  it('a request class other than the default warns about redirection', () => {
    const result = evaluateIntake({ ...complete, request_class: 'STOCK' }, config);
    expect(result.ready).toBe(true);
    expect(codes(result.warnings)).toEqual(['REQUEST_CLASS_REDIRECT:request_class']);
  });

  describe('ship-to override', () => {
    const moved = { ...address, line1: '99 Dock Rd' };

    it('a changed ship-to needs a reason', () => {
      const result = evaluateIntake({ ...complete, ship_to: moved }, config);
      expect(codes(result.blocking)).toEqual(['SHIP_TO_REASON_REQUIRED:ship_to_override_reason']);
    });

    it('with a reason it is accepted', () => {
      const result = evaluateIntake(
        { ...complete, ship_to: moved, ship_to_override_reason: 'Co-packer fills this SKU' },
        config,
      );
      expect(result.ready).toBe(true);
    });

    it('case and spacing differences are not a change; no default means nothing to override', () => {
      expect(shipToChanged({ ...address, city: ' st.  louis ' }, address)).toBe(false);
      expect(shipToChanged({ ...address, postal: null }, { ...address, postal: '' })).toBe(false);
      expect(shipToChanged(moved, null)).toBe(false);
      expect(shipToChanged(null, address)).toBe(true);
      expect(shipToChanged({ ...address, state: 7 }, { ...address, state: '7' })).toBe(false);
    });
  });

  it('a not-yet-established customer satisfies the customer rule with a name', () => {
    const result = evaluateIntake(
      { ...complete, customer: { status: 'not_yet_established', name: 'New Brand Co' } },
      config,
    );
    expect(result.ready).toBe(true);
  });
});

describe('parseIntakeConfig', () => {
  it('applies guard defaults and rejects malformed rules', () => {
    const parsed = parseIntakeConfig({
      requiredFields: [],
      volumePlaceholder: {},
      defaultRequestClass: 'CCQ',
      drawingProvidedCodes: [],
    });
    expect(parsed.volumePlaceholder).toEqual({ values: [], roundMultiple: null });
    expect(() =>
      parseIntakeConfig({
        requiredFields: [
          { field: 'x', op: 'present' },
          { field: 'x', op: 'bogus' },
        ],
        volumePlaceholder: {},
        defaultRequestClass: 'CCQ',
        drawingProvidedCodes: [],
      }),
    ).toThrow();
  });
});

describe('renderDescriptionTemplate', () => {
  const template = '{container_size} {product_family}[, {resin}][ with {components}]';

  it('assembles the suggested standard description', () => {
    expect(
      renderDescriptionTemplate(template, {
        container_size: '16 oz',
        product_family: 'Bottle',
        resin: 'HDPE',
        components: ['Container', 'Closure'],
      }),
    ).toBe('16 oz Bottle, HDPE with Container, Closure');
  });

  it('drops optional segments with an empty field and tidies spacing', () => {
    expect(
      renderDescriptionTemplate(template, {
        container_size: '',
        product_family: 'Jar',
        resin: null,
        components: [],
      }),
    ).toBe('Jar');
    expect(renderDescriptionTemplate(template, {})).toBe('');
    expect(renderDescriptionTemplate('{a} , {b}', { a: 'x', b: 'y' })).toBe('x, y');
  });
});

it('isActiveQuoteStatus: everything but closed blocks a second quote', () => {
  expect(isActiveQuoteStatus('active')).toBe(true);
  expect(isActiveQuoteStatus('on_hold')).toBe(true);
  expect(isActiveQuoteStatus('closed')).toBe(false);
});
