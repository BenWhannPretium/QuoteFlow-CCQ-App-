import { describe, expect, it } from 'vitest';

import {
  commercialInputIssues,
  inapplicableCommercialFields,
  isDeliveredPrice,
  isNonStandardPaymentTerms,
} from './commercial-inputs';
import { evaluateIntake, inapplicableIntakeFields, parseIntakeConfig } from './intake';

/** FB-11 (D-032): payment terms, customer funding, dunnage, delivery and freight, bid reference. */

const STANDARD = ['NET_15', 'NET_30'];
const DELIVERED = ['DELIVERED'];

const config = parseIntakeConfig({
  requiredFields: [{ field: 'sf_opportunity_id', op: 'present' }],
  volumePlaceholder: {},
  defaultRequestClass: 'CCQ',
  allowedRequestClasses: ['CCQ'],
  redirectMessage: 'Stock stays in the pricing application.',
  drawingProvidedCodes: ['HAVE_DRAWING'],
  customCodes: { requested_payment_terms: ['OTHER'] },
  standardPaymentTerms: STANDARD,
  deliveredPriceBasisCodes: DELIVERED,
});

const NOW = new Date('2026-11-09T15:00:00Z');
const base = {
  sf_opportunity_id: '006SYN000000000001',
  customer: { status: 'existing', sf_account_id: '001SYN', name: 'Acme (synthetic)' },
  request_class: 'CCQ',
  has_drawing_attachment: true,
};
const ev = (extra: Record<string, unknown>) => evaluateIntake({ ...base, ...extra }, config, NOW);
const codes = (issues: { code: string; field: string }[]) =>
  issues.map((i) => `${i.code}:${i.field}`);

describe('isNonStandardPaymentTerms (F-080, A-012 provisional)', () => {
  it('flags anything outside the configured standard set', () => {
    expect(isNonStandardPaymentTerms('NET_60', STANDARD)).toBe(true);
    expect(isNonStandardPaymentTerms('NET_120', STANDARD)).toBe(true);
    expect(isNonStandardPaymentTerms('OTHER', STANDARD)).toBe(true);
  });

  it('does not flag the standard terms', () => {
    expect(isNonStandardPaymentTerms('NET_15', STANDARD)).toBe(false);
    expect(isNonStandardPaymentTerms('NET_30', STANDARD)).toBe(false);
  });

  it('does not flag a blank answer: that is a missing value, not a request', () => {
    expect(isNonStandardPaymentTerms(null, STANDARD)).toBe(false);
    expect(isNonStandardPaymentTerms(undefined, STANDARD)).toBe(false);
    expect(isNonStandardPaymentTerms('  ', STANDARD)).toBe(false);
  });

  it('follows the setting: an Admin who adds Net 45 to the standard set clears the flag', () => {
    expect(isNonStandardPaymentTerms('NET_45', STANDARD)).toBe(true);
    expect(isNonStandardPaymentTerms('NET_45', [...STANDARD, 'NET_45'])).toBe(false);
  });
});

describe('freight applies only to a delivered price (F-080)', () => {
  it('isDeliveredPrice reads the codes the list flags as delivered', () => {
    expect(isDeliveredPrice('DELIVERED', DELIVERED)).toBe(true);
    expect(isDeliveredPrice('FOB_PLANT', DELIVERED)).toBe(false);
    expect(isDeliveredPrice(null, DELIVERED)).toBe(false);
    expect(isDeliveredPrice('DELIVERED', [])).toBe(false);
  });

  it('clears freight type and special arrangements for FOB, blank and unknown price bases', () => {
    const cleared = ['freight_type', 'freight_special_arrangements'];
    expect(inapplicableCommercialFields({ price_basis: 'FOB_PLANT' }, DELIVERED)).toEqual(cleared);
    expect(inapplicableCommercialFields({ price_basis: null }, DELIVERED)).toEqual(cleared);
    expect(inapplicableCommercialFields({}, DELIVERED)).toEqual(cleared);
  });

  it('keeps freight for a delivered price', () => {
    expect(inapplicableCommercialFields({ price_basis: 'DELIVERED' }, DELIVERED)).toEqual([]);
  });

  it('inapplicableIntakeFields includes the freight fields when the price is FOB (the store clears them)', () => {
    const fields = inapplicableIntakeFields(
      { price_basis: 'FOB_PLANT', freight_type: 'DROP_TRAILER' },
      config,
    );
    expect(fields).toEqual(
      expect.arrayContaining(['freight_type', 'freight_special_arrangements']),
    );
    expect(
      inapplicableIntakeFields({ price_basis: 'DELIVERED', freight_type: 'VAN' }, config),
    ).not.toContain('freight_type');
  });
});

