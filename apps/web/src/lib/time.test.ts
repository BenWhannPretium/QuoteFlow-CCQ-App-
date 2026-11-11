import { describe, expect, it } from 'vitest';

import { absoluteTime, calendarDate, relativeTime, todayCentral } from './time';

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
    ).toBe('Oct 27, 2026, 10:00 AM CDT');
  });

  // DR-kam-sales-leader-13: US Central with the zone named, whatever the browser's zone.
  it('defaults to US Central and names the zone (CDT, then CST after Nov 1)', () => {
    expect(absoluteTime('2026-08-07T02:00:00Z')).toBe('Aug 6, 2026, 9:00 PM CDT');
    expect(absoluteTime('2026-11-10T22:00:00Z')).toBe('Nov 10, 2026, 4:00 PM CST');
  });
});

describe('calendarDate / todayCentral', () => {
  it('shows a calendar date in the one style, never shifted', () => {
    expect(calendarDate('2026-11-30')).toBe('Nov 30, 2026');
    expect(calendarDate('2026-01-01')).toBe('Jan 1, 2026');
    expect(calendarDate(null, '–')).toBe('–');
  });
  it('knows the Central calendar day', () => {
    // 03:00 UTC on Nov 11 is still Nov 10 in Central.
    expect(todayCentral(new Date('2026-11-11T03:00:00Z'))).toBe('2026-11-10');
  });
});
