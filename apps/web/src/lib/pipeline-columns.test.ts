import { QUOTE_LIST_COLUMN_KEYS } from '@ccq/contracts';
import { describe, expect, it } from 'vitest';

import { cleanColumns, moveColumn, toggleColumn } from './pipeline-columns';

// FB-27 (N17-17): the column choice is an ordered list.
describe('column order', () => {
  it('moves a column up or down by one place and stops at the ends', () => {
    const cols = ['quoteNumber', 'stage', 'plant'];
    expect(moveColumn(cols, 'plant', -1)).toEqual(['quoteNumber', 'plant', 'stage']);
    expect(moveColumn(cols, 'quoteNumber', 1)).toEqual(['stage', 'quoteNumber', 'plant']);
    expect(moveColumn(cols, 'quoteNumber', -1)).toEqual(cols);
    expect(moveColumn(cols, 'plant', 1)).toEqual(cols);
    expect(moveColumn(cols, 'unknown', 1)).toEqual(cols);
    // Never mutates what it was given.
    expect(cols).toEqual(['quoteNumber', 'stage', 'plant']);
  });

  it('Plant can be moved to the front (Faron’s case)', () => {
    let cols = ['quoteNumber', 'tier', 'customerName', 'plant'];
    for (let i = 0; i < 3; i += 1) cols = moveColumn(cols, 'plant', -1);
    expect(cols[0]).toBe('plant');
  });

  it('a ticked column joins the end; an unticked one leaves, the rest keep their order', () => {
    expect(toggleColumn(['plant', 'quoteNumber'], 'stage', true)).toEqual([
      'plant',
      'quoteNumber',
      'stage',
    ]);
    expect(toggleColumn(['plant', 'quoteNumber', 'stage'], 'quoteNumber', false)).toEqual([
      'plant',
      'stage',
    ]);
    // Ticking one already there does not duplicate it (it goes to the end).
    expect(toggleColumn(['a', 'b'], 'a', true)).toEqual(['b', 'a']);
  });

  it('keeps only columns the catalogue knows, once, in the given order', () => {
    expect(cleanColumns(['stage', 'retired_column', 'plant', 'stage'])).toEqual(['stage', 'plant']);
    expect(cleanColumns([])).toEqual([]);
  });

  it('Plant is a column the list and the CSV can show', () => {
    expect(QUOTE_LIST_COLUMN_KEYS).toContain('plant');
  });
});
