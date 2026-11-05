import { describe, expect, it } from 'vitest';

import {
  evaluateIntake,
  isActiveQuoteStatus,
  isPlaceholderVolume,
  parseIntakeConfig,
  renderDescriptionTemplate,
  inapplicableIntakeFields,
  shipToChanged,
  todayInCentral,
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
  allowedRequestClasses: ['CCQ'],
  redirectMessage: 'Stock and price checks stay in the pricing application.',
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
  neck_diameter: '28',
  neck_finish_type: '410',
  pcr_level: '0',
  color_type: 'NATURAL',
  packaging_type: 'BULK',
  packaging_notes: 'Max pallet height 96 in',
  est_annual_volume: 750_000,
  est_annual_revenue: 120_000,
  quote_needed_by: '2026-12-15',
  product_needed_by: '2027-03-01',
  container_size: '16 oz',
  standard_description: '16 oz Bottle, HDPE',
  drawing_status: 'HAVE_DRAWING',
};

/** A fixed "now" (US Central: 2026-11-05) so the need-by date checks don't age. */
const NOW = new Date('2026-11-05T15:00:00Z');
const ev = (values: Record<string, unknown>, cfg: IntakeConfig = config, now = NOW) =>
  evaluateIntake(values, cfg, now);

const codes = (issues: { code: string; field: string }[]) =>
  issues.map((i) => `${i.code}:${i.field}`);

