import { QUOTE_LIST_COLUMNS, type QuoteListColumnKey } from '@ccq/contracts';

/**
 * FB-27 (N17-17): the list's column choice is an ordered list. The chooser moves a column up or down
 * and the table shows them in that order; saved views keep it.
 */

/** Only keys the catalogue still knows (an older saved choice may name a retired column), no repeats. */
export function cleanColumns(columns: readonly string[]): QuoteListColumnKey[] {
  const seen = new Set<string>();
  const out: QuoteListColumnKey[] = [];
  for (const c of columns) {
    if (c in QUOTE_LIST_COLUMNS && !seen.has(c)) {
      seen.add(c);
      out.push(c as QuoteListColumnKey);
    }
  }
  return out;
}

/** Move one column by `delta` places (−1 = earlier). Out of range or unknown: unchanged. */
export function moveColumn<T>(columns: readonly T[], key: T, delta: -1 | 1): T[] {
  const from = columns.indexOf(key);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= columns.length) return [...columns];
  const next = [...columns];
  next.splice(from, 1);
  next.splice(to, 0, key);
  return next;
}

/** Tick a column: it joins at the end of the shown ones (the user then moves it). Untick removes it. */
export function toggleColumn<T>(columns: readonly T[], key: T, on: boolean): T[] {
  const without = columns.filter((c) => c !== key);
  return on ? [...without, key] : without;
}
