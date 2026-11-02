import { useEffect } from 'react';

/** `[TEST] ` outside prod (set by <EnvironmentBanner>), so the tab says which environment it is. */
let titlePrefix = '';

export function setDocumentTitlePrefix(prefix: string) {
  const base = document.title.startsWith(titlePrefix)
    ? document.title.slice(titlePrefix.length)
    : document.title;
  titlePrefix = prefix;
  document.title = `${prefix}${base}`;
}

/** Sets the tab title to "<page> · QuoteFlow". */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${titlePrefix}${title ? `${title} · QuoteFlow` : 'QuoteFlow'}`;
  }, [title]);
}
