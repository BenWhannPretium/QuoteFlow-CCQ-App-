import { IntakeDraftData, intakeValues, ITEM_LABEL_MAX } from '@ccq/contracts';
import { describe, expect, it } from 'vitest';

import {
  componentTogglePatch,
  duplicateItem,
  evaluateDraft,
  itemView,
  requiredFieldsNow,
  routeItemPatch,
  wizardConfig,
} from './model';

/** FB-24 (Nov 17 and 18 feedback): the wizard's side of the intake changes. Synthetic values only. */

const KEY_1 = '0193f2a0-0000-4000-8000-000000000001';
const present = (field: string) => ({ field, op: 'present' });
const entry = (code: string, label: string, meta: Record<string, unknown> = {}) => ({
  code,
  label,
  meta,
});

const cfg = wizardConfig({
  reasonCodes: [],
  tiers: [],
  valueLists: {
    request_class: [entry('CCQ', 'CCQ'), entry('CONCEPT', 'Concept / innovation')],
    product_family: [entry('BOTTLE', 'Bottle')],
    resin: [entry('HDPE', 'HDPE')],
    component: [
      entry('CONTAINER', 'Container'),
      entry('DECORATION', 'Decoration', {
        followUps: ['decoration_types', 'decoration_print_colors'],
      }),
    ],
    decoration_type: [
      entry('SILK_SCREEN', 'Silk screen'),
      entry('SHRINK_SLEEVE', 'Shrink sleeve'),
      entry('OTHER', 'Other', { freeText: true }),
    ],
  },
  settings: {
    intake_required_fields: [present('product_family'), present('resin')],
    intake_volume_placeholder: { values: [], roundMultiple: null },
    intake_default_request_class: 'CCQ',
    intake_allowed_request_classes: ['CCQ', 'CONCEPT'],
    intake_redirect_message: 'Elsewhere.',
    intake_min_spec_fields: ['height', 'resin'],
    intake_min_spec_exempt_classes: ['CONCEPT'],
  },
} as never)!;

const NOW = new Date('2026-11-19T15:00:00Z');
const draft = (data: Partial<IntakeDraftData>): IntakeDraftData => ({
  requestClass: 'CCQ',
  items: [{ key: KEY_1, productFamily: 'BOTTLE', resin: 'HDPE' }],
  ...data,
});
const codes = (d: IntakeDraftData, hasDrawing: boolean, hasRender?: boolean) =>
  evaluateDraft(d, cfg, hasDrawing, {}, NOW, hasRender).blocking.map((b) => b.code);

describe('N17-05: the item name is 120 characters', () => {
  it('a duplicate keeps a long name up to 120', () => {
    const long = 'x'.repeat(115);
    const copy = duplicateItem({ key: KEY_1, label: long }, []);
    expect(copy.label).toHaveLength(ITEM_LABEL_MAX);
    expect(ITEM_LABEL_MAX).toBe(120);
  });
});

describe('N17-03: a concept request in the wizard', () => {
  it('the minimum spec loses its asterisks for a concept', () => {
    expect(requiredFieldsNow(cfg, false).has('height_mm')).toBe(true);
    expect(requiredFieldsNow(cfg, false, true).has('height_mm')).toBe(false);
  });

  it('evaluates as the server does: a render or a drawing, and the assumptions', () => {
    const concept = draft({ requestClass: 'CONCEPT' });
    expect(codes(concept, false, false)).toEqual(['MISSING_FIELD', 'RENDER_OR_DRAWING_REQUIRED']);
    expect(codes({ ...concept, conceptAssumptions: '16 oz round, HDPE' }, false, true)).toEqual([]);
    // A standard request still needs the minimum spec without a drawing.
    expect(codes(draft({}), false, true)).toContain('DRAWING_OR_MIN_SPEC_REQUIRED');
  });
});

describe('N17-02: decoration types', () => {
  it('a ticked type goes to the open item; an old single code reads as a one-code list', () => {
    const d = draft({});
    const patch = routeItemPatch(d, 0, { decorationTypes: ['SILK_SCREEN', 'SHRINK_SLEEVE'] });
    expect(patch.items![0]).toMatchObject({ decorationTypes: ['SILK_SCREEN', 'SHRINK_SLEEVE'] });
    const old = intakeValues(draft({ items: [{ key: KEY_1, decorationType: 'SILK_SCREEN' }] }))
      .items[0]!;
    expect(old.decoration_types).toEqual(['SILK_SCREEN']);
  });

  it('Decoration needs at least one type; Other asks what it is', () => {
    const decorated = (types: string[], other?: string) =>
      draft({
        items: [
          {
            key: KEY_1,
            productFamily: 'BOTTLE',
            resin: 'HDPE',
            components: ['CONTAINER', 'DECORATION'],
            decorationTypes: types,
            decorationPrintColors: 1,
            ...(other ? { decorationTypeOther: other } : {}),
          },
        ],
      });
    const fields = (d: IntakeDraftData) =>
      evaluateDraft(d, cfg, true, {}, NOW).blocking.map((b) => b.field);
    expect(fields(decorated([]))).toEqual(['decoration_types']);
    expect(fields(decorated(['SILK_SCREEN', 'OTHER']))).toEqual(['decoration_type_other']);
    expect(fields(decorated(['SILK_SCREEN', 'OTHER'], 'Embossed logo'))).toEqual([]);
  });
});

describe('component clicks clear the follow-ups to values the draft accepts (2026-11-19)', () => {
  /** Applies a component click the way the wizard does: on the open item, then evaluated and saved. */
  const click = (d: IntakeDraftData, code: string, on: boolean) => {
    const patch = componentTogglePatch(itemView(d, 0), code, on, cfg);
    return { patch, next: { ...d, ...routeItemPatch(d, 0, patch) } };
  };

  it('ticking a component on a fresh item clears the decoration types to [] and does not crash', () => {
    const { patch, next } = click(draft({}), 'CONTAINER', true);
    expect(patch).toMatchObject({ components: ['CONTAINER'], decorationTypes: [] });
    expect(() => evaluateDraft(next, cfg, false, {}, NOW)).not.toThrow();
    // The autosave sends the whole draft; a `null` list here was refused with 400.
    expect(IntakeDraftData.safeParse(next).success).toBe(true);
  });

  it('unticking Decoration clears its types, print colours and description', () => {
    const d = draft({
      items: [
        {
          key: KEY_1,
          components: ['CONTAINER', 'DECORATION'],
          decorationTypes: ['SILK_SCREEN', 'OTHER'],
          decorationTypeOther: 'Embossed logo',
          decorationPrintColors: 2,
        },
      ],
    });
    const { patch, next } = click(d, 'DECORATION', false);
    expect(patch).toMatchObject({
      components: ['CONTAINER'],
      decorationTypes: [],
      decorationPrintColors: null,
      decorationTypeOther: null,
    });
    expect(intakeValues(next).items[0]!.decoration_types).toEqual([]);
    expect(IntakeDraftData.safeParse(next).success).toBe(true);
  });

  it('a draft already holding a null list reads as no types instead of crashing', () => {
    const held = draft({ items: [{ key: KEY_1, decorationTypes: null as never }] });
    expect(intakeValues(held).items[0]!.decoration_types).toEqual([]);
    expect(() => evaluateDraft(held, cfg, false, {}, NOW)).not.toThrow();
  });
});
