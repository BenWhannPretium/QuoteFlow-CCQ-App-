import { describe, expect, it } from 'vitest';

import { formatQuoteNumber, isQuoteNumber, parseQuoteNumber } from '.';
import { DomainError } from '../errors';

describe('quote numbers', () => {
  it('formats CCQ-YYYY-NNNNN', () => {
    expect(formatQuoteNumber(2026, 1)).toBe('CCQ-2026-00001');
    expect(formatQuoteNumber(2026, 412)).toBe('CCQ-2026-00412');
    expect(formatQuoteNumber(2027, 99_999)).toBe('CCQ-2027-99999');
  });

  it.each([
    [26, 1],
    [2026.5, 1],
    [12_345, 1],
    [2026, 0],
    [2026, -3],
    [2026, 100_000],
    [2026, 1.5],
  ])('rejects year %s / seq %s', (year, seq) => {
    expect(() => formatQuoteNumber(year, seq)).toThrow(DomainError);
    try {
      formatQuoteNumber(year, seq);
    } catch (error) {
      expect((error as DomainError).code).toBe('INVALID_QUOTE_NUMBER');
    }
  });

  it('parses and round-trips', () => {
    expect(parseQuoteNumber('CCQ-2026-00042')).toEqual({ year: 2026, seq: 42 });
    expect(parseQuoteNumber(formatQuoteNumber(2031, 7))).toEqual({ year: 2031, seq: 7 });
  });

  it.each([
    '',
    'CCQ-2026-0001',
    'CCQ-2026-000001',
    'ccq-2026-00001',
    'CCQ-26-00001',
    'CCQ-2026-00000',
    ' CCQ-2026-00001',
    'ERF-2026-00001',
  ])('does not accept %j', (text) => {
    expect(parseQuoteNumber(text)).toBeNull();
    expect(isQuoteNumber(text)).toBe(false);
  });

  it('validates', () => {
    expect(isQuoteNumber('CCQ-2026-00001')).toBe(true);
  });
});
