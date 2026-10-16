/**
 * B-14 saved views: named filter sets, per user and per view, in `localStorage`. A per-user convenience
 * only: nothing depends on them, they never leave the browser, and every read/write is wrapped so a
 * private window or blocked storage just means "no saved views".
 */
export interface SavedView {
  name: string;
  /** The view's URL search, as the router serializes it (`?stage=…&sort=…`). */
  search: Record<string, unknown>;
  savedAt: string;
}

const MAX_VIEWS = 20;
const key = (userId: string, view: string) => `ccq.savedViews.${userId}.${view}`;

function read(userId: string, view: string): SavedView[] {
  try {
    const raw = window.localStorage.getItem(key(userId, view));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (v): v is SavedView =>
            !!v &&
            typeof v === 'object' &&
            typeof (v as SavedView).name === 'string' &&
            typeof (v as SavedView).search === 'object',
        )
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
  now = new Date(),
): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const rest = read(userId, view).filter((v) => v.name !== trimmed);
  return write(userId, view, [{ name: trimmed, search, savedAt: now.toISOString() }, ...rest]);
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
