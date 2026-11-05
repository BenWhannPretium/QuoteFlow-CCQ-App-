import { describe, expect, it } from 'vitest';

import { evaluateIntake, inapplicableIntakeFields, parseIntakeConfig } from './intake';
import {
  activeFollowUps,
  migrateLegacyNeckFinish,
  neckSummary,
  parseNeckText,
  type ListEntry,
} from './product-facts';

const NOW = new Date('2026-11-05T15:00:00Z');

/** Jim Zweifel's lists (Field Inventory, Nov 5), as seeded. */
const diameters: ListEntry[] = [
  ...[
    '13',
    '15',
    '18',
    '20',
    '22',
    '24',
    '28',
    '30',
    '33',
    '35',
    '38',
    '40',
    '53',
    '58',
    '60',
    '63',
    '66',
    '70',
    '75',
    '83',
    '89',
    '100',
    '110',
    '120',
    '135',
    '155',
  ].map((d) => ({ code: d, label: `${d} mm` })),
  { code: '409', label: '409 (120 mm snap)' },
  { code: '605D', label: '605D (155 mm snap)' },
  { code: 'CUSTOM', label: 'Custom', freeText: true },
];
const finishes: ListEntry[] = [
  ...['400', '410', '415', '485', 'CRC', 'DBJ', 'ROPP'].map((c) => ({ code: c, label: c })),
  { code: 'DEEP_SKIRT', label: 'Deep Skirt' },
  { code: 'PCO_1881', label: 'PCO-1881 (Super Shorty)' },
  { code: 'PCO_1810', label: 'PCO-1810' },
  { code: 'SNAP', label: 'Snap' },
  { code: 'CUSTOM', label: 'Custom', freeText: true },
];
const lists = { diameters, finishes };

describe('parseNeckText (Salesforce Neck_Finish__c pre-fill, F-010)', () => {
  it.each([
    ['28-410', '28', '410', null],
    ['38/400', '38', '400', null],
    ['  89 - 400 ', '89', '400', null],
    ['24mm-410', '24', '410', null],
    ['38-PCO-1810', '38', 'PCO_1810', null],
    ['28 Deep Skirt', '28', 'DEEP_SKIRT', null],
    ['605D snap', '605D', 'SNAP', null],
    ['120 DC', '120', 'CUSTOM', 'DC'],
    ['53mm lug', '53', 'CUSTOM', 'lug'],
  ])('%s → %s + %s', (text, diameter, finish, custom) => {
    expect(parseNeckText(text, lists)).toEqual({
      neckDiameter: diameter,
      neckFinishType: finish,
      neckFinishTypeCustom: custom,
    });
  });

  it.each([[null], [''], ['Continuous thread'], ['27-410'], ['410'], ['lug 53']])(
    '%s cannot be parsed: left blank',
    (text) => {
      expect(parseNeckText(text, lists)).toBeNull();
    },
  );
});

describe('migrateLegacyNeckFinish (migration 0026, F-010)', () => {
  it.each([
    ['28-410', '28', '410', null],
    ['38-400', '38', '400', null],
    ['89-400', '89', '400', null],
    ['110-400', '110', '400', null],
    ['120-DC', '120', 'CUSTOM', 'DC'],
    ['120 DC', '120', 'CUSTOM', 'DC'],
    ['53mm lug', null, 'CUSTOM', '53mm lug'],
    [' 24-410 special ', null, 'CUSTOM', '24-410 special'],
  ])('%s → %s / %s / %s', (stored, diameter, finish, custom) => {
    expect(migrateLegacyNeckFinish(stored)).toEqual({
      neckDiameter: diameter,
      neckFinishType: finish,
      neckFinishTypeCustom: custom,
    });
  });

  it('blank stays blank; a long Other text is cut to 120', () => {
    expect(migrateLegacyNeckFinish(null).neckFinishType).toBeNull();
    expect(migrateLegacyNeckFinish('   ').neckFinishType).toBeNull();
    expect(migrateLegacyNeckFinish('x'.repeat(150)).neckFinishTypeCustom).toHaveLength(120);
  });
});

it('neckSummary joins the parts that are set', () => {
  expect(neckSummary({ diameter: '28 mm', finish: '410', feature: 'Vented' })).toBe(
    '28 mm / 410 / Vented',
  );
  expect(neckSummary({ diameter: null, finish: 'lug', feature: null })).toBe('lug');
});

const config = parseIntakeConfig({
  requiredFields: [],
  volumePlaceholder: {},
  defaultRequestClass: 'CCQ',
  allowedRequestClasses: ['CCQ'],
  redirectMessage: 'Elsewhere.',
  drawingProvidedCodes: ['HAVE_DRAWING'],
  customCodes: {
    neck_diameter: ['CUSTOM'],
    neck_finish_type: ['CUSTOM'],
    neck_special_feature: ['CUSTOM'],
    color_type: ['CUSTOM'],
  },
  componentFollowUps: {
    LINER: ['liner_spec'],
    LABEL: ['labels_purchased_by'],
    DECORATION: ['decoration_type', 'decoration_print_colors'],
  },
  variantsNoteMaxLength: 300,
});

