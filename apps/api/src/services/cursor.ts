/** Opaque keyset cursor for newest-first lists: the `(timestamp, id)` of the last item returned. */
export interface KeysetCursor {
  at: Date;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const encodeCursor = (c: KeysetCursor): string =>
  Buffer.from(`${c.at.toISOString()}|${c.id}`, 'utf8').toString('base64url');

/** Null for anything that is not a cursor this API issued (the route answers 400). */
export function decodeCursor(raw: string): KeysetCursor | null {
  const [iso, id, extra] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  if (!iso || !id || extra !== undefined || !UUID.test(id)) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : { at, id };
}

/** `limit + 1` rows were fetched: return the page and the cursor for the next one. */
export function page<T>(rows: T[], limit: number, key: (row: T) => KeysetCursor) {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(key(last)) : null };
}
