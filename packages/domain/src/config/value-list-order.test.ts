import { describe, expect, it } from 'vitest';

import {
  compareValueListLabels,
  isOtherEntry,
  listKeepsOrder,
  sortValueListEntries,
  sortValueListsByKey,
} from './value-list-order';

const e = (code: string, label: string, sort = 0, meta: Record<string, unknown> = {}) => ({
  code,
  label,
  sort,
  meta,
});
const labels = (entries: { label: string }[]) => entries.map((x) => x.label);

describe('FB-24 (N17-08): value lists A to Z', () => {
  it('sorts by label, case-insensitive, whatever the stored order', () => {
    expect(
      labels(
        sortValueListEntries([
          e('V', 'van', 10),
          e('F', 'Flatbed', 20),
          e('D', 'Drop trailer', 30),
        ]),
      ),
    ).toEqual(['Drop trailer', 'Flatbed', 'van']);
  });

  it('is numeric-aware: Net 15 before Net 120, 13 mm before 155 mm', () => {
    const terms = sortValueListEntries([
      e('NET_120', 'Net 120', 60),
      e('NET_15', 'Net 15', 10),
      e('NET_90', 'Net 90', 50),
      e('NET_30', 'Net 30', 20),
    ]);
    expect(labels(terms)).toEqual(['Net 15', 'Net 30', 'Net 90', 'Net 120']);
    expect(
      labels(
        sortValueListEntries([e('155', '155 mm', 1), e('13', '13 mm', 2), e('28', '28 mm', 3)]),
      ),
    ).toEqual(['13 mm', '28 mm', '155 mm']);
  });

  it('puts Other last: code OTHER or a free-text entry, those A to Z among themselves', () => {
    const sorted = sortValueListEntries([
      e('OTHER', 'Other', 10, { freeText: true }),
      e('BULK', 'Bulk', 20),
      e('CUSTOM', 'Custom color', 30, { freeText: true }),
      e('ALPHA', 'Alpha', 40),
    ]);
    expect(labels(sorted)).toEqual(['Alpha', 'Bulk', 'Custom color', 'Other']);
    expect(isOtherEntry(e('OTHER', 'Something else'))).toBe(true);
    expect(isOtherEntry(e('OTHER_CAPITAL', 'Other capital'))).toBe(false);
  });

  it('keeps the stored order (sort, then code) for a list with meta.keepOrder', () => {
    const list = [
      e('NONE', 'None (quote will take longer)', 40, { keepOrder: true }),
      e('HAVE_DRAWING', 'Have drawing', 10, { keepOrder: true }),
      e('SAMPLE_ONLY', 'Sample only', 30, { keepOrder: true }),
      e('COMING', 'Coming', 20, { keepOrder: true }),
    ];
    expect(listKeepsOrder(list)).toBe(true);
    expect(labels(sortValueListEntries(list))).toEqual([
      'Have drawing',
      'Coming',
      'Sample only',
      'None (quote will take longer)',
    ]);
    // One entry with the flag is enough (an entry added later without it does not break the order).
    expect(
      labels(
        sortValueListEntries([
          e('B', 'B', 20),
          e('A', 'A', 30, { keepOrder: true }),
          e('C', 'C', 10),
        ]),
      ),
    ).toEqual(['C', 'B', 'A']);
  });

  it('is stable for equal labels (stored order breaks the tie) and does not mutate its input', () => {
    const input = [e('Y', 'Same', 20), e('X', 'Same', 20), e('Z', 'same', 10)];
    const sorted = sortValueListEntries(input);
    expect(sorted.map((x) => x.code)).toEqual(['Z', 'X', 'Y']);
    expect(input.map((x) => x.code)).toEqual(['Y', 'X', 'Z']);
    expect(compareValueListLabels(e('A', 'Same', 1), e('B', 'Same', 1))).toBeLessThan(0);
  });

  it('groups several lists by key, each in its own order', () => {
    const rows = [
      { ...e('NET_120', 'Net 120', 60), listKey: 'requested_payment_terms' },
      { ...e('B', 'Coming', 20, { keepOrder: true }), listKey: 'drawing_status' },
      { ...e('NET_15', 'Net 15', 10), listKey: 'requested_payment_terms' },
      { ...e('A', 'Have drawing', 10, { keepOrder: true }), listKey: 'drawing_status' },
    ];
    expect(sortValueListsByKey(rows).map((r) => `${r.listKey}:${r.label}`)).toEqual([
      'drawing_status:Have drawing',
      'drawing_status:Coming',
      'requested_payment_terms:Net 15',
      'requested_payment_terms:Net 120',
    ]);
  });
});
