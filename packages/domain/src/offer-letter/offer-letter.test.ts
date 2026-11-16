import { describe, expect, it } from 'vitest';

import {
  OFFER_DRAFT_TEXT,
  OFFER_LETTER_TEMPLATE_SEED,
  buildOfferLetterModel,
  evaluateOfferReadiness,
  fillTokens,
  formatUsd,
  longDate,
  offerWarnings,
  parseOfferLetterBlockIfCostingChanged,
  parseOfferLetterTemplate,
  parseOfferLetterWordingApproved,
  partDescription,
  toCharge,
  toPer1000,
  type OfferCostingField,
  type OfferFacts,
  type OfferItemFacts,
  type OfferSettings,
} from '.';
import { DomainError } from '../errors';

const APPROVED = new Date('2026-11-10T15:00:00Z');

function item(itemNo: number, over: Partial<OfferItemFacts> = {}): OfferItemFacts {
  return {
    id: `00000000-0000-7000-8000-00000000000${itemNo}`,
    itemNo,
    label: `${itemNo * 8} oz bottle`,
    containerSize: null,
    standardDescription: 'Round, 38-400',
    plantLabel: 'Plant A',
    annualVolume: 100_000 * itemNo,
    specs: { material: 'PET', color: 'Clear' },
    ...over,
  };
}

function price(
  itemNo: number | null,
  key: string,
  n: number | null,
  extra: Partial<OfferCostingField> = {},
): OfferCostingField {
  return {
    key,
    itemNo,
    unit: key === 'offer_piece_price' ? 'usd_per_unit' : 'usd_per_1000',
    state: n === null ? 'blank' : 'ok',
    number: n,
    ...extra,
  };
}

function facts(over: Partial<OfferFacts> = {}): OfferFacts {
  return {
    quoteNumber: 'CCQ-2026-00042',
    quoteVersion: 1,
    stageKey: 'CUSTOMER_DECISION',
    stageName: 'Customer Decision',
    onHold: false,
    proposalIssuedAt: APPROVED,
    validityUntil: '2026-12-10',
    approvedAt: APPROVED,
    customerName: 'Synthetic Beverage Co',
    kamName: 'Kim Example',
    toolingFundingModel: 'COMPANY_FUNDED',
    termLabels: {
      paymentTerms: 'Net 30',
      priceBasis: 'FOB plant',
      freight: 'customer pickup',
      toolingFunding: 'Company-funded',
      moldOwnership: null,
    },
    items: [item(1)],
    summaryVisible: true,
    costing: {
      attachmentId: '00000000-0000-7000-8000-0000000000aa',
      version: 2,
      fileName: 'costing.xlsx',
      uploadedAt: new Date('2026-11-09T12:00:00Z'),
      uploadedByName: 'Pat Pricing',
      status: 'complete',
      reasonText: null,
      fields: [price(1, 'offer_piece_price', 0.0825)],
    },
    ...over,
  };
}

const settings = (over: Partial<OfferSettings> = {}): OfferSettings => ({
  template: OFFER_LETTER_TEMPLATE_SEED,
  wordingApproved: false,
  blockIfCostingChanged: true,
  ...over,
});

const codes = (f: OfferFacts, s = settings()) =>
  evaluateOfferReadiness(f, s).blockers.map((b) => b.code);

