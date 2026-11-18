import { isApiError } from './api';

/**
 * What a failed load of the quote does to the quote page.
 *
 * `replace`: the page gives way to the error. Always when there is nothing to show, and when the server
 * now says the reader may not see the quote (403) or cannot find it (404): what is on screen is no
 * longer theirs to read.
 *
 * `keep`: a refresh in the background failed (the network dropped, the server hiccuped) while the quote
 * is on screen. The page stays, with a line saying it may be out of date. Replacing it took the
 * Engineering and Quoting tabs off the screen, and with them anything typed and not yet saved (UX-001).
 */
export function quoteLoadFailure(error: unknown, hasData: boolean): 'none' | 'keep' | 'replace' {
  if (!error) return hasData ? 'none' : 'replace';
  if (!hasData) return 'replace';
  return isApiError(error, 403) || isApiError(error, 404) ? 'replace' : 'keep';
}

export const STALE_QUOTE_TEXT =
  'This quote could not be refreshed. What you see may be out of date. Your unsaved changes are still here.';
