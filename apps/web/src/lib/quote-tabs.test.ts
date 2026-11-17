import { describe, expect, it } from 'vitest';

import { isQuoteTab, withOpenedTab, type OpenedTabs } from './quote-tabs';

describe('the quote tabs', () => {
  it('knows its own names and nothing else', () => {
    expect(isQuoteTab('overview')).toBe(true);
    expect(isQuoteTab('engineering')).toBe(true);
    expect(isQuoteTab('quoting')).toBe(true);
    expect(isQuoteTab('attachments')).toBe(true);
    expect(isQuoteTab('Engineering')).toBe(false);
    expect(isQuoteTab('timeline')).toBe(false);
    expect(isQuoteTab(undefined)).toBe(false);
  });
});

/** UX-001: a tab stays on the page once it has been opened. */
describe('the tabs opened so far', () => {
  const start: OpenedTabs = { quoteNumber: 'CCQ-2026-00001', tabs: ['overview'] };

  it('adds a tab the first time it is opened', () => {
    const afterEngineering = withOpenedTab(start, 'CCQ-2026-00001', 'engineering');
    expect(afterEngineering.tabs).toEqual(['overview', 'engineering']);
    // Looking at Attachments does not drop Engineering: its typed values stay on the page.
    const afterAttachments = withOpenedTab(afterEngineering, 'CCQ-2026-00001', 'attachments');
    expect(afterAttachments.tabs).toEqual(['overview', 'engineering', 'attachments']);
  });

  it('returns the same object when the tab was already opened', () => {
    expect(withOpenedTab(start, 'CCQ-2026-00001', 'overview')).toBe(start);
  });

  it('starts again on another quote', () => {
    const both = withOpenedTab(start, 'CCQ-2026-00001', 'engineering');
    expect(withOpenedTab(both, 'CCQ-2026-00002', 'quoting')).toEqual({
      quoteNumber: 'CCQ-2026-00002',
      tabs: ['quoting'],
    });
  });
});
