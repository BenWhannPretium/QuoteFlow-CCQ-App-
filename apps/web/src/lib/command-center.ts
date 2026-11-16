import { parseAnalyticsSearch, type AnalyticsSearch } from './analytics-search';

/**
 * FB-18 (W13-29; Ben Whann, Bailey Schmitt, Tre Curry, 2026-11-13): Home is the **Command Center**. It
 * has two views: "My work" (the role's landing) and "Analytics" (the role's analytics lens, which used to
 * be its own page). Everything here is about which view the URL shows; who may open Analytics is the
 * `analytics.read` permission, checked by the page and enforced by every analytics route on the server.
 */
export const COMMAND_CENTER = 'Command Center';

export type CommandCenterView = 'work' | 'analytics';

export const COMMAND_CENTER_VIEW_LABEL: Record<CommandCenterView, string> = {
  work: 'My work',
  analytics: 'Analytics',
};

/** The URL search of `/`: the role (multi-role users), the view, and the Analytics view's filters. */
export interface CommandCenterSearch extends AnalyticsSearch {
  /** Multi-role users: which role's Command Center to show. */
  as?: string | undefined;
  /** The view to open. Absent: the view the user last chose (My work at first). */
  view?: CommandCenterView | undefined;
}

/**
 * Anything malformed is dropped, never an error. The analytics filters belong to the Analytics view, so
 * they are kept only with `view=analytics`.
 */
export function parseCommandCenterSearch(raw: Record<string, unknown>): CommandCenterSearch {
  const out: CommandCenterSearch = {};
  if (typeof raw.as === 'string' && raw.as) out.as = raw.as;
  if (raw.view === 'work') return { ...out, view: 'work' };
  if (raw.view !== 'analytics') return out;
  return { ...out, ...parseAnalyticsSearch(raw), view: 'analytics' };
}

/**
 * Where the old `/analytics` address goes: the Analytics view with every filter the link carried, so
 * bookmarks and links in emails and documents keep working.
 */
export function analyticsRedirectSearch(raw: Record<string, unknown>): CommandCenterSearch {
  return { ...parseAnalyticsSearch(raw), view: 'analytics' };
}

/** The Analytics filters of a Command Center URL (what `AnalyticsPage` reads and writes). */
export function analyticsSearchOf(search: CommandCenterSearch): AnalyticsSearch {
  const { as: _as, view: _view, ...filters } = search;
  return filters;
}

/**
 * The view to show. A URL that names a view gets it (for Analytics, the page shows the 403 page to a
 * user without `analytics.read`). Otherwise it is the view the user last chose, as long as they may
 * still open it; My work the first time.
 */
export function resolveCommandCenterView(
  search: Pick<CommandCenterSearch, 'view'>,
  remembered: CommandCenterView | null,
  canReadAnalytics: boolean,
): CommandCenterView {
  if (search.view) return search.view;
  return remembered === 'analytics' && canReadAnalytics ? 'analytics' : 'work';
}

/** The tab title: "My quotes · Command Center" (then " · QuoteFlow", added by `useDocumentTitle`). */
export const commandCenterTitle = (page: string | null | undefined): string =>
  page ? `${page} · ${COMMAND_CENTER}` : COMMAND_CENTER;

// The last view a user chose, per user, in `localStorage`. A convenience only: every read and write is
// wrapped, so a private window or blocked storage just means the choice lasts for this visit (it is
// kept in memory) and the Command Center opens on My work next time.
const key = (userId: string) => `ccq.commandCenterView.${userId}`;
const thisVisit = new Map<string, CommandCenterView>();

export function readCommandCenterView(userId: string): CommandCenterView | null {
  try {
    const stored = window.localStorage.getItem(key(userId));
    if (stored === 'work' || stored === 'analytics') return stored;
  } catch {
    // Fall through to this visit's choice.
  }
  return thisVisit.get(userId) ?? null;
}

export function rememberCommandCenterView(userId: string, view: CommandCenterView): void {
  thisVisit.set(userId, view);
  try {
    window.localStorage.setItem(key(userId), view);
  } catch {
    // Storage unavailable: `thisVisit` holds it.
  }
}
