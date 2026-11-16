import {
  OFFER_LETTER_TEMPLATE_SEED,
  buildOfferLetterModel,
  type OfferFacts,
  type OfferItemFacts,
  type OfferLetterModel,
  type OfferSettings,
} from '@ccq/domain';

/**
 * FB-20: sample offer letters for the renderer's tests and for looking at the layout in Word
 * (`pnpm --filter @ccq/api offer-letter:sample <folder>`). Synthetic only (rule 8): every name, number
 * and price below is made up.
 *
 * `blank` is the rebranded Standard Quote Template itself: the letter with `[Brackets]` where a quote's
 * facts go, for the template owner and Legal to review.
 */

const item = (itemNo: number, over: Partial<OfferItemFacts>): OfferItemFacts => ({
  id: null,
  itemNo,
  label: null,
  containerSize: null,
  standardDescription: null,
  plantLabel: null,
  annualVolume: null,
  specs: {},
  ...over,
});

const SYNTHETIC: OfferFacts = {
  quoteNumber: 'CCQ-2026-00042',
  quoteVersion: 1,
  stageKey: 'CUSTOMER_DECISION',
  stageName: 'Customer Decision',
  onHold: false,
  proposalIssuedAt: new Date('2026-11-16T16:00:00Z'),
  validityUntil: '2026-12-16',
  approvedAt: new Date('2026-11-16T16:00:00Z'),
  customerName: 'Northwind Synthetic Beverages',
  kamName: 'Jordan Example',
  toolingFundingModel: 'CUSTOMER_FUNDED',
  termLabels: {
    paymentTerms: 'Net 30',
    priceBasis: 'FOB plant of manufacture',
    freight: 'freight collect',
    toolingFunding: 'Customer-funded',
    moldOwnership: 'Customer-owned',
  },
  items: [
    item(1, {
      label: '16 oz round bottle',
      containerSize: '16 oz',
      standardDescription: 'Round, 38-400 neck',
      plantLabel: 'Plant A (synthetic)',
      annualVolume: 1_200_000,
      specs: {
        material: 'PET',
        color: 'Clear',
        cavities: '8',
        gramWeight: '24.5 g',
        neckFinish: '38-400',
        decoration: 'Pressure-sensitive label',
        packaging: 'Bulk on pallet',
      },
    }),
    item(2, {
      label: '32 oz oblong bottle',
      standardDescription: 'Oblong, 38-400 neck, handle',
      plantLabel: 'Plant A (synthetic)',
      annualVolume: 650_000,
      specs: {
        material: 'HDPE',
        color: 'White',
        cavities: '6',
        gramWeight: '48 g',
        neckFinish: '38-400',
        packaging: 'Bulk on pallet',
      },
    }),
    item(3, {
      label: '38 mm closure',
      standardDescription: 'Ribbed, 38-400 continuous thread',
      plantLabel: 'Plant B (synthetic)',
      annualVolume: 1_850_000,
      specs: {
        material: 'PP',
        color: 'White',
        cavities: '32',
        gramWeight: '3.1 g',
        neckFinish: '38-400',
      },
    }),
  ],
  summaryVisible: true,
  costing: {
    attachmentId: '00000000-0000-7000-8000-000000000001',
    version: 2,
    fileName: 'synthetic-costing.xlsx',
    uploadedAt: new Date('2026-11-12T15:00:00Z'),
    uploadedByName: 'Pat Pricing',
    status: 'complete',
    reasonText: null,
    fields: [
      { key: 'offer_piece_price', itemNo: 1, unit: 'usd_per_unit', state: 'ok', number: 0.08253 },
      { key: 'offer_piece_price', itemNo: 2, unit: 'usd_per_unit', state: 'ok', number: 0.1415 },
      { key: 'offer_piece_price', itemNo: 3, unit: 'usd_per_1000', state: 'ok', number: 21.75 },
      { key: 'offer_mold_charge', itemNo: 1, unit: 'usd_per_1000', state: 'ok', number: 48500 },
      { key: 'offer_mold_charge', itemNo: 2, unit: 'usd_per_1000', state: 'ok', number: 52250 },
      { key: 'offer_mold_charge', itemNo: 3, unit: 'usd_per_1000', state: 'ok', number: 61000 },
      {
        key: 'offer_change_parts_charge',
        itemNo: 2,
        unit: 'usd_per_1000',
        state: 'ok',
        number: 6800,
      },
    ],
  },
};

const SETTINGS: OfferSettings = {
  template: OFFER_LETTER_TEMPLATE_SEED,
  wordingApproved: false,
  blockIfCostingChanged: true,
};

export function syntheticOfferLetter(
  over: { items?: 1 | 3; wordingApproved?: boolean; customerName?: string } = {},
): OfferLetterModel {
  const facts: OfferFacts = {
    ...SYNTHETIC,
    ...(over.customerName !== undefined ? { customerName: over.customerName } : {}),
    items: over.items === 1 ? SYNTHETIC.items.slice(0, 1) : SYNTHETIC.items,
  };
  return buildOfferLetterModel(
    facts,
    {
      attention: 'Alex Buyer, Packaging Procurement',
      partNumbers: { 1: 'NW-16R-001', 2: 'NW-32O-002' },
    },
    { ...SETTINGS, wordingApproved: over.wordingApproved ?? false },
  );
}

/** The rebranded template: the letter's layout and wording with `[Brackets]` for a quote's facts. */
export function blankOfferLetterTemplate(): OfferLetterModel {
  const m = buildOfferLetterModel(
    {
      ...SYNTHETIC,
      quoteNumber: '[CCQ-YYYY-NNNNN]',
      customerName: '[Customer]',
      kamName: '[Key Account Manager]',
      termLabels: {
        paymentTerms: '[Payment terms]',
        priceBasis: '[Price basis]',
        freight: '[Freight]',
        toolingFunding: '[Tooling funding]',
        moldOwnership: '[Mold ownership]',
      },
      items: [
        item(1, {
          label: '[Part description]',
          plantLabel: '[Place of manufacture]',
          annualVolume: null,
          specs: {
            material: '[Resin]',
            color: '[Color]',
            cavities: '[Cavities]',
            gramWeight: '[Gram weight]',
            neckFinish: '[Neck finish]',
            decoration: '[Decoration]',
            packaging: '[Packaging]',
          },
        }),
      ],
    },
    { attention: '[Attention]', partNumbers: { 1: '[Part #]' } },
    SETTINGS,
  );
  return {
    ...m,
    header: {
      ...m.header,
      dateText: '[Date]',
      validUntilText: '[Valid until]',
    },
    assumptions: {
      ...m.assumptions,
      items: m.assumptions.items.map((a) => ({
        ...a,
        text: a.text.replace(/December 16, 2026/, '[Valid until]'),
      })),
    },
    items: m.items.map((i) => ({ ...i, annualVolumeText: '[Annual volume] pcs' })),
    pricing: {
      ...m.pricing,
      rows: m.pricing.rows.map((r) => ({
        ...r,
        annualVolumeText: '[Annual volume] pcs',
        piecePricePer1000Text: '$[0.00]',
        moldChargeText: '$[0.00]',
        changePartsChargeText: '$[0.00]',
      })),
      showMolds: true,
      showChangeParts: true,
    },
  };
}