describe('evaluateIntake', () => {
  it('a complete intake is ready with no warnings', () => {
    const result = ev(complete, config);
    expect(result).toEqual({ blocking: [], warnings: [], ready: true });
  });

  it('honours the configured required fields (blocking) and nothing else', () => {
    const result = ev({}, config);
    expect(codes(result.blocking)).toEqual([
      'MISSING_FIELD:sf_opportunity_id',
      'MISSING_FIELD:customer.name',
      'MISSING_FIELD:ship_to.line1',
      'MISSING_FIELD:product_family',
      'MISSING_FIELD:resin',
      'MISSING_FIELD:est_annual_volume',
      // F-016: no drawing and no minimum spec.
      'DRAWING_OR_MIN_SPEC_REQUIRED:drawing_or_min_spec',
      // F-067: only CCQ is submitted, so a blank class blocks too (a domain rule, not config).
      'MISSING_FIELD:request_class',
    ]);
    expect(result.ready).toBe(false);
  });

  it('a field that is not in the config never blocks, it warns instead', () => {
    const lenient = { ...config, requiredFields: [present('sf_opportunity_id')] };
    const { resin: _r, product_family: _p, ...rest } = complete;
    const result = ev(rest, lenient);
    expect(result.ready).toBe(true);
    expect(codes(result.warnings)).toEqual(['ENRICH:product_family', 'ENRICH:resin']);
  });

  it('a stricter config makes an enrich field blocking (stop vs enrich is config)', () => {
    const strict = {
      ...config,
      requiredFields: [...config.requiredFields, present('neck_diameter')],
    };
    const result = ev({ ...complete, neck_diameter: '' }, strict);
    expect(codes(result.blocking)).toEqual(['MISSING_FIELD:neck_diameter']);
    expect(codes(result.warnings)).not.toContain('ENRICH:neck_diameter');
  });

  it('missing optional fields are amber "Engineering may ask" warnings, never errors', () => {
    const { neck_diameter: _n, packaging_type: _t, market: _m, ...rest } = complete;
    const result = ev(rest, config);
    expect(result.ready).toBe(true);
    expect(result.warnings.map((w) => [w.code, w.field, w.message])).toEqual([
      ['ENRICH', 'market', 'Engineering may ask about this.'],
      ['ENRICH', 'neck_diameter', 'Engineering may ask about this.'],
      ['ENRICH', 'packaging_type', 'Engineering may ask about this.'],
    ]);
  });

  it('free-text description and comments are never nudged', () => {
    const result = ev({ ...complete, description: '', comments_for_engineering: null }, config);
    expect(result.warnings).toEqual([]);
  });

  describe('placeholder volume', () => {
    it('warns on exactly 1,000,000 until the KAM confirms it', () => {
      const result = ev({ ...complete, est_annual_volume: 1_000_000 }, config);
      expect(result.ready).toBe(true);
      expect(codes(result.warnings)).toEqual(['VOLUME_PLACEHOLDER:est_annual_volume']);
      expect(result.warnings[0]!.message).toMatch(/real annual volume/);

      const confirmed = ev(
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
    expect(codes(ev({ ...complete, est_annual_volume: 0 }, config).blocking)).toEqual([
      'INVALID_VALUE:est_annual_volume',
    ]);
    expect(codes(ev({ ...complete, est_annual_volume: 12.5 }, config).blocking)).toEqual([
      'INVALID_VALUE:est_annual_volume',
    ]);
    expect(codes(ev({ ...complete, est_annual_revenue: -1 }, config).blocking)).toEqual([
      'INVALID_VALUE:est_annual_revenue',
    ]);
    expect(ev({ ...complete, est_annual_revenue: 0 }, config).ready).toBe(true);
  });

  describe('drawing or minimum spec (F-016, D-018)', () => {
    const spec = {
      height_mm: 180,
      width_or_diameter_mm: 65.5,
      depth_mm: 65.5,
      gram_weight_g: 24,
      neck_diameter: '28',
      neck_finish_type: '410',
      resin: 'HDPE',
      color_type: 'NATURAL',
    };
    const noDrawing = { ...complete, has_drawing_attachment: false, drawing_status: 'NONE' };

    it.each([['NONE'], ['COMING'], ['SAMPLE_ONLY'], [null], ['HAVE_DRAWING']])(
      'a drawing status (%s) without a drawing file and without the spec blocks',
      (status) => {
        const result = ev({ ...noDrawing, drawing_status: status });
        expect(result.ready).toBe(false);
        expect(result.blocking).toEqual([
          {
            code: 'DRAWING_OR_MIN_SPEC_REQUIRED',
            field: 'drawing_or_min_spec',
            missing: ['height_mm', 'width_or_diameter_mm', 'depth_mm', 'gram_weight_g'],
            message:
              'Attach a bottle or competitor drawing, or complete the minimum spec. Missing: height, width or diameter, depth, gram weight.',
          },
        ]);
      },
    );

    it('the full minimum spec submits without a drawing (amber: it takes longer)', () => {
      const result = ev({ ...noDrawing, ...spec });
      expect(result.ready).toBe(true);
      expect(codes(result.warnings)).toEqual(['DRAWING_MISSING:drawing_status']);
    });

    it('a drawing file submits without the spec, and nothing is amber', () => {
      const result = ev({ ...complete, has_drawing_attachment: true, drawing_status: 'NONE' });
      expect(result.ready).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it('names exactly what is missing: no drawing and no gram weight', () => {
      const { gram_weight_g: _g, ...rest } = spec;
      const result = ev({ ...noDrawing, ...rest });
      expect(result.blocking).toHaveLength(1);
      expect(result.blocking[0]!.missing).toEqual(['gram_weight_g']);
      expect(result.blocking[0]!.message).toContain('Missing: gram weight.');
    });

    it.each([
      ['height', ['height_mm']],
      ['widthOrDiameter', ['width_or_diameter_mm']],
      ['depth', ['depth_mm']],
      ['gramWeight', ['gram_weight_g']],
      ['neck', ['neck_diameter', 'neck_finish_type']],
      ['resin', ['resin']],
      ['color', ['color_type']],
    ] as const)('key %s needs %j', (key, fields) => {
      const only = { ...config, requiredFields: [], minSpecFields: [key] };
      const without = Object.fromEntries(fields.map((f) => [f, null]));
      const issue = ev({ ...noDrawing, ...spec, ...without }, only).blocking.find(
        (b) => b.code === 'DRAWING_OR_MIN_SPEC_REQUIRED',
      );
      expect(issue?.missing).toEqual([...fields]);
      expect(ev({ ...noDrawing, ...spec }, only).ready).toBe(true);
    });

    it('"neck" means diameter and finish: one of the two is not enough', () => {
      const only = { ...config, minSpecFields: ['neck' as const] };
      expect(
        ev({ ...noDrawing, ...spec, neck_finish_type: null }, only).blocking[0]?.missing,
      ).toEqual(['neck_finish_type']);
    });

    it('the set is config: an empty list never blocks', () => {
      expect(ev(noDrawing, { ...config, minSpecFields: [] }).ready).toBe(true);
      expect(() =>
        parseIntakeConfig({
          requiredFields: [],
          volumePlaceholder: {},
          defaultRequestClass: 'CCQ',
          allowedRequestClasses: ['CCQ'],
          redirectMessage: 'x',
          drawingProvidedCodes: [],
          minSpecFields: ['layerStructure' as never],
        }),
      ).toThrow();
    });

    it('dimensions are numbers above zero', () => {
      for (const bad of [0, -1, '12', 1e9]) {
        expect(codes(ev({ ...complete, height_mm: bad }).blocking)).toEqual([
          'INVALID_VALUE:height_mm',
        ]);
      }
      expect(ev({ ...complete, gram_weight_g: 0.01 }).ready).toBe(true);
    });
  });

  describe('modify an existing mold (F-015)', () => {
    it('needs the mold / part number and what changes', () => {
      expect(codes(ev({ ...complete, modify_existing_mold: true }).blocking)).toEqual([
        'MISSING_FIELD:existing_mold_ref',
        'MISSING_FIELD:mold_change_description',
      ]);
      expect(
        ev({
          ...complete,
          modify_existing_mold: true,
          existing_mold_ref: 'M-1234',
          mold_change_description: 'finish change 28-410 → 28-400',
        }).ready,
      ).toBe(true);
    });

    it('caps the texts (60 and 500) and ignores them when unticked', () => {
      expect(
        codes(
          ev({
            ...complete,
            modify_existing_mold: true,
            existing_mold_ref: 'x'.repeat(61),
            mold_change_description: 'x'.repeat(501),
          }).blocking,
        ),
      ).toEqual(['INVALID_VALUE:existing_mold_ref', 'INVALID_VALUE:mold_change_description']);
      expect(ev({ ...complete, modify_existing_mold: false, existing_mold_ref: null }).ready).toBe(
        true,
      );
      expect(inapplicableIntakeFields({ modify_existing_mold: false }, config)).toEqual(
        expect.arrayContaining(['existing_mold_ref', 'mold_change_description']),
      );
    });
  });

  describe('customer RFP / portal link (F-014)', () => {
    it.each([
      ['https://ariba.example.com/rfp/123', true],
      ['https://portal.example.co.uk', true],
      ['  https://example.com/a?b=c#d  ', true],
      ['http://example.com/rfp', false],
      ['javascript:alert(1)', false],
      ['https://', false],
      ['https://exa mple.com', false],
      ['example.com/rfp', false],
      [`https://example.com/${'x'.repeat(490)}`, false],
    ])('%s → %s', (link, ok) => {
      expect(ev({ ...complete, rfp_link: link }).ready).toBe(ok);
    });
  });

  describe('request class (F-067)', () => {
    it('a class that is not allowed blocks with the configured message', () => {
      const result = ev({ ...complete, request_class: 'STOCK' });
      expect(result.ready).toBe(false);
      expect(result.blocking).toEqual([
        {
          code: 'REQUEST_CLASS_NOT_ALLOWED',
          field: 'request_class',
          message: 'Stock and price checks stay in the pricing application.',
        },
      ]);
    });

    it('the allowed list is config: allow STOCK and it submits', () => {
      const wider = { ...config, allowedRequestClasses: ['CCQ', 'STOCK'] };
      expect(ev({ ...complete, request_class: 'STOCK' }, wider).ready).toBe(true);
    });

    it('a blank class blocks once, even when the config also requires it', () => {
      expect(codes(ev({ ...complete, request_class: null }).blocking)).toEqual([
        'MISSING_FIELD:request_class',
      ]);
      const strict = { ...config, requiredFields: [present('request_class')] };
      expect(codes(ev({ ...complete, request_class: '' }, strict).blocking)).toEqual([
        'MISSING_FIELD:request_class',
      ]);
    });
  });

  describe('ship-to override', () => {
    const moved = { ...address, line1: '99 Dock Rd' };

    it('a changed ship-to needs a reason', () => {
      const result = ev({ ...complete, ship_to: moved }, config);
      expect(codes(result.blocking)).toEqual(['SHIP_TO_REASON_REQUIRED:ship_to_override_reason']);
    });

    it('with a reason it is accepted', () => {
      const result = ev(
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

  it('"not yet a Pretium customer" keeps the SF Account and satisfies the customer rule (F-007)', () => {
    const result = ev(
      {
        ...complete,
        customer: { status: 'not_yet_established', sf_account_id: '001SYN', name: 'New Brand Co' },
      },
      config,
    );
    expect(result.ready).toBe(true);
  });

  it('an opportunity without a Salesforce Account blocks (F-007, D-011)', () => {
    const result = ev({ ...complete, customer: { status: 'existing', name: 'Typed Co' } });
    expect(codes(result.blocking)).toEqual(['SF_ACCOUNT_REQUIRED:customer.sf_account_id']);
    // No opportunity yet: the missing opportunity is the only thing to say.
    const { sf_opportunity_id: _o, ...noOpp } = complete;
    expect(codes(ev({ ...noOpp, customer: null }).blocking)).not.toContain(
      'SF_ACCOUNT_REQUIRED:customer.sf_account_id',
    );
  });

  describe('need-by dates (F-009)', () => {
    it('Quote needed by must be after today (US Central)', () => {
      expect(codes(ev({ ...complete, quote_needed_by: '2026-11-05' }).blocking)).toEqual([
        'INVALID_VALUE:quote_needed_by',
      ]);
      expect(codes(ev({ ...complete, quote_needed_by: '2026-11-01' }).blocking)).toEqual([
        'INVALID_VALUE:quote_needed_by',
      ]);
      expect(ev({ ...complete, quote_needed_by: '2026-11-06' }).ready).toBe(true);
      // 03:00 UTC on the 6th is still the 5th in Central: the 6th is tomorrow there.
      expect(
        ev({ ...complete, quote_needed_by: '2026-11-06' }, config, new Date('2026-11-06T03:00:00Z'))
          .ready,
      ).toBe(true);
      expect(todayInCentral(new Date('2026-11-06T03:00:00Z'))).toBe('2026-11-05');
      // Daylight time (UTC-5) vs standard time (UTC-6).
      expect(todayInCentral(new Date('2026-07-01T04:30:00Z'))).toBe('2026-06-30');
      expect(todayInCentral(new Date('2026-07-01T05:30:00Z'))).toBe('2026-07-01');
      expect(todayInCentral(new Date('2026-12-01T05:30:00Z'))).toBe('2026-11-30');
      expect(todayInCentral(new Date('2026-12-01T06:30:00Z'))).toBe('2026-12-01');
      // The switch days: 2026-03-08 (second Sunday of March) and 2026-11-01 (first Sunday of November).
      expect(todayInCentral(new Date('2026-03-08T07:59:00Z'))).toBe('2026-03-08');
      expect(todayInCentral(new Date('2026-11-01T05:30:00Z'))).toBe('2026-11-01');
      expect(todayInCentral(new Date('2026-11-01T06:30:00Z'))).toBe('2026-11-01');
      expect(todayInCentral(new Date('2026-11-02T05:30:00Z'))).toBe('2026-11-01');
    });

    it('Product needed by must be on or after Quote needed by', () => {
      expect(codes(ev({ ...complete, product_needed_by: '2026-12-14' }).blocking)).toEqual([
        'INVALID_VALUE:product_needed_by',
      ]);
      expect(ev({ ...complete, product_needed_by: '2026-12-15' }).ready).toBe(true);
    });

    it('rejects malformed dates; presence is config', () => {
      expect(codes(ev({ ...complete, quote_needed_by: '12/15/2026' }).blocking)).toEqual([
        'INVALID_VALUE:quote_needed_by',
      ]);
      expect(codes(ev({ ...complete, product_needed_by: 'soon' }).blocking)).toEqual([
        'INVALID_VALUE:product_needed_by',
      ]);
      const required = {
        ...config,
        requiredFields: [present('quote_needed_by'), present('product_needed_by')],
      };
      const { quote_needed_by: _q, product_needed_by: _p, ...rest } = complete;
      expect(codes(ev(rest, required).blocking)).toEqual([
        'MISSING_FIELD:quote_needed_by',
        'MISSING_FIELD:product_needed_by',
      ]);
    });
  });
});

describe('parseIntakeConfig', () => {
  it('applies guard defaults and rejects malformed rules', () => {
    const parsed = parseIntakeConfig({
      requiredFields: [],
      volumePlaceholder: {},
      defaultRequestClass: 'CCQ',
      allowedRequestClasses: ['CCQ'],
      redirectMessage: 'Elsewhere.',
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
        allowedRequestClasses: ['CCQ'],
        redirectMessage: 'Elsewhere.',
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
