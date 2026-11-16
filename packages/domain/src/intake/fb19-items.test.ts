import { describe, expect, it } from 'vitest';

import { evaluateIntake, intakeListValueIssues, parseIntakeConfig } from './intake';
import type { IntakeConfig } from './intake';
import {
  activeQuoteWarning,
  decideActiveQuotes,
  isItemField,
  ITEM_VALUE_FIELDS,
  itemName,
  itemsSummary,
  itemsVolumeText,
  OPPORTUNITY_ACTIVE_QUOTE_MESSAGE_SEED,
  parseOpportunityActiveQuoteMessage,
  parseOpportunityActiveQuotes,
  parseQuoteItemsMax,
  QUOTE_ITEMS_MAX_SEED,
  quoteMirror,
} from './items';
import { DomainError } from '../errors';

/** FB-19 (W13-32 to W13-34): multi-item quotes, the domain half. */

const present = (field: string) => ({ field, op: 'present' as const });

const config: IntakeConfig = parseIntakeConfig({
  requiredFields: [
    present('sf_opportunity_id'),
    present('product_family'),
    present('resin'),
    present('market'),
    present('quote_needed_by'),
    { anyOf: [present('est_annual_volume'), present('est_annual_revenue')] },
  ],
  volumePlaceholder: { values: [1_000_000], roundMultiple: null },
  defaultRequestClass: 'CCQ',
  allowedRequestClasses: ['CCQ'],
  redirectMessage: 'Stock stays in the pricing application.',
  drawingProvidedCodes: ['HAVE_DRAWING'],
  minSpecFields: ['height'],
  itemsMax: 3,
  listCodes: { resin: ['HDPE', 'PET'], product_family: ['BOTTLE', 'JAR'], market: ['FOOD'] },
});

const NOW = new Date('2026-11-05T15:00:00Z');

const request = {
  sf_opportunity_id: '006SYN000000000001',
  customer: { status: 'existing', sf_account_id: '001SYN', name: 'Acme (synthetic)' },
  request_class: 'CCQ',
  market: 'FOOD',
  quote_needed_by: '2026-12-15',
  comments_for_engineering: 'x',
  description: 'x',
};

const item = (over: Record<string, unknown> = {}) => ({
  product_family: 'BOTTLE',
  resin: 'HDPE',
  est_annual_volume: 250_000,
  height_mm: 120,
  has_drawing_attachment: true,
  product_needed_by: '2027-03-01',
  ...over,
});