describe('money (exact decimals)', () => {
  it('converts a per-piece price to per 1,000 with four decimals', () => {
    expect(toPer1000(0.0825, 'usd_per_unit')).toBe('82.5000');
    expect(toPer1000(0.08253, 'usd_per_unit')).toBe('82.5300');
    expect(toPer1000('0.0825371', 'usd_per_unit')).toBe('82.5371');
    expect(toPer1000('0.08253715', 'usd_per_unit')).toBe('82.5372');
    expect(toPer1000(0.1, 'usd_per_unit')).toBe('100.0000');
  });
  it('keeps a per-1,000 price as it is', () => {
    expect(toPer1000(82.5, 'usd_per_1000')).toBe('82.5000');
    expect(toPer1000('1234.56789', 'usd_per_1000')).toBe('1234.5679');
  });
  it('avoids floating-point drift', () => {
    // 0.1 + 0.2 style values: 0.07 * 1000 = 70.00000000000001 in floating point.
    expect(toPer1000(0.07, 'usd_per_unit')).toBe('70.0000');
    expect(toPer1000(1.005, 'usd_per_unit')).toBe('1005.0000');
  });
  it('formats $#,##0.00 half away from zero', () => {
    expect(formatUsd('82.5000')).toBe('$82.50');
    expect(formatUsd('1234567.8950')).toBe('$1,234,567.90');
    expect(formatUsd('0.0049')).toBe('$0.00');
    expect(formatUsd('-12.3450')).toBe('-$12.35');
    expect(toCharge(45000)).toBe('45000.0000');
  });
});

describe('config', () => {
  it('accepts the seed and defaults the settings', () => {
    expect(parseOfferLetterTemplate(OFFER_LETTER_TEMPLATE_SEED)).toEqual(
      OFFER_LETTER_TEMPLATE_SEED,
    );
    expect(parseOfferLetterTemplate(undefined)).toBe(OFFER_LETTER_TEMPLATE_SEED);
    expect(parseOfferLetterWordingApproved(undefined)).toBe(false);
    expect(parseOfferLetterBlockIfCostingChanged(undefined)).toBe(true);
    expect(() => parseOfferLetterWordingApproved('yes')).toThrow(DomainError);
  });
  it('rejects an unknown token and stray braces', () => {
    const bad = (text: string) => ({
      ...OFFER_LETTER_TEMPLATE_SEED,
      assumptions: [{ text, points: [] }],
    });
    expect(() => parseOfferLetterTemplate(bad('Price is {{secretMargin}}.'))).toThrow(
      /unknown token \{\{secretMargin\}\}/,
    );
    expect(() => parseOfferLetterTemplate(bad('Price is {{ quoteNumber.'))).toThrow(/"\{\{"/);
    expect(() => parseOfferLetterTemplate(bad('Valid until {{ validUntil }}.'))).not.toThrow();
    expect(() =>
      parseOfferLetterTemplate({ ...OFFER_LETTER_TEMPLATE_SEED, title: 'Offer {{quoteNumber}}' }),
    ).toThrow(/labels take no tokens/);
  });
  it('rejects a duplicate specification row', () => {
    expect(() =>
      parseOfferLetterTemplate({
        ...OFFER_LETTER_TEMPLATE_SEED,
        specifications: [
          { fact: 'color', label: 'Color' },
          { fact: 'color', label: 'Colour' },
        ],
      }),
    ).toThrow(/listed twice/);
  });
});

describe('tokens', () => {
  it('fills tokens and drops a sentence whose token has no value', () => {
    expect(fillTokens('Payment terms: {{paymentTerms}}.', { paymentTerms: 'Net 30' })).toBe(
      'Payment terms: Net 30.',
    );
    expect(fillTokens('Mold ownership: {{moldOwnership}}.', { moldOwnership: null })).toBeNull();
    expect(fillTokens('Mold ownership: {{moldOwnership}}.', { moldOwnership: '  ' })).toBeNull();
    expect(fillTokens('No tokens here.', {})).toBe('No tokens here.');
  });
  it('never re-expands a value that looks like a token', () => {
    expect(fillTokens('To {{customerName}}', { customerName: '{{quoteNumber}}' })).toBe(
      'To {{quoteNumber}}',
    );
  });
});

