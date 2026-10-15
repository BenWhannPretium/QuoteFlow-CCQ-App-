import { useEffect } from 'react';

/** Sets the tab title to "<page> · QuoteFlow". */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · QuoteFlow` : 'QuoteFlow';
  }, [title]);
}