describe('evaluateIntake with items', () => {
  it('a complete one-item intake is ready and reads exactly as the flat intake does', () => {
    const one = evaluateIntake({ ...request, items: [item()] }, config, NOW);
    const flat = evaluateIntake({ ...request, ...item() }, config, NOW);
    expect(one.ready).toBe(true);
    expect(one).toEqual(flat);
  });

  it('a one-item intake names no item (no number, no "Item 1:")', () => {
    const r = evaluateIntake({ ...request, items: [item({ resin: null })] }, config, NOW);
    const resin = r.blocking.find((b) => b.field === 'resin')!;
    expect(resin.item).toBeUndefined();
    expect(resin.message).not.toMatch(/^Item/);
  });

  it('checks the request once and the product fields per item, naming the item', () => {
    const r = evaluateIntake(
      {
        ...request,
        market: null,
        items: [item({ label: '16 oz bottle' }), item({ label: '24 oz bottle', resin: null })],
      },
      config,
      NOW,
    );
    // The market is request level: one issue, no item.
    const market = r.blocking.filter((b) => b.field === 'market');
    expect(market).toHaveLength(1);
    expect(market[0]!.item).toBeUndefined();
    // The resin is item 2's.
    const resin = r.blocking.filter((b) => b.field === 'resin');
    expect(resin).toHaveLength(1);
    expect(resin[0]).toMatchObject({ item: 2 });
    expect(resin[0]!.message).toMatch(/^Item 2 \(24 oz bottle\): /);
    expect(r.ready).toBe(false);
  });

  it('volume-or-revenue: an item without a volume passes on the quote revenue', () => {
    const noVolume = item({ est_annual_volume: null });
    expect(
      evaluateIntake(
        { ...request, est_annual_revenue: 100_000, items: [item(), noVolume] },
        config,
        NOW,
      ).ready,
    ).toBe(true);
    const r = evaluateIntake({ ...request, items: [item(), noVolume] }, config, NOW);
    expect(r.blocking.map((b) => [b.field, b.item])).toContainEqual([
      'est_annual_volume,est_annual_revenue',
      2,
    ]);
  });

  it('the drawing or minimum spec is per item, with the item own drawing', () => {
    const r = evaluateIntake(
      {
        ...request,
        items: [item(), item({ has_drawing_attachment: false, height_mm: null })],
      },
      config,
      NOW,
    );
    const spec = r.blocking.filter((b) => b.code === 'DRAWING_OR_MIN_SPEC_REQUIRED');
    expect(spec).toHaveLength(1);
    expect(spec[0]).toMatchObject({ item: 2, missing: ['height_mm'] });
  });

  it('each item is needed on or after the quote date (Zachary Cairns: items can differ)', () => {
    const r = evaluateIntake(
      {
        ...request,
        items: [item(), item({ product_needed_by: '2026-12-01' })],
      },
      config,
      NOW,
    );
    expect(r.blocking).toContainEqual(
      expect.objectContaining({ field: 'product_needed_by', item: 2, code: 'INVALID_VALUE' }),
    );
  });

  it('more items than quote_items_max blocks; none at all blocks', () => {
    const many = evaluateIntake(
      { ...request, items: [item(), item(), item(), item()] },
      config,
      NOW,
    );
    expect(many.blocking).toContainEqual(expect.objectContaining({ field: 'items' }));
    const none = evaluateIntake({ ...request, items: [] }, config, NOW);
    expect(none.ready).toBe(false);
    expect(none.blocking).toContainEqual(
      expect.objectContaining({ field: 'items', message: 'Add at least one item' }),
    );
  });

  it('request-level warnings are listed once, item warnings per item', () => {
    const r = evaluateIntake(
      {
        ...request,
        items: [item({ est_annual_volume: 1_000_000 }), item({ est_annual_volume: 1_000_000 })],
      },
      config,
      NOW,
    );
    const placeholders = r.warnings.filter((w) => w.code === 'VOLUME_PLACEHOLDER');
    expect(placeholders.map((w) => w.item)).toEqual([1, 2]);
    const enrichMarket = r.warnings.filter((w) => w.field === 'requested_payment_terms');
    expect(enrichMarket).toHaveLength(1);
  });
});

describe('intakeListValueIssues', () => {
  it('checks the request list fields once and each item against its own values', () => {
    const issues = intakeListValueIssues(
      { market: 'NOPE', items: [{ resin: 'HDPE' }, { resin: 'UNOBTAINIUM' }] },
      config,
    );
    expect(issues.map((i) => [i.field, i.item])).toEqual([
      ['market', undefined],
      ['resin', 2],
    ]);
  });

  it('a kept code (the reworked quote holds it on any item) is accepted', () => {
    expect(
      intakeListValueIssues({ items: [{ resin: 'PCR_HDPE' }] }, config, {
        resin: ['HDPE', 'PCR_HDPE'],
      }),
    ).toEqual([]);
  });
});

