/**
 * The "what changed" of a config change (B-19 decision log): the leaf paths whose values differ
 * between the audited before and after. Plain JSON in, plain JSON out.
 */
export interface ConfigDiffEntry {
  /** Dotted path (`weights.revenue`, `attributes.0.bands.2`); empty for a whole-value change. */
  path: string;
  before: unknown;
  after: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function configDiff(before: unknown, after: unknown, path = ''): ConfigDiffEntry[] {
  if (same(before, after)) return [];
  const join = (key: string | number) => (path ? `${path}.${key}` : String(key));

  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((k) => configDiff(before[k], after[k], join(k)));
  }
  // Same-length arrays (weights, bands, tiers) diff by position; anything else is replaced whole.
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    return before.flatMap((b, i) => configDiff(b, after[i], join(i)));
  }
  return [{ path, before: before ?? null, after: after ?? null }];
}
