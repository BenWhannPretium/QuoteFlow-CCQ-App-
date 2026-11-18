import type { Permission } from '@ccq/domain';
import { useState } from 'react';

/** The quote page's tabs, in the order they are shown. */
export const QUOTE_TABS = ['overview', 'engineering', 'quoting', 'attachments'] as const;
export type QuoteTab = (typeof QUOTE_TABS)[number];

export const isQuoteTab = (value: unknown): value is QuoteTab =>
  (QUOTE_TABS as readonly unknown[]).includes(value);

// ── The tab a quote opens on (UX-012) ────────────────────────────────────────────────────────────

/**
 * The permissions that mean "this reader works the engineering stage": editing the solution or the
 * capacity rows, signing capacity off, or deciding the stage's gate. They are read from `/me` (the
 * server's list for the signed-in user), never from a role name.
 */
export const ENGINEERING_WORK_PERMISSIONS = [
  'engReview.edit',
  'capacity.edit',
  'capacity.signoff',
  'gate.G2.decide',
] as const satisfies readonly Permission[];

/** The same for the quoting stage: the pricing record, the stage's gate, or the payback (ROI) model. */
export const QUOTING_WORK_PERMISSIONS = [
  'quoting.edit',
  'gate.G3.submit',
  'roi.upload',
] as const satisfies readonly Permission[];

/**
 * UX-012: the tab a quote opens on when the address names none. The tab of the quote's current stage
 * when the reader works that stage, otherwise Overview. This only chooses what is shown first: every
 * tab stays one click away, and the server decides what the reader may do on it.
 */
export function defaultQuoteTab(input: {
  /** The quote is in the engineering stage and not closed (the server's `engineering.inQueue`). */
  inEngineering: boolean;
  /** The quote is in the quoting stage and not closed (the server's `quoting.inQuoting`). */
  inQuoting: boolean;
  /** The reader's permissions, as `/me` returns them. */
  permissions: readonly string[];
}): QuoteTab {
  const holdsOneOf = (wanted: readonly string[]) =>
    wanted.some((permission) => input.permissions.includes(permission));
  if (input.inEngineering && holdsOneOf(ENGINEERING_WORK_PERMISSIONS)) return 'engineering';
  if (input.inQuoting && holdsOneOf(QUOTING_WORK_PERMISSIONS)) return 'quoting';
  return 'overview';
}

// ── Tabs that stay on the page (UX-001) ──────────────────────────────────────────────────────────

/** The tabs opened so far on one quote. */
export interface OpenedTabs {
  quoteNumber: string;
  tabs: readonly QuoteTab[];
}

/** `opened` with `tab` added. Another quote starts again; nothing new returns the same object. */
export function withOpenedTab(opened: OpenedTabs, quoteNumber: string, tab: QuoteTab): OpenedTabs {
  if (opened.quoteNumber !== quoteNumber) return { quoteNumber, tabs: [tab] };
  return opened.tabs.includes(tab) ? opened : { quoteNumber, tabs: [...opened.tabs, tab] };
}

/**
 * UX-001: the tabs opened so far on this quote, the one on screen included. The Engineering and
 * Quoting tabs stay on the page (hidden) once opened, so values typed and not yet saved are still
 * there after a look at another tab. A tab that was never opened is not loaded.
 */
export function useOpenedTabs(quoteNumber: string, tab: QuoteTab): readonly QuoteTab[] {
  const [opened, setOpened] = useState<OpenedTabs>({ quoteNumber, tabs: [tab] });
  const next = withOpenedTab(opened, quoteNumber, tab);
  if (next !== opened) setOpened(next);
  return next.tabs;
}
