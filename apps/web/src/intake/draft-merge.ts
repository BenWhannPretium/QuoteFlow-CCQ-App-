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
    const theirs = stableJson(s[key]);
    if (theirs !== stableJson(b[key]) && theirs !== stableJson(m[key])) return false;
  }
  return true;
}
