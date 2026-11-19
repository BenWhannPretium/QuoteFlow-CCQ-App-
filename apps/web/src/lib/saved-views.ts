/**
 * B-14 saved views: named filter sets, per user and per view, in `localStorage`. A per-user convenience
 * only: nothing depends on them, they never leave the browser (they do not follow the person to
 * another device), and every read/write is wrapped so a private window or blocked storage just means
 * "no saved views". FB-27 (N17-17): a view of the list also keeps its columns and their order.
 */
export interface SavedView {
  name: string;
  /** The view's URL search, as the router serializes it (`?stage=…&sort=…`). */
  search: Record<string, unknown>;
  /** FB-27: the list's columns, in order. Absent on views saved before FB-27 (they keep the current columns). */
  columns?: string[];
  savedAt: string;
}

const MAX_VIEWS = 20;
const key = (userId: string, view: string) => `ccq.savedViews.${userId}.${view}`;

function read(userId: string, view: string): SavedView[] {
  try {
    const raw = window.localStorage.getItem(key(userId, view));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (v): v is SavedView =>
              !!v &&
              typeof v === 'object' &&
              typeof (v as SavedView).name === 'string' &&
              typeof (v as SavedView).search === 'object',
          )
          .map((v) => {
            const { columns, ...rest } = v;
            return Array.isArray(columns) &&
              columns.length > 0 &&
              columns.every((c) => typeof c === 'string')
              ? { ...rest, columns }
              : rest;
          })
      : [];
  } catch {
    return [];
  }
}

function write(userId: string, view: string, views: SavedView[]): boolean {
  try {
    window.localStorage.setItem(key(userId, view), JSON.stringify(views.slice(0, MAX_VIEWS)));
    return true;
  } catch {
    return false;
  }
}

export const listSavedViews = read;

/** Save (or replace, by name) a view. False when storage is unavailable. */
export function saveView(
  userId: string,
  view: string,
  name: string,
  search: Record<string, unknown>,
  options: { columns?: readonly string[] | undefined; now?: Date } = {},
): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const rest = read(userId, view).filter((v) => v.name !== trimmed);
  const columns = options.columns?.length ? { columns: [...options.columns] } : {};
  const savedAt = (options.now ?? new Date()).toISOString();
  return write(userId, view, [{ name: trimmed, search, ...columns, savedAt }, ...rest]);
}

export function deleteView(userId: string, view: string, name: string): boolean {
  return write(
    userId,
    view,
    read(userId, view).filter((v) => v.name !== name),
  );
}

/** Per-user list column choice (the column chooser), same storage rules. */
export function readColumns(userId: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(`ccq.quoteColumns.${userId}`);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.every((c) => typeof c === 'string') ? parsed : null;
  } catch {
    return null;
  }
}

export function writeColumns(userId: string, columns: string[]): void {
  try {
    window.localStorage.setItem(`ccq.quoteColumns.${userId}`, JSON.stringify(columns));
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
}
