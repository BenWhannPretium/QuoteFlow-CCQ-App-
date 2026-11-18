import { describe, expect, it } from 'vitest';

import { isStaleBuildError } from './stale-build';

describe('isStaleBuildError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://ccq.example/assets/new-CH8x36cK.js',
    'error loading dynamically imported module: https://ccq.example/assets/new-CH8x36cK.js',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/new-B1x.css',
  ])('recognises a page chunk that could not be loaded: %s', (message) => {
    expect(isStaleBuildError(new TypeError(message))).toBe(true);
  });

  it('is false for anything else', () => {
    expect(isStaleBuildError(new Error('Failed to fetch'))).toBe(false);
    expect(isStaleBuildError(new Error('Something went wrong'))).toBe(false);
    expect(isStaleBuildError('Failed to fetch dynamically imported module')).toBe(false);
    expect(isStaleBuildError(undefined)).toBe(false);
  });
});
