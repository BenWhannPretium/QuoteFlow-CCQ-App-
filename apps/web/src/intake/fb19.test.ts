import type { IntakeDraftData, IntakeItemData } from '@ccq/contracts';
import { describe, expect, it } from 'vitest';

import { onlyKnownServerChanges } from './draft-merge';
import {
  duplicateItem,
  itemIssueCounts,
  itemView,
  moveItem,
  routeItemPatch,
  scopeEvaluation,
} from './model';

/** FB-19 (W13-32): the wizard's item helpers. */

const KEY_1 = '0193f2a0-0000-4000-8000-000000000001';
const KEY_2 = '0193f2a0-0000-4000-8000-000000000002';
const KEY_3 = '0193f2a0-0000-4000-8000-000000000003';

const draft: IntakeDraftData = {
  market: 'FOOD',
  quoteNeededBy: '2026-12-15',
  items: [
    { key: KEY_1, label: '16 oz bottle', resin: 'HDPE', containerSize: '16 oz' },
    { key: KEY_2, label: '24 oz bottle', resin: 'PET', linkedDrawingIds: [KEY_3] },
  ],
};

describe('an item view and its edits', () => {
  it('the view is the request with the item on top', () => {
    const v = itemView(draft, 1) as IntakeDraftData & { label?: string };
    expect(v).toMatchObject({ market: 'FOOD', resin: 'PET', label: '24 oz bottle' });
  });

  it('an edit goes to the item for its own keys and to the request for the rest', () => {
    const patch = routeItemPatch(draft, 1, { resin: 'HDPE', market: 'BEVERAGE' });
    expect(patch.market).toBe('BEVERAGE');
    expect(patch.items![0]).toBe(draft.items![0]);
    expect(patch.items![1]).toMatchObject({ key: KEY_2, resin: 'HDPE' });
    expect(routeItemPatch(draft, 0, { market: 'X' })).toEqual({ market: 'X' });
  });
});

describe('duplicate and move', () => {
  it('a duplicate copies every product field, links the drawings and names its source', () => {
    const copy = duplicateItem(draft.items![1]!, ['0193f2a0-0000-4000-8000-0000000000aa']);
    expect(copy.key).not.toBe(KEY_2);
    expect(copy).toMatchObject({
      label: '24 oz bottle (copy)',
      resin: 'PET',
      duplicatedFrom: KEY_2,
      sfProductSpecId: null,
    });
    expect(copy.linkedDrawingIds).toEqual([KEY_3, '0193f2a0-0000-4000-8000-0000000000aa']);
  });

  it('moves an item, keeping the others in order', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
  });
});

describe('issues by item', () => {
  const evaluation = {
    ready: false,
    blocking: [
      { code: 'MISSING_FIELD', field: 'market', message: 'market is required' },
      { code: 'MISSING_FIELD', field: 'resin', message: 'Item 2: resin is required', item: 2 },
      { code: 'MISSING_FIELD', field: 'neck_diameter', message: 'x', item: 2 },
      { code: 'MISSING_FIELD', field: 'product_family', message: 'x', item: 1 },
    ],
    warnings: [{ code: 'VOLUME_PLACEHOLDER', field: 'est_annual_volume', message: 'x', item: 1 }],
  } as const;

  it('counts the blocking issues of each item (the Items list "n to do")', () => {
    expect(itemIssueCounts(evaluation as never, 3)).toEqual([1, 2, 0]);
  });

  it('the open item sees the request issues and its own only', () => {
    const scoped = scopeEvaluation(evaluation as never, 2);
    expect(scoped.blocking.map((b) => b.field)).toEqual(['market', 'resin', 'neck_diameter']);
    expect(scoped.warnings).toEqual([]);
  });

  it('a one-item intake has no item numbers: all its issues are item 1', () => {
    const one = {
      ready: false,
      blocking: [{ code: 'MISSING_FIELD', field: 'resin', message: 'resin is required' }],
      warnings: [],
    };
    expect(scopeEvaluation(one as never, 1).blocking).toHaveLength(1);
    expect(itemIssueCounts(one as never, 1)).toEqual([1]);
  });
});

describe('a refused save (409) whose newer copy only holds known changes', () => {
  const base = { market: 'FOOD', items: [{ key: KEY_1, resin: 'HDPE', drawingStatus: null }] };

  it('the server set one item drawing status that this copy has too, while the KAM edited another field', () => {
    const server = {
      market: 'FOOD',
      items: [{ key: KEY_1, resin: 'HDPE', drawingStatus: 'HAVE_DRAWING' }],
    };
    const mine = {
      market: 'FOOD',
      items: [{ key: KEY_1, resin: 'PET', drawingStatus: 'HAVE_DRAWING' }],
    };
    expect(onlyKnownServerChanges(server, base, mine)).toBe(true);
  });

  it('an item changed or added elsewhere is a conflict', () => {
    const server = {
      market: 'FOOD',
      items: [
        { key: KEY_1, resin: 'PP', drawingStatus: null },
        { key: KEY_2, resin: 'PET' } as IntakeItemData,
      ],
    };
    expect(onlyKnownServerChanges(server, base, base)).toBe(false);
  });
});
