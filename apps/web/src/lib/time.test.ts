import { describe, expect, it } from 'vitest';

import { absoluteTime, relativeTime } from './time';

const now = new Date('2026-10-27T15:00:00Z');

describe('relativeTime', () => {
  it.each([
    ['2026-10-27T14:59:40Z', 'just now'],
    ['2026-10-27T14:55:00Z', '5 minutes ago'],
    ['2026-10-27T12:00:00Z', '3 hours ago'],
    ['2026-10-26T15:00:00Z', 'yesterday'],
    ['2026-10-13T15:00:00Z', '2 weeks ago'],
    ['2026-10-29T15:00:00Z', 'in 2 days'],
  ])('%s → %s', (iso, text) => {
    expect(relativeTime(iso, now, 'en-US')).toBe(text);
  });
});

describe('absoluteTime', () => {
  it('formats in the given zone', () => {
    expect(
      absoluteTime('2026-10-27T15:00:00Z', { locale: 'en-US', timeZone: 'America/Chicago' }),
    ).toBe('Oct 27, 2026, 10:00 AM');
  });
});