describe('evaluateOfferReadiness', () => {
  it('is ready for an approved one-item quote with a piece price', () => {
    const r = evaluateOfferReadiness(facts(), settings());
    expect(r.canGenerate).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(['wording_not_approved']);
  });

  it('refuses before Final Review approves (and says nothing else)', () => {
    const r = evaluateOfferReadiness(
      facts({ stageKey: 'FINAL_REVIEW', stageName: 'Final Review' }),
      settings(),
    );
    expect(r.blockers.map((b) => b.code)).toEqual(['not_customer_decision']);
    expect(r.blockers[0]!.message).toContain('Final Review');
  });

  it('refuses on hold, unreleased, without a customer or items', () => {
    expect(codes(facts({ onHold: true }))).toContain('on_hold');
    expect(codes(facts({ proposalIssuedAt: null }))).toContain('not_released');
    expect(codes(facts({ validityUntil: null }))).toContain('not_released');
    expect(codes(facts({ customerName: ' ' }))).toContain('no_customer');
    expect(codes(facts({ items: [] }))).toContain('no_items');
  });

  it('refuses without a costing workbook, a visible summary or a complete one', () => {
    expect(codes(facts({ costing: null }))).toEqual(['no_costing']);
    expect(codes(facts({ summaryVisible: false }))).toEqual(['summary_hidden']);
    const partial = facts();
    partial.costing = {
      ...partial.costing!,
      status: 'unavailable',
      reasonText:
        'This workbook does not match a known template, so no summary is shown. The file is stored.',
    };
    const r = evaluateOfferReadiness(partial, settings());
    expect(r.blockers.map((b) => b.code)).toEqual(['summary_not_complete']);
    expect(r.blockers[0]!.message).toMatch(
      /^The costing workbook has no readable price summary \(This workbook does not match a known template.*\)\. Ask Pricing to fix the workbook or an Admin to set up the template\.$/,
    );
  });

  it('refuses a costing workbook uploaded after the G4 approval, unless switched off', () => {
    const f = facts();
    f.costing = { ...f.costing!, uploadedAt: new Date('2026-11-12T00:00:00Z') };
    expect(codes(f)).toEqual(['costing_changed']);
    expect(codes(f, settings({ blockIfCostingChanged: false }))).toEqual([]);
  });

  it('refuses an item with no plant or no piece price', () => {
    expect(codes(facts({ items: [item(1, { plantLabel: null })] }))).toEqual(['no_plant']);
    const f = facts({ items: [item(1), item(2)] });
    const r = evaluateOfferReadiness(f, settings());
    expect(r.blockers).toEqual([
      expect.objectContaining({ code: 'missing_piece_price', itemNo: 2 }),
    ]);
    expect(r.blockers[0]!.message).toMatch(/^Item 2 has no piece price/);
  });

  it('refuses an unusable price (error, text, zero, negative)', () => {
    const with_ = (field: OfferCostingField) => {
      const f = facts();
      f.costing = { ...f.costing!, fields: [field] };
      return evaluateOfferReadiness(f, settings()).blockers;
    };
    expect(
      with_(price(1, 'offer_piece_price', null, { state: 'error', number: null }))[0],
    ).toMatchObject({ code: 'invalid_price' });
    expect(with_(price(1, 'offer_piece_price', 0))[0]!.message).toContain('not above zero');
    expect(with_(price(1, 'offer_piece_price', -1))[0]!.code).toBe('invalid_price');
    expect(with_(price(1, 'offer_piece_price', 1, { unit: 'usd' }))[0]!.message).toContain(
      'unknown unit',
    );
  });

  it('requires molds only when the customer funds tooling', () => {
    expect(codes(facts({ toolingFundingModel: 'CUSTOMER_FUNDED' }))).toEqual([
      'missing_required_row',
    ]);
    expect(codes(facts({ toolingFundingModel: 'SHARED' }))).toEqual(['missing_required_row']);
    expect(codes(facts({ toolingFundingModel: 'AMORTIZED' }))).toEqual([]);
    expect(codes(facts({ toolingFundingModel: null }))).toEqual([]);
    const f = facts({ toolingFundingModel: 'CUSTOMER_FUNDED' });
    f.costing = {
      ...f.costing!,
      fields: [
        ...f.costing!.fields,
        price(1, 'offer_mold_charge', 45000, { unit: 'usd_per_1000' }),
      ],
    };
    expect(codes(f)).toEqual([]);
    // A $0 mold charge is "no charge": still missing when molds are required.
    f.costing = {
      ...f.costing,
      fields: [price(1, 'offer_piece_price', 0.1), price(1, 'offer_mold_charge', 0)],
    };
    expect(codes(f)).toEqual(['missing_required_row']);
  });

  it('follows the config: change parts made required', () => {
    const template = {
      ...OFFER_LETTER_TEMPLATE_SEED,
      rows: {
        ...OFFER_LETTER_TEMPLATE_SEED.rows,
        changeParts: { label: 'Change parts', required: 'always' as const },
      },
    };
    const r = evaluateOfferReadiness(facts(), settings({ template }));
    expect(r.blockers.map((b) => b.code)).toEqual(['missing_required_row']);
    expect(r.blockers[0]!.message).toContain('required on every letter');
  });

  it('applies an item-less field only on a one-item quote', () => {
    const f = facts();
    f.costing = { ...f.costing!, fields: [price(null, 'offer_piece_price', 0.2)] };
    expect(codes(f)).toEqual([]);
    const g = facts({ items: [item(1), item(2)] });
    g.costing = { ...g.costing!, fields: [price(null, 'offer_piece_price', 0.2)] };
    expect(codes(g)).toEqual(['missing_piece_price', 'missing_piece_price']);
  });

  it('warns (advisory) about the wording, Attention and Part #', () => {
    const f = facts({ items: [item(1), item(2)] });
    expect(offerWarnings(f, { wordingApproved: true }, null)).toEqual([]);
    const w = offerWarnings(
      f,
      { wordingApproved: false },
      { attention: ' ', partNumbers: { 1: 'P-1' } },
    );
    expect(w.map((x) => x.code)).toEqual([
      'wording_not_approved',
      'no_attention',
      'no_part_number',
    ]);
    expect(w[2]!.message).toContain('item 2');
    expect(
      offerWarnings(
        f,
        { wordingApproved: true },
        { attention: 'Alex', partNumbers: { 1: 'A', 2: 'B' } },
      ),
    ).toEqual([]);
  });
});

