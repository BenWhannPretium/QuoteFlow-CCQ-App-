import { DomainError } from '../errors';
import type { QuoteNumber } from '../types/ids';

const PATTERN = /^CCQ-(\d{4})-(\d{5})$/;
const MAX_SEQ = 99_999;

/** `formatQuoteNumber(2026, 1)` returns `CCQ-2026-00001`. The DB sequence is per calendar year. */
export function formatQuoteNumber(year: number, seq: number): QuoteNumber {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new DomainError('INVALID_QUOTE_NUMBER', `Year must be a four-digit integer, got ${year}`);
  }
  if (!Number.isInteger(seq) || seq < 1 || seq > MAX_SEQ) {
    throw new DomainError(
      'INVALID_QUOTE_NUMBER',
      `Sequence must be an integer from 1 to ${MAX_SEQ}, got ${seq}`,
    );
  }
  return `CCQ-${year}-${String(seq).padStart(5, '0')}` as QuoteNumber;
}

export interface ParsedQuoteNumber {
  year: number;
  seq: number;
}

/** Returns null (never throws) when the text is not a well-formed quote number. */
export function parseQuoteNumber(text: string): ParsedQuoteNumber | null {
  const match = PATTERN.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const seq = Number(match[2]);
  if (seq < 1) return null;
  return { year, seq };
}

export function isQuoteNumber(text: string): text is QuoteNumber {
  return parseQuoteNumber(text) !== null;
}
