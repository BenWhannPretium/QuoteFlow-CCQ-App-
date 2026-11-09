import { RedirectingError } from '@/auth/session';

import { isApiError } from './api';

/**
 * How a failed query or mutation is shown:
 * - `toast`: server faults (5xx) and network failures. The user can't fix them, so a toast says so.
 * - `inline`: client errors (4xx: forbidden, not found, validation). The screen shows them in place
 *   with <ErrorState> or field errors, next to what the user can act on.
 * - `ignore`: the browser is already navigating to Microsoft sign-in.
 */
export type ErrorPresentation = 'toast' | 'inline' | 'ignore';

export function errorPresentation(err: unknown): ErrorPresentation {
  if (err instanceof RedirectingError) return 'ignore';
  if (isApiError(err)) return err.status >= 500 ? 'toast' : 'inline';
  return 'toast';
}

/** A short title and message for an error, for toasts and <ErrorState>. */
export function describeError(err: unknown): { title: string; message: string } {
  if (isApiError(err)) {
    const { status, title, detail } = err.problem;
    if (status >= 500) {
      return {
        title: 'Something went wrong on our side',
        message: detail ?? 'QuoteFlow couldn’t finish that request. Try again in a moment.',
      };
    }
    return { title, message: detail ?? title };
  }
  if (err instanceof TypeError) {
    // fetch() rejects with a TypeError when the network or the API is unreachable.
    return {
      title: 'Can’t reach QuoteFlow',
      message: 'Check your connection, then try again.',
    };
  }
  return {
    title: 'Something went wrong',
    message: err instanceof Error ? err.message : String(err),
  };
}