describe('items helpers', () => {
  it('isItemField: the product fields, the drawing and the label; never a request field', () => {
    for (const f of ITEM_VALUE_FIELDS) expect(isItemField(f), f).toBe(true);
    expect(isItemField('drawing_or_min_spec')).toBe(true);
    expect(isItemField('est_annual_volume,est_annual_revenue')).toBe(true);
    for (const f of ['market', 'sub_market', 'quote_needed_by', 'est_annual_revenue', 'items']) {
      expect(isItemField(f), f).toBe(false);
    }
  });

  it('names an item, and sums up a list of items', () => {
    expect(itemName(2, '24 oz bottle')).toBe('Item 2 (24 oz bottle)');
    expect(itemName(3, '  ')).toBe('Item 3');
    expect(itemsSummary([{ itemNo: 1, label: '16 oz bottle' }])).toBe('16 oz bottle');
    expect(itemsSummary([{ itemNo: 1, label: null }])).toBe('1 item');
    expect(
      itemsSummary([
        { itemNo: 2, label: 'b' },
        { itemNo: 1, label: '16 oz bottle' },
        { itemNo: 3, label: null },
      ]),
    ).toBe('16 oz bottle + 2 more');
    expect(itemsSummary([])).toBe('');
  });

  it('the quote mirror: item 1 product columns, the volume summed, confirmed only when all are', () => {
    const m = quoteMirror([
      {
        product_family: 'BOTTLE',
        resin: 'HDPE',
        est_annual_volume: 1_000_000,
        est_annual_volume_confirmed: true,
      },
      {
        product_family: 'JAR',
        resin: 'PET',
        est_annual_volume: 1_100_000,
        est_annual_volume_confirmed: false,
      },
      {
        product_family: 'JAR',
        resin: 'PET',
        est_annual_volume: null,
        est_annual_volume_confirmed: true,
      },
    ]);
    expect(m).toMatchObject({
      product_family: 'BOTTLE',
      resin: 'HDPE',
      est_annual_volume: 2_100_000,
      est_annual_volume_confirmed: false,
    });
    expect(quoteMirror([{ est_annual_volume: null }]).est_annual_volume).toBeNull();
    expect(
      quoteMirror([
        { est_annual_volume: 5, est_annual_volume_confirmed: true },
        { est_annual_volume: 7, est_annual_volume_confirmed: true },
      ]).est_annual_volume_confirmed,
    ).toBe(true);
  });

  it('the breakdown words for a multi-item quote', () => {
    expect(itemsVolumeText(1, 500)).toBeNull();
    expect(itemsVolumeText(3, 2_100_000)).toBe('3 items, 2.1 M units a year in total');
    expect(itemsVolumeText(2, 2_000_000)).toBe('2 items, 2 M units a year in total');
    expect(itemsVolumeText(2, 750_000)).toBe('2 items, 750,000 units a year in total');
    expect(itemsVolumeText(2, null)).toBe('2 items, volume not given');
  });
});

describe('settings (provisional)', () => {
  it('quote_items_max: a whole number 1–200; missing reads as the seed', () => {
    expect(parseQuoteItemsMax(undefined)).toBe(QUOTE_ITEMS_MAX_SEED);
    expect(parseQuoteItemsMax(5)).toBe(5);
    for (const bad of [0, 201, 2.5, '5']) {
      expect(() => parseQuoteItemsMax(bad)).toThrow(DomainError);
    }
  });

  it('opportunity_active_quotes: one | warn; seed warn', () => {
    expect(parseOpportunityActiveQuotes(null)).toBe('warn');
    expect(parseOpportunityActiveQuotes('one')).toBe('one');
    expect(() => parseOpportunityActiveQuotes('many')).toThrow(DomainError);
  });

  it('opportunity_active_quote_message: text up to 500; seed when missing', () => {
    expect(parseOpportunityActiveQuoteMessage(undefined)).toBe(
      OPPORTUNITY_ACTIVE_QUOTE_MESSAGE_SEED,
    );
    expect(() => parseOpportunityActiveQuoteMessage('')).toThrow(DomainError);
    expect(() => parseOpportunityActiveQuoteMessage('x'.repeat(501))).toThrow(DomainError);
  });
});

describe('another active quote on the opportunity (W13-33)', () => {
  it('one: refused; warn: refused until the KAM confirms; none open: allowed', () => {
    expect(decideActiveQuotes('one', 0, false)).toEqual({ ok: true, separate: false });
    expect(decideActiveQuotes('one', 1, true)).toEqual({ ok: false, reason: 'one' });
    expect(decideActiveQuotes('warn', 1, false)).toEqual({ ok: false, reason: 'unconfirmed' });
    expect(decideActiveQuotes('warn', 2, true)).toEqual({ ok: true, separate: true });
  });

  it('the warning names the open quotes and their KAMs only', () => {
    const template = OPPORTUNITY_ACTIVE_QUOTE_MESSAGE_SEED;
    expect(activeQuoteWarning(template, [])).toBeNull();
    expect(
      activeQuoteWarning(template, [
        { quoteNumber: 'CCQ-2026-00042', kamName: 'KAM One (synthetic)' },
      ]),
    ).toBe(
      'CCQ-2026-00042 is already open for this opportunity (KAM: KAM One (synthetic)). Add these items to it instead if it is still with you, or continue to start a separate quote.',
    );
    expect(
      activeQuoteWarning('{quoteNumber} / {kamName}', [
        { quoteNumber: 'A', kamName: 'X' },
        { quoteNumber: 'B', kamName: 'X' },
        { quoteNumber: 'C', kamName: null },
      ]),
    ).toBe('A, B, C / X, unknown');
  });
});
