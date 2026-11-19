/**
 * The offer letter template as FB-20's migration 0048 wrote it (`templateVersion` fb20-2026-11-16), so a
 * migration test can start from the state an environment had, whatever the seed says today. FB-24's 0051
 * adds the concept sentence ({{conceptAssumptions}}) where this is still the stored value.
 */
export const OFFER_LETTER_TEMPLATE_0048: Record<string, unknown> = {
  templateVersion: 'fb20-2026-11-16',
  provisional: true,
  legalApproved: false,
  eyebrow: 'Customer offer',
  title: 'Offer Letter',
  introduction:
    'Thank you for the opportunity to quote. We are pleased to offer {{customerName}} the pricing below for quote {{quoteNumber}}.',
  itemsHeading: 'Items quoted',
  pricingHeading: 'Pricing (USD)',
  rows: {
    piecePrice: {
      label: 'Piece price per 1,000 pcs',
      required: 'always',
    },
    molds: {
      label: 'Molds',
      required: 'when_customer_funds_tooling',
    },
    changeParts: {
      label: 'Change parts',
      required: 'never',
    },
  },
  customerFundedToolingModels: ['CUSTOMER_FUNDED', 'ZERO_CER', 'SHARED'],
  specificationsHeading: 'Specifications',
  specifications: [
    {
      fact: 'material',
      label: 'Material (resin type)',
    },
    {
      fact: 'color',
      label: 'Color',
    },
    {
      fact: 'cavities',
      label: 'Number of cavities',
    },
    {
      fact: 'gramWeight',
      label: 'Gram weight',
    },
    {
      fact: 'neckFinish',
      label: 'Neck finish',
    },
    {
      fact: 'decoration',
      label: 'Decoration',
    },
    {
      fact: 'packaging',
      label: 'Packaging',
    },
  ],
  assumptionsHeading: 'Pricing assumptions',
  assumptions: [
    {
      text: 'Pricing does not include pallet costs.',
      points: [],
    },
    {
      text: 'Pricing of pallets is subject to change at the time of shipping due to market conditions.',
      points: [],
    },
    {
      text: 'This offer is valid until {{validUntil}}.',
      points: [],
    },
    {
      text: 'Price basis: {{priceBasis}}.',
      points: [],
    },
    {
      text: 'Freight: {{freight}}.',
      points: [],
    },
    {
      text: 'Payment terms: {{paymentTerms}} from date of invoice.',
      points: [],
    },
    {
      text: 'Lead time to be confirmed at time of Purchase Order.',
      points: [],
    },
    {
      text: 'Standard Pretium Quality specifications apply.',
      points: [],
    },
    {
      text: 'Pretium specified resin applies.',
      points: [],
    },
    {
      text: 'Tooling funding: {{toolingFunding}}.',
      points: [],
    },
    {
      text: 'Mold ownership: {{moldOwnership}}.',
      points: [],
    },
    {
      text: 'Tooling payment terms:',
      points: [
        'If < $25,000, 50% with order, 50% upon approval of samples.',
        'If > $25,000, 1/3 with order, 1/3 upon completion of molds, 1/3 upon approval of samples.',
      ],
    },
    {
      text: 'Final price is subject to change based on final specifications, mold qualification and any resulting change in process conditions.',
      points: [],
    },
    {
      text: "All prices will be subject to resin and other raw material escalation and reduction. Pricing is based on the previous month's CDI resin costs as of the offer date.",
      points: [],
    },
    {
      text: 'Pretium standard terms & conditions apply.',
      points: [],
    },
  ],
  showValidity: true,
  closing:
    'We appreciate the opportunity to support your packaging program and look forward to working with you.',
  signOff: 'Yours sincerely,',
  signerCompany: 'Pretium Packaging',
  footerNote: 'Confidential',
  legalEntity: '',
  address: '',
};
