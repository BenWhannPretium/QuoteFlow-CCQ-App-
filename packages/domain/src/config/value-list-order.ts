/**
 * FB-24 (N17-08, Bailey Schmitt, 2026-11-17): every dropdown reads A to Z. Value lists are returned
 * sorted by label (case-insensitive, numeric-aware: "Net 15" before "Net 120", "13 mm" before "155 mm"),
 * with "Other" last. A list whose stored order means something (an ordinal scale, a progression) opts out
 * with `meta.keepOrder: true` on its entries and keeps the stored order (`sort`, then code). Pure: the
 * repository applies it on read; Admin's list editor keeps showing the stored order.
 */

/** The fields of a value-list entry the order reads. */
export interface OrderableValueListEntry {
  code: string;
  label: string;
  sort?: number | null;
  meta?: unknown;
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

const metaOf = (e: OrderableValueListEntry): Record<string, unknown> =>
  e.meta && typeof e.meta === 'object' ? (e.meta as Record<string, unknown>) : {};

/** "Other" (code OTHER) or a free-text entry (Other, Custom, Custom color): shown last. */
export const isOtherEntry = (e: OrderableValueListEntry): boolean =>
  e.code.toUpperCase() === 'OTHER' || metaOf(e).freeText === true;

/** True when any entry of the list asks to keep the stored order (`meta.keepOrder`). */
export const listKeepsOrder = (entries: readonly OrderableValueListEntry[]): boolean =>
  entries.some((e) => metaOf(e).keepOrder === true);

/** The stored order: `sort`, then code. */
export function compareStoredOrder(a: OrderableValueListEntry, b: OrderableValueListEntry): number {
  const sa = a.sort ?? 0;
  const sb = b.sort ?? 0;
  if (sa !== sb) return sa - sb;
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

/** A to Z by label (numeric-aware, case-insensitive), "Other" last; ties fall back to the stored order. */
export function compareValueListLabels(
  a: OrderableValueListEntry,
  b: OrderableValueListEntry,
): number {
  const other = Number(isOtherEntry(a)) - Number(isOtherEntry(b));
  if (other !== 0) return other;
  return collator.compare(a.label.trim(), b.label.trim()) || compareStoredOrder(a, b);
}

/** One list's entries in display order (a new array): A to Z with Other last, or stored with keepOrder. */
export function sortValueListEntries<T extends OrderableValueListEntry>(
  entries: readonly T[],
): T[] {
  return [...entries].sort(listKeepsOrder(entries) ? compareStoredOrder : compareValueListLabels);
}

/**
 * Entries of several lists (each carrying its `listKey`), grouped by list key (A to Z) and each list in
 * display order.
 */
export function sortValueListsByKey<T extends OrderableValueListEntry & { listKey: string }>(
  entries: readonly T[],
): T[] {
  const byList = new Map<string, T[]>();
  for (const e of entries) {
    const list = byList.get(e.listKey);
    if (list) list.push(e);
    else byList.set(e.listKey, [e]);
  }
  return [...byList.keys()].sort().flatMap((key) => sortValueListEntries(byList.get(key)!));
}