describe('buildOfferLetterModel', () => {
  const inputs = { attention: 'Alex Buyer', partNumbers: { 1: 'SB-100' } };

  it('lays out a one-item letter', () => {
    const f = facts();
    const m = buildOfferLetterModel(f, inputs, settings());
    expect(m.draft).toBe(true);
    expect(m.draftText).toBe(OFFER_DRAFT_TEXT);
    expect(m.header).toEqual({
      to: 'Synthetic Beverage Co',
      attention: 'Alex Buyer',
      date: '2026-11-10',
      dateText: 'November 10, 2026',
      quoteNumber: 'CCQ-2026-00042',
      validUntil: '2026-12-10',
      validUntilText: 'December 10, 2026',
    });
    expect(m.introduction).toBe(
      'Thank you for the opportunity to quote. We are pleased to offer Synthetic Beverage Co the pricing below for quote CCQ-2026-00042.',
    );
    expect(m.items).toEqual([
      expect.objectContaining({
        itemNo: 1,
        name: '8 oz bottle',
        partDescription: '8 oz bottle · Round, 38-400',
        partNumber: 'SB-100',
        placeOfManufacture: 'Plant A',
        annualVolumeText: '100,000 pcs',
      }),
    ]);
    expect(m.pricing.rows[0]).toMatchObject({
      piecePricePer1000: '82.5000',
      piecePricePer1000Text: '$82.50',
      moldCharge: null,
    });
    expect(m.pricing.showMolds).toBe(false);
    expect(m.pricing.showChangeParts).toBe(false);
    // Optional rows with no value are omitted, never printed as zero.
    expect(JSON.stringify(m)).not.toMatch(/\$0\.00|N\/A|undefined|NaN|\{\{/);
    expect(m.signer).toEqual({ name: 'Kim Example', company: 'Pretium Packaging' });
    expect(m.footer).toEqual({ note: 'Confidential', legalEntity: null, address: null });
  });

  it('fills the assumptions and drops a sentence with no value', () => {
    const m = buildOfferLetterModel(facts(), inputs, settings());
    const texts = m.assumptions.items.map((a) => a.text);
    expect(texts).toContain('This offer is valid until December 10, 2026.');
    expect(texts).toContain('Pricing is FOB plant, customer pickup.');
    expect(texts).toContain('Payment terms: Net 30 from date of invoice.');
    expect(texts).toContain('Tooling funding: Company-funded.');
    expect(texts.some((t) => t.startsWith('Mold ownership'))).toBe(false);
    const tooling = m.assumptions.items.find((a) => a.text === 'Tooling payment terms:');
    expect(tooling?.points).toHaveLength(2);
  });

  it('hides the validity line and date when showValidity is off', () => {
    const template = { ...OFFER_LETTER_TEMPLATE_SEED, showValidity: false };
    const m = buildOfferLetterModel(facts(), inputs, settings({ template }));
    expect(m.header.validUntilText).toBeNull();
    expect(m.assumptions.items.some((a) => a.text.includes('valid until'))).toBe(false);
  });

  it('drops the DRAFT line once Legal approves', () => {
    const m = buildOfferLetterModel(facts(), inputs, settings({ wordingApproved: true }));
    expect(m.draft).toBe(false);
    expect(m.draftText).toBeNull();
  });

  it('lays out three items with a row each and the columns some item has', () => {
    const f = facts({
      items: [
        item(1),
        item(2, { specs: { material: 'HDPE' } }),
        item(3, { plantLabel: 'Plant B', specs: {} }),
      ],
    });
    f.costing = {
      ...f.costing!,
      fields: [
        price(1, 'offer_piece_price', 0.0825),
        price(2, 'offer_piece_price', 0.091),
        price(3, 'offer_piece_price', 120.5, { unit: 'usd_per_1000' }),
        price(2, 'offer_mold_charge', 38500.5),
        price(1, 'offer_change_parts_charge', null, { state: 'not_found' }),
      ],
    };
    expect(codes(f)).toEqual([]);
    const m = buildOfferLetterModel(f, { attention: null, partNumbers: { 2: 'B-2' } }, settings());
    expect(m.items.map((i) => i.name)).toEqual(['Item 1', 'Item 2', 'Item 3']);
    expect(m.items.map((i) => i.partNumber)).toEqual([null, 'B-2', null]);
    expect(m.pricing.rows.map((r) => r.piecePricePer1000Text)).toEqual([
      '$82.50',
      '$91.00',
      '$120.50',
    ]);
    expect(m.pricing.rows.map((r) => r.moldChargeText)).toEqual([null, '$38,500.50', null]);
    expect(m.pricing.showMolds).toBe(true);
    expect(m.pricing.showChangeParts).toBe(false);
    expect(m.pricing.rows[2]!.placeOfManufacture).toBe('Plant B');
    expect(m.header.attention).toBeNull();
    expect(m.specifications).toEqual({
      heading: 'Specifications',
      itemNames: ['Item 1', 'Item 2', 'Item 3'],
      rows: [
        { label: 'Material (resin type)', values: ['PET', 'HDPE', null] },
        { label: 'Color', values: ['Clear', null, null] },
      ],
    });
  });

  it('builds a part description without repeating itself', () => {
    expect(
      partDescription(
        item(1, { label: '16 oz bottle', containerSize: '16 oz', standardDescription: null }),
      ),
    ).toBe('16 oz bottle');
    expect(
      partDescription(item(4, { label: null, containerSize: null, standardDescription: null })),
    ).toBe('Item 4');
  });

  it('formats long dates on the calendar date given', () => {
    expect(longDate('2026-01-01')).toBe('January 1, 2026');
    expect(longDate('2026-12-31')).toBe('December 31, 2026');
  });
});
