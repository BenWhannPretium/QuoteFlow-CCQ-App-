import { describe, expect, it } from 'vitest';

import {
  draftItems,
  IntakeDraftData,
  IntakeItemData,
  intakeValues,
  itemFromFlat,
  LEGACY_ITEM_KEY,
  normalizeDraftData,
} from './intake';

/** FB-19 (W13-32): the draft's items in the contract. */

const KEY_1 = '0193f2a0-0000-4000-8000-000000000001';
const KEY_2 = '0193f2a0-0000-4000-8000-000000000002';
let n = 0;
const newKey = () => `0193f2a0-0000-4000-8000-${String(++n).padStart(12, '0')}`;

describe('draft items', () => {
  it('a draft saved before FB-19 is read as one item from its top-level product fields', () => {
    const data = IntakeDraftData.parse({ market: 'FOOD', resin: 'HDPE', estAnnualVolume: 5 });
    expect(draftItems(data)).toEqual([{ key: LEGACY_ITEM_KEY, resin: 'HDPE', estAnnualVolume: 5 }]);
    expect(itemFromFlat(data, KEY_1)).toEqual({ key: KEY_1, resin: 'HDPE', estAnnualVolume: 5 });
  });

  it('normalising moves the product fields into items and keeps the request fields', () => {
    const data = IntakeDraftData.parse({ market: 'FOOD', resin: 'HDPE', containerSize: '16 oz' });
    const out = normalizeDraftData(data, newKey);
    expect(out).toEqual({
      market: 'FOOD',
      items: [{ key: expect.any(String), resin: 'HDPE', containerSize: '16 oz' }],
    });
    expect(out).not.toHaveProperty('resin');
  });

  it('a draft with items keeps them and drops stale top-level product fields', () => {
    const data = IntakeDraftData.parse({
      market: 'FOOD',
      resin: 'STALE',
      items: [
        { key: KEY_1, resin: 'HDPE' },
        { key: KEY_2, resin: 'PET', label: '24 oz bottle' },
      ],
    });
    const out = normalizeDraftData(data, newKey);
    expect(out.items).toEqual(data.items);
    expect(out).not.toHaveProperty('resin');
  });

  it('item keys must look like uuids; labels stay short', () => {
    expect(IntakeItemData.safeParse({ key: 'not-a-key' }).success).toBe(false);
    expect(IntakeItemData.safeParse({ key: KEY_1, label: 'x'.repeat(61) }).success).toBe(false);
    expect(IntakeItemData.safeParse({ key: KEY_1, label: '16 oz bottle' }).success).toBe(true);
  });

  it('intakeValues: the request at the top, one entry per item, the drawing per item', () => {
    const data = IntakeDraftData.parse({
      market: 'FOOD',
      estAnnualRevenue: 100,
      items: [
        { key: KEY_1, label: ' 16 oz ', resin: 'HDPE', estAnnualVolume: 1 },
        { key: KEY_2, resin: 'PET', sfProductSpecId: 'a0X1' },
      ],
    });
    const v = intakeValues(data, (item) => item.key === KEY_2);
    expect(v).toMatchObject({ market: 'FOOD', est_annual_revenue: 100 });
    expect(v).not.toHaveProperty('resin');
    expect(v.items).toHaveLength(2);
    expect(v.items[0]).toMatchObject({
      label: '16 oz',
      resin: 'HDPE',
      est_annual_volume: 1,
      has_drawing_attachment: false,
    });
    expect(v.items[1]).toMatchObject({
      resin: 'PET',
      sf_product_spec_id: 'a0X1',
      has_drawing_attachment: true,
    });
    // One answer for every item, or none (then the domain falls back to the drawing status).
    expect(intakeValues(data, true).items.every((i) => i.has_drawing_attachment === true)).toBe(
      true,
    );
    expect(intakeValues(data).items[0]).not.toHaveProperty('has_drawing_attachment');
  });
});