const base = { sf_opportunity_id: null, request_class: 'CCQ', drawing_status: 'HAVE_DRAWING' };
const blocking = (values: Record<string, unknown>) =>
  evaluateIntake({ ...base, ...values }, config, NOW).blocking.map((b) => `${b.code}:${b.field}`);

describe('conditional requirements', () => {
  it.each([
    ['neck_diameter', 'neck_diameter_custom'],
    ['neck_finish_type', 'neck_finish_type_custom'],
    ['neck_special_feature', 'neck_special_feature_custom'],
    ['color_type', 'color_description'],
  ])('Custom %s needs %s (≤ 120)', (field, description) => {
    expect(blocking({ [field]: 'CUSTOM' })).toEqual([`MISSING_FIELD:${description}`]);
    expect(blocking({ [field]: 'CUSTOM', [description]: 'Custom thing' })).toEqual([]);
    expect(blocking({ [field]: 'CUSTOM', [description]: 'x'.repeat(121) })).toEqual([
      `INVALID_VALUE:${description}`,
    ]);
    // Not Custom: no description needed (and one left over is cleared on store).
    expect(blocking({ [field]: 'X' })).toEqual([]);
    expect(inapplicableIntakeFields({ [field]: 'X' }, config)).toContain(description);
    expect(inapplicableIntakeFields({ [field]: 'CUSTOM' }, config)).not.toContain(description);
  });

  it('a customer-specified resin needs the supplier / grade (F-011)', () => {
    expect(blocking({ resin_customer_specified: true })).toEqual(['MISSING_FIELD:resin_grade']);
    expect(blocking({ resin_customer_specified: true, resin_grade: 'Pro-fax 6331' })).toEqual([]);
    expect(blocking({ resin_customer_specified: false })).toEqual([]);
    expect(inapplicableIntakeFields({ resin_customer_specified: false }, config)).toContain(
      'resin_grade',
    );
  });

  it('short texts stay short: additives ≤ 200, variants note ≤ the setting (F-023, F-075)', () => {
    expect(blocking({ additives: 'x'.repeat(201) })).toEqual(['INVALID_VALUE:additives']);
    expect(blocking({ quote_variants_note: 'x'.repeat(300) })).toEqual([]);
    expect(blocking({ quote_variants_note: 'x'.repeat(301) })).toEqual([
      'INVALID_VALUE:quote_variants_note',
    ]);
    const tight = { ...config, variantsNoteMaxLength: 10 };
    const [issue] = evaluateIntake(
      { ...base, quote_variants_note: '0/25/50% PCR' },
      tight,
      NOW,
    ).blocking;
    expect(issue?.code).toBe('INVALID_VALUE');
    expect(issue?.message).toContain('10');
  });
});

describe('component follow-ups (F-013)', () => {
  it('only the picked components ask, in a stable order', () => {
    expect(activeFollowUps(['DECORATION', 'LINER'], config.componentFollowUps)).toEqual([
      'liner_spec',
      'decoration_type',
      'decoration_print_colors',
    ]);
    expect(activeFollowUps(['CONTAINER'], config.componentFollowUps)).toEqual([]);
    expect(activeFollowUps(null, config.componentFollowUps)).toEqual([]);
  });

  it('each shown follow-up is required', () => {
    expect(blocking({ components: ['LINER'] })).toEqual(['MISSING_FIELD:liner_spec']);
    expect(blocking({ components: ['LABEL'] })).toEqual(['MISSING_FIELD:labels_purchased_by']);
    expect(blocking({ components: ['DECORATION'] })).toEqual([
      'MISSING_FIELD:decoration_type',
      'MISSING_FIELD:decoration_print_colors',
    ]);
    expect(
      blocking({
        components: ['LINER', 'LABEL', 'DECORATION'],
        liner_spec: 'Induction seal',
        labels_purchased_by: 'CUSTOMER',
        decoration_type: 'SILK_SCREEN',
        decoration_print_colors: 2,
      }),
    ).toEqual([]);
  });

  it.each([[0], [13], [2.5], ['3']])('%s print colors is not a whole number 1–12', (n) => {
    expect(
      blocking({
        components: ['DECORATION'],
        decoration_type: 'HOT_STAMP',
        decoration_print_colors: n,
      }),
    ).toEqual(['INVALID_VALUE:decoration_print_colors']);
  });

  it('a follow-up of a component that is not picked never blocks and is cleared', () => {
    expect(blocking({ components: ['CONTAINER'], liner_spec: null })).toEqual([]);
    expect(inapplicableIntakeFields({ components: ['LABEL'] }, config)).toEqual(
      expect.arrayContaining(['liner_spec', 'decoration_type', 'decoration_print_colors']),
    );
    expect(inapplicableIntakeFields({ components: ['LABEL'] }, config)).not.toContain(
      'labels_purchased_by',
    );
  });
});
