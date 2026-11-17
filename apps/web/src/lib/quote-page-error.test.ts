import { describe, expect, it } from 'vitest';

import { ApiError } from './api';
import { quoteLoadFailure } from './quote-page-error';

const apiError = (status: number) => new ApiError({ type: 'about:blank', title: 'x', status });

describe('quoteLoadFailure', () => {
  it('shows the quote when it loaded', () => {
    expect(quoteLoadFailure(null, true)).toBe('none');
  });

  it('gives the page to the error when there is no quote to show', () => {
    expect(quoteLoadFailure(apiError(500), false)).toBe('replace');
    expect(quoteLoadFailure(new TypeError('Failed to fetch'), false)).toBe('replace');
    expect(quoteLoadFailure(apiError(404), false)).toBe('replace');
  });

  it('keeps the page, and what is typed on it, when a background refresh fails', () => {
    expect(quoteLoadFailure(apiError(500), true)).toBe('keep');
    expect(quoteLoadFailure(apiError(503), true)).toBe('keep');
    expect(quoteLoadFailure(new TypeError('Failed to fetch'), true)).toBe('keep');
  });

  it('takes the quote off the screen once the reader may no longer see it', () => {
    expect(quoteLoadFailure(apiError(403), true)).toBe('replace');
    expect(quoteLoadFailure(apiError(404), true)).toBe('replace');
  });
});
