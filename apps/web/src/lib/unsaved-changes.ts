import { useEffect, useSyncExternalStore } from 'react';

/**
 * UX-001: which cards on a quote hold typed values that are not saved yet.
 *
 * Each editable card on the Engineering and Quoting tabs reports its own state
 * (`useReportUnsaved`). Anything that must not act on stale values asks the quote
 * (`useHasUnsavedChanges`): "Submit to lead" waits, and leaving the page asks first.
 *
 * A card reports what is true now, on every render: a save, a section that locks and a refetch
 * that brings the saved values level with the form all report "nothing unsaved" by themselves.
 * A card that leaves the screen is forgotten.
 */

/** The line shown beside a button that waits for a save. */
export const SAVE_FIRST_TEXT = 'Save your changes first.';
/** The question asked before leaving a quote with unsaved changes. */
export const LEAVE_UNSAVED_TEXT = 'You have unsaved changes on this quote. Leave without saving?';

export interface UnsavedRegistry {
  /** A card says whether it has unsaved changes. `false` forgets the card. */
  report: (quoteNumber: string, cardId: string, dirty: boolean) => void;
  /** Whether any card on the quote has unsaved changes. */
  has: (quoteNumber: string) => boolean;
  /** The cards with unsaved changes on the quote, in the order they became unsaved. */
  cards: (quoteNumber: string) => string[];
  subscribe: (listener: () => void) => () => void;
}

/** The registry itself: no React, no globals. */
export function createUnsavedRegistry(): UnsavedRegistry {
  const dirtyCards = new Map<string, Set<string>>();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    report: (quoteNumber, cardId, dirty) => {
      const cards = dirtyCards.get(quoteNumber);
      if (dirty) {
        if (cards?.has(cardId)) return;
        if (cards) cards.add(cardId);
        else dirtyCards.set(quoteNumber, new Set([cardId]));
        emit();
        return;
      }
      if (!cards?.delete(cardId)) return;
      if (cards.size === 0) dirtyCards.delete(quoteNumber);
      emit();
    },
    has: (quoteNumber) => dirtyCards.has(quoteNumber),
    cards: (quoteNumber) => [...(dirtyCards.get(quoteNumber) ?? [])],
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** One registry for the page: the cards and the buttons that wait for them sit in different trees. */
export const unsavedRegistry = createUnsavedRegistry();

/**
 * A card reports whether it has unsaved changes. Pass what is true on this render (for example
 * `canEdit && changed`); the card is forgotten when it leaves the screen.
 */
export function useReportUnsaved(quoteNumber: string, cardId: string, dirty: boolean): void {
  useEffect(() => {
    unsavedRegistry.report(quoteNumber, cardId, dirty);
  }, [quoteNumber, cardId, dirty]);
  useEffect(() => () => unsavedRegistry.report(quoteNumber, cardId, false), [quoteNumber, cardId]);
}

/** Whether any card on the quote has unsaved changes. */
export function useHasUnsavedChanges(quoteNumber: string): boolean {
  return useSyncExternalStore(
    unsavedRegistry.subscribe,
    () => unsavedRegistry.has(quoteNumber),
    () => false,
  );
}

// ── File links ───────────────────────────────────────────────────────────────────────────────────
//
// A download is a navigation to the file's link. The page stays, but the browser fires `beforeunload`
// before it knows that, so the leave question would come up for every download while a card is
// unsaved (type the solution, look at a drawing). A file link opened through `openFileLink` is let
// through.

/** How long after a file link is opened its `beforeunload` is expected (it fires at once). */
export const FILE_LINK_GRACE_MS = 1500;
let fileLinkOpenedAt = Number.NEGATIVE_INFINITY;

/** Whether `now` is within the moment after a file link was opened at `openedAt`. */
export const withinFileLinkGrace = (openedAt: number, now: number): boolean =>
  now >= openedAt && now - openedAt < FILE_LINK_GRACE_MS;

/** A file link was opened a moment ago: the `beforeunload` that follows is the download, not a leave. */
export const fileLinkJustOpened = (): boolean => withinFileLinkGrace(fileLinkOpenedAt, Date.now());

/** Open a file's download link. Use this, not `window.location.assign`, so the leave question stays quiet. */
export function openFileLink(url: string): void {
  fileLinkOpenedAt = Date.now();
  window.location.assign(url);
}
