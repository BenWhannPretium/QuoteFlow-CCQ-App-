import type { ModelSummaryFieldView } from '@ccq/contracts';
import { describe, expect, it } from 'vitest';

import { formatSummaryValue } from './ModelSummary';

const f = (over: Partial<ModelSummaryFieldView>): ModelSummaryFieldView => ({
  key: 'k',
  label: 'Label',
  unit: 'usd',
  type: 'number',
  sheet: 'Summary',
  ref: 'A1',
  definedName: null,
  state: 'ok',
  number: null,
  text: null,
  date: null,
  headline: false,
  proposed: true,
  ...over,
});

describe('formatSummaryValue (FB-14)', () => {
  it('formats each unit as the workbook holds it (no rounding beyond display)', () => {
    expect(formatSummaryValue(f({ number: 400_000 }))).toBe('$400,000');
    expect(formatSummaryValue(f({ number: 12.5 }))).toBe('$12.50');
    expect(formatSummaryValue(f({ unit: 'percent', number: 0.125 }))).toBe('12.5%');
    expect(formatSummaryValue(f({ unit: 'years', number: -1.5 }))).toBe('-1.5 years');
    expect(formatSummaryValue(f({ unit: 'units', number: 1_000_000 }))).toBe('1,000,000');
    expect(formatSummaryValue(f({ unit: 'text', type: 'text', text: 'Synthetic' }))).toBe(
      'Synthetic',
    );
    expect(formatSummaryValue(f({ type: 'date', unit: 'text', date: '2026-01-15' }))).toBe(
      '2026-01-15',
    );
  });

  it('says plainly what is wrong instead of showing a number', () => {
    expect(formatSummaryValue(f({ state: 'error', text: '#NUM!' }))).toBe('Excel error (#NUM!)');
    expect(formatSummaryValue(f({ state: 'error', text: 'error' }))).toBe('Excel error');
    expect(formatSummaryValue(f({ state: 'blank' }))).toBe('Blank in the workbook');
    expect(formatSummaryValue(f({ state: 'not_calculated' }))).toBe('Not calculated');
    expect(formatSummaryValue(f({ state: 'not_found' }))).toBe('Not found in the workbook');
    expect(formatSummaryValue(f({ state: 'wrong_type', text: '1,000' }))).toBe(
      '“1,000” (text, not a number)',
    );
  });
});
