/**
 * FB-15 (W13-01): a save refused as "changed in another tab" (409) is not always a conflict. Uploading a
 * drawing on the review step sets the draft's drawing status on the server, and the wizard mirrors that
 * value in its own copy; the copy's version is then out of date, but it already holds the change. These
 * helpers tell that case from a real edit in another tab or window.
 */

/** A value as JSON with object keys sorted, so two copies compare equal whatever their key order. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * True when every field the server changed since this copy's last save (`base`) already has the server's
 * value in this copy (`mine`): the save may be sent again on the server's newer version. A field changed
 * elsewhere that this copy does not have is a real conflict (false), so nothing is overwritten.
 */
export function onlyKnownServerChanges(server: object, base: object, mine: object): boolean {
  const s = server as Record<string, unknown>;
  const b = base as Record<string, unknown>;
  const m = mine as Record<string, unknown>;
  for (const key of new Set([...Object.keys(s), ...Object.keys(b)])) {
    // FB-19: the items are compared item by item and field by field (an upload sets one item's drawing
    // status while the KAM may be editing another field or another item).
    if (key === 'items' && Array.isArray(s[key])) {
      if (!onlyKnownItemChanges(s[key], b[key], m[key])) return false;
      continue;
    }
    const theirs = stableJson(s[key]);
    if (theirs !== stableJson(b[key]) && theirs !== stableJson(m[key])) return false;
  }
  return true;
}

type KeyedItem = { key: string } & Record<string, unknown>;
const byKey = (list: unknown): Map<string, KeyedItem> =>
  new Map(
    (Array.isArray(list) ? (list as KeyedItem[]) : [])
      .filter((i) => i && typeof i.key === 'string')
      .map((i) => [i.key, i]),
  );

/** FB-19: `onlyKnownServerChanges` for the items: per item (by key) and per field. */
function onlyKnownItemChanges(server: unknown, base: unknown, mine: unknown): boolean {
  const s = byKey(server);
  const b = byKey(base);
  const m = byKey(mine);
  for (const key of new Set([...s.keys(), ...b.keys()])) {
    const theirs = s.get(key);
    const was = b.get(key);
    const ours = m.get(key);
    // Added or removed on the server: known only if this copy did the same.
    if (!theirs || !was) {
      if (stableJson(theirs) !== stableJson(was) && stableJson(theirs) !== stableJson(ours)) {
        return false;
      }
      continue;
    }
    if (!onlyKnownServerChanges(theirs, was, ours ?? {})) return false;
  }
  return true;
}