describe('commercialInputIssues', () => {
  it('blocks only values that cannot be stored (too long)', () => {
    const r = commercialInputIssues(
      { bid_reference: 'x'.repeat(61), freight_special_arrangements: 'y'.repeat(201) },
      { standardPaymentTerms: STANDARD, deliveredPriceBasisCodes: DELIVERED },
    );
    expect(codes(r.blocking)).toEqual([
      'INVALID_VALUE:bid_reference',
      'INVALID_VALUE:freight_special_arrangements',
    ]);
  });

  it('accepts the limits exactly (60 and 200)', () => {
    const r = commercialInputIssues(
      { bid_reference: 'x'.repeat(60), freight_special_arrangements: 'y'.repeat(200) },
      { standardPaymentTerms: STANDARD, deliveredPriceBasisCodes: DELIVERED },
    );
    expect(r.blocking).toEqual([]);
  });

  it('a delivered price without a freight type is a warning, not a block', () => {
    const r = commercialInputIssues(
      { price_basis: 'DELIVERED' },
      { standardPaymentTerms: STANDARD, deliveredPriceBasisCodes: DELIVERED },
    );
    expect(r.blocking).toEqual([]);
    expect(codes(r.warnings)).toEqual(['ENRICH:freight_type']);
  });
});

describe('evaluateIntake with the commercial inputs: optional at submit (D-006 open)', () => {
  it('a missing value is a warning and the intake is still ready', () => {
    const r = ev({});
    expect(r.ready).toBe(true);
    expect(codes(r.warnings)).toEqual(
      expect.arrayContaining(['ENRICH:requested_payment_terms', 'ENRICH:price_basis']),
    );
    expect(codes(r.blocking)).not.toEqual(
      expect.arrayContaining(['MISSING_FIELD:requested_payment_terms']),
    );
  });

  it('a non-standard request is valid: the flag is shown, nothing blocks', () => {
    const r = ev({ requested_payment_terms: 'NET_60', price_basis: 'FOB_PLANT' });
    expect(r.ready).toBe(true);
    expect(codes(r.warnings)).not.toContain('ENRICH:requested_payment_terms');
  });

  it('"Other" payment terms need a short description', () => {
    const missing = ev({ requested_payment_terms: 'OTHER' });
    expect(codes(missing.blocking)).toContain('MISSING_FIELD:requested_payment_terms_other');
    const given = ev({
      requested_payment_terms: 'OTHER',
      requested_payment_terms_other: 'Net 75, paid on receipt',
    });
    expect(codes(given.blocking)).not.toContain('MISSING_FIELD:requested_payment_terms_other');
  });

  it('keeps the "Other" description only for Other', () => {
    expect(
      inapplicableIntakeFields(
        { requested_payment_terms: 'NET_60', requested_payment_terms_other: 'stale' },
        config,
      ),
    ).toContain('requested_payment_terms_other');
    expect(inapplicableIntakeFields({ requested_payment_terms: 'OTHER' }, config)).not.toContain(
      'requested_payment_terms_other',
    );
  });

  it('dunnage, funding and the bid reference never warn when blank', () => {
    const r = ev({ requested_payment_terms: 'NET_30', price_basis: 'FOB_PLANT' });
    const fields = r.warnings.map((w) => w.field);
    expect(fields).not.toContain('bid_reference');
    expect(fields).not.toContain('returnable_dunnage');
    expect(fields).not.toContain('tooling_funding_model');
  });
});
