import { describe, expect, it } from 'vitest';

import { isValidStockHoldWeeks } from './commercial-inputs';
import { intakeConfigFromSources } from './config-sources';
import {
  conceptIssues,
  evaluateIntake,
  inapplicableIntakeFields,
  isConceptRequest,
  RENDER_OR_DRAWING_MESSAGE,
} from './intake';
import { isItemField, ITEM_LABEL_MAX_LENGTH } from './items';

/**
 * FB-24 (Nov 17 and 18 feedback): concept / innovation requests (N17-03), several decoration types
 * (N17-02), the item name (N17-05), the tooling commitment (N18-02) and the stocking agreement (D4) in the
 * domain. Synthetic values only.
 */

const present = (field: string) => ({ field, op: 'present' });

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
  ],
  intake_volume_placeholder: { values: [], roundMultiple: null },
  intake_default_request_class: 'CCQ',
  intake_allowed_request_classes: ['CCQ', 'CONCEPT'],
  intake_redirect_message: 'Stock stays in the pricing application.',
  intake_min_spec_fields: [
    'height',
    'widthOrDiameter',
    'depth',
    'gramWeight',
    'neck',
    'resin',
    'color',
  ],
  intake_min_spec_exempt_classes: ['CONCEPT'],
};
const entry = (code: string, meta: Record<string, unknown> = {}) => ({ code, meta });
const lists = {
  request_class: [entry('CCQ'), entry('CONCEPT'), entry('STOCK')],
  product_family: [entry('BOTTLE')],
  component: [
    entry('CONTAINER'),
    entry('DECORATION', { followUps: ['decoration_types', 'decoration_print_colors'] }),
  ],
  decoration_type: [
    entry('SILK_SCREEN'),
    entry('HOT_STAMP'),
    entry('SHRINK_SLEEVE'),
    entry('OTHER', { freeText: true }),
  ],
  resin: [entry('HDPE')],
  packaging_type: [entry('BULK'), entry('SOLDIER_PACK'), entry('OTHER', { freeText: true })],
};
const config = intakeConfigFromSources({ settings, lists });

const base = {
  sf_opportunity_id: '006SYN000000000024',
  customer: { status: 'existing', sf_account_id: '001SYN', name: 'Synthetic Co' },
  ship_to: { line1: null, city: 'Testville', state: 'MO', postal: null, country: 'US' },
  ship_to_default: null,
  request_class: 'CCQ',
  product_family: 'BOTTLE',
  components: ['CONTAINER'],
  resin: 'HDPE',
  est_annual_volume: 750_000,
  quote_needed_by: '2026-12-15',
  product_needed_by: '2027-03-01',
};
const concept = {
  ...base,
  request_class: 'CONCEPT',
  concept_assumptions: '16 oz round, about 30 g, HDPE natural, one-colour silk screen.',
};
const NOW = new Date('2026-11-19T15:00:00Z');
const blocking = (values: Record<string, unknown>) =>
  evaluateIntake(values, config, NOW).blocking.map((b) => `${b.code}:${b.field}`);

describe('N17-03: concept / innovation requests', () => {
  it('reads the exempt classes from intake_min_spec_exempt_classes', () => {
    expect(config.minSpecExemptClasses).toEqual(['CONCEPT']);
    expect(isConceptRequest(concept, config)).toBe(true);
    expect(isConceptRequest(base, config)).toBe(false);
    // Missing setting: no class is exempt (a standard request keeps today's rule).
    const none = intakeConfigFromSources({
      settings: { ...settings, intake_min_spec_exempt_classes: undefined },
      lists,
    });
    expect(isConceptRequest(concept, none)).toBe(false);
  });

  it('a standard request without a drawing still needs the minimum spec', () => {
    expect(blocking({ ...base, has_drawing_attachment: false })).toContain(
      'DRAWING_OR_MIN_SPEC_REQUIRED:drawing_or_min_spec',
    );
  });

  it('a concept is not held to the minimum spec, but needs a render, photo or drawing', () => {
    const issues = evaluateIntake(
      { ...concept, has_drawing_attachment: false, has_render_attachment: false },
      config,
      NOW,
    ).blocking;
    expect(issues.map((i) => i.code)).not.toContain('DRAWING_OR_MIN_SPEC_REQUIRED');
    expect(issues).toEqual([
      {
        code: 'RENDER_OR_DRAWING_REQUIRED',
        field: 'drawing_or_render',
        message: "Add the customer's render or photo, or a drawing",
      },
    ]);
    expect(RENDER_OR_DRAWING_MESSAGE).toBe("Add the customer's render or photo, or a drawing");
  });

  it('a render / photo or a drawing satisfies a concept', () => {
    expect(
      blocking({ ...concept, has_drawing_attachment: false, has_render_attachment: true }),
    ).toEqual([]);
    expect(
      blocking({ ...concept, has_drawing_attachment: true, has_render_attachment: false }),
    ).toEqual([]);
  });

  it('where the files are not known (a stored quote) the file rule is not judged', () => {
    expect(conceptIssues(concept, config)).toEqual([]);
  });

  it('a concept needs its assumptions, kept to 1,000 characters', () => {
    const { concept_assumptions: _gone, ...noAssumptions } = concept;
    expect(blocking({ ...noAssumptions, has_render_attachment: true })).toEqual([
      'MISSING_FIELD:concept_assumptions',
    ]);
    expect(
      blocking({ ...concept, concept_assumptions: 'x'.repeat(1001), has_render_attachment: true }),
    ).toEqual(['INVALID_VALUE:concept_assumptions']);
    expect(
      blocking({ ...concept, concept_assumptions: 'x'.repeat(1000), has_render_attachment: true }),
    ).toEqual([]);
  });

  it('a concept can be submitted (CONCEPT is an allowed class); a stock request still cannot', () => {
    expect(blocking({ ...concept, has_render_attachment: true })).not.toContain(
      'REQUEST_CLASS_NOT_ALLOWED:request_class',
    );
    expect(blocking({ ...base, request_class: 'STOCK', has_drawing_attachment: true })).toContain(
      'REQUEST_CLASS_NOT_ALLOWED:request_class',
    );
  });

  it('the assumptions are cleared for any other class', () => {
    expect(inapplicableIntakeFields({ ...base, concept_assumptions: 'x' }, config)).toContain(
      'concept_assumptions',
    );
    expect(inapplicableIntakeFields(concept, config)).not.toContain('concept_assumptions');
  });

  it('on a multi-item concept the file rule belongs to the item without a drawing', () => {
    const { has_drawing_attachment: _d, ...request } = {
      ...concept,
      has_drawing_attachment: false,
    };
    const item = (label: string, drawing: boolean) => ({
      label,
      product_family: 'BOTTLE',
      components: ['CONTAINER'],
      resin: 'HDPE',
      est_annual_volume: 100_000,
      product_needed_by: '2027-03-01',
      has_drawing_attachment: drawing,
    });
    const issues = evaluateIntake(
      { ...request, has_render_attachment: false, items: [item('A', true), item('B', false)] },
      config,
      NOW,
    ).blocking;
    expect(issues).toEqual([
      expect.objectContaining({ code: 'RENDER_OR_DRAWING_REQUIRED', item: 2 }),
    ]);
    expect(isItemField('drawing_or_render')).toBe(true);
  });
});

