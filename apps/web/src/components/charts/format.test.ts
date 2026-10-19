import { describe, expect, it } from 'vitest';

import {
  DASH,
  dayRange,
  fmtCount,
  fmtDays,
  fmtPct,
  fmtUsd,
  fmtUsdCompact,
  weekLabel,
} from './format';

describe('chart formatting', () => {
  it('shows a missing value as a dash, never as 0', () => {
    for (const f of [fmtCount, fmtPct, fmtDays, fmtUsd, fmtUsdCompact]) {
      expect(f(null)).toBe(DASH);
      expect(f(undefined)).toBe(DASH);
    }
  });

  it('keeps a real zero as 0', () => {
    expect(fmtCount(0)).toBe('0');
    expect(fmtPct(0)).toBe('0%');
    expect(fmtDays(0)).toBe('0 d');
  });

  it('formats rates to one decimal and days to one decimal', () => {
    expect(fmtPct(0.4)).toBe('40%');
    expect(fmtPct(6 / 7)).toBe('85.7%');
    expect(fmtDays(8.5)).toBe('8.5 d');
    expect(fmtDays(2.04)).toBe('2 d');
  });

  it('formats amounts', () => {
    expect(fmtUsd(1500)).toBe('$1,500');
    expect(fmtUsdCompact(1_250_000)).toBe('$1.3M');
  });

  it('labels a week by its calendar day, with no time zone shift', () => {
    expect(weekLabel('2026-10-12')).toBe('Oct 12');
    expect(weekLabel('2026-01-01')).toBe('Jan 1');
    expect(dayRange('2026-08-06', '2026-11-03')).toBe('Aug 6 – Nov 3, 2026');
  });
});
