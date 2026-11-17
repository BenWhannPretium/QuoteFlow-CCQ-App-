import { useState } from 'react';

/** The quote page's tabs, in the order they are shown. */
export const QUOTE_TABS = ['overview', 'engineering', 'quoting', 'attachments'] as const;
export type QuoteTab = (typeof QUOTE_TABS)[number];

export const isQuoteTab = (value: unknown): value is QuoteTab =>
  (QUOTE_TABS as readonly unknown[]).includes(value);

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