describe('N17-02: several decoration types at once', () => {
  const decorated = {
    ...base,
    has_drawing_attachment: true,
    components: ['CONTAINER', 'DECORATION'],
    decoration_print_colors: 2,
  };

  it('Decoration asks for at least one type', () => {
    expect(blocking({ ...decorated, decoration_types: [] })).toEqual([
      'MISSING_FIELD:decoration_types',
    ]);
    expect(blocking({ ...decorated, decoration_types: ['SILK_SCREEN', 'SHRINK_SLEEVE'] })).toEqual(
      [],
    );
  });

  it('every type must be on the list; Other among several asks what it is', () => {
    expect(blocking({ ...decorated, decoration_types: ['SILK_SCREEN', 'EMBOSS'] })).toEqual([
      'INVALID_VALUE:decoration_types',
    ]);
    expect(blocking({ ...decorated, decoration_types: ['HOT_STAMP', 'OTHER'] })).toEqual([
      'MISSING_FIELD:decoration_type_other',
    ]);
    expect(
      blocking({
        ...decorated,
        decoration_types: ['HOT_STAMP', 'OTHER'],
        decoration_type_other: 'Embossed logo',
      }),
    ).toEqual([]);
  });

  it('Decoration unpicked: the types and the description are cleared', () => {
    const cleared = inapplicableIntakeFields(
      { ...base, decoration_types: ['OTHER'], decoration_type_other: 'Foil' },
      config,
    );
    expect(cleared).toEqual(expect.arrayContaining(['decoration_types', 'decoration_type_other']));
  });

  it('reads a component follow-up named as before FB-24 under its new name', () => {
    const legacy = intakeConfigFromSources({
      settings,
      lists: {
        ...lists,
        component: [entry('DECORATION', { followUps: ['decoration_type'] })],
      },
    });
    expect(legacy.componentFollowUps.DECORATION).toEqual(['decoration_types']);
  });
});

describe('N17-04 and N17-05', () => {
  it('Soldier pack is a packaging type like any other', () => {
    expect(
      blocking({ ...base, has_drawing_attachment: true, packaging_type: 'SOLDIER_PACK' }),
    ).toEqual([]);
  });

  it('an item name may be 120 characters', () => {
    expect(ITEM_LABEL_MAX_LENGTH).toBe(120);
  });
});

describe('N18-02 and D4: tooling commitment and the stocking agreement', () => {
  const ready = { ...base, has_drawing_attachment: true };

  it('both are optional: unanswered is neither blocking nor a warning', () => {
    const r = evaluateIntake(
      { ...ready, tooling_commitment: null, stock_hold_requested: null },
      config,
      NOW,
    );
    expect(r.blocking).toEqual([]);
    expect(r.warnings.map((w) => w.field)).not.toEqual(
      expect.arrayContaining(['tooling_commitment', 'stock_hold_requested']),
    );
  });

  it('weeks are a whole number from 1 to 520, checked only with a yes', () => {
    expect(isValidStockHoldWeeks(12)).toBe(true);
    for (const bad of [0, 521, 2.5, '4']) expect(isValidStockHoldWeeks(bad)).toBe(false);
    expect(blocking({ ...ready, stock_hold_requested: true, stock_hold_weeks: 0 })).toEqual([
      'INVALID_VALUE:stock_hold_weeks',
    ]);
    expect(blocking({ ...ready, stock_hold_requested: false, stock_hold_weeks: 0 })).toEqual([]);
  });

  it('the note is kept to 300 characters', () => {
    expect(
      blocking({ ...ready, stock_hold_requested: true, stock_hold_note: 'x'.repeat(301) }),
    ).toEqual(['INVALID_VALUE:stock_hold_note']);
  });

  it('the weeks and the note are cleared unless the answer is yes', () => {
    for (const answer of [false, null, undefined]) {
      expect(inapplicableIntakeFields({ ...ready, stock_hold_requested: answer }, config)).toEqual(
        expect.arrayContaining(['stock_hold_weeks', 'stock_hold_note']),
      );
    }
    expect(
      inapplicableIntakeFields({ ...ready, stock_hold_requested: true }, config),
    ).not.toContain('stock_hold_weeks');
  });
});
