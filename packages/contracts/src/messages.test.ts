import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { CapitalTermsBody, CapacityEvidenceRowBody, EngReviewBody } from './index';

/** DR-engineering-01, DR-pricing-finance-06, DR-approver-leadership-admin-10: plain messages. */
const messages = (schema: z.ZodType, value: unknown) => {
  const r = schema.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe('plain validation messages', () => {
  it('capital terms months name both limits and the unit', () => {
    for (const months of [0, 121, 1.5]) {
      expect(messages(CapitalTermsBody, { termsAmortizationMonths: months })).toEqual([
        'Enter 1 to 120 months',
      ]);
    }
    expect(messages(CapitalTermsBody, { termsAgreementMonths: 241 })).toEqual([
      'Enter 1 to 240 months',
    ]);
  });

  it('engineering numbers name the limits; no zod wording leaks', () => {
    expect(messages(EngReviewBody, { cavitation: 0 })).toEqual([
      'Enter a whole number from 1 to 99',
    ]);
    expect(messages(EngReviewBody, { unitsPerCase: 1.5 })).toEqual([
      'Enter a whole number from 1 to 9,999,999',
    ]);
    const row = {
      site: 'AURORA',
      analysisDate: '2026-10-26',
      analystId: '0190e0b4-7d3a-7c3e-8a1b-111111111111',
    };
    expect(messages(CapacityEvidenceRowBody, { ...row, utilizationBeforePct: 150 })).toEqual([
      'Enter 0 to 100%',
    ]);
  });

  it('any other schema gets plain words with the field name (the global customiser)', () => {
    const schema = z.object({ termsMinSupply: z.string().max(300), other: z.string().max(3) });
    expect(messages(schema, { termsMinSupply: 'x'.repeat(301), other: 'abcd' })).toEqual([
      'Minimum supply / shortfall terms: use 300 characters or fewer',
      'Use 3 characters or fewer',
    ]);
    expect(messages(z.object({ note: z.string().min(1) }), {})).toEqual(['Note: required']);
    for (const m of messages(z.object({ a: z.number().int(), b: z.iso.date() }), {
      a: 1.5,
      b: 'x',
    })) {
      expect(m).not.toMatch(/expected|Too (small|big)|Invalid input/);
    }
  });
});
