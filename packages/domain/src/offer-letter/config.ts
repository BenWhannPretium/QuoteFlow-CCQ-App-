import { z } from 'zod';

import { DomainError } from '../errors';

/**
 * FB-20 (F-070): the offer letter's wording and layout choices are **config, not code** (rule 4).
 * `app_setting.offer_letter_template` holds every business sentence on the letter, the row labels and
 * the rules for which price rows are required. It is seeded from the old Standard Quote Template
 * (`feedback/inputs/offer-letter-template-structure.md`), provisional and not approved by Legal; an
 * Admin edits it in the console without a deploy.
 *
 * Text is data, never markup: the renderer writes it through the Word library's text API. A sentence
 * may hold only the whitelisted `{{tokens}}` below; any other token makes the setting invalid.
 */

export const OFFER_LETTER_TOKENS = [
  'quoteNumber',
  'customerName',
  'validUntil',
  'paymentTerms',
  'priceBasis',
  'freight',
  'toolingFunding',
  'moldOwnership',
] as const;
export type OfferLetterToken = (typeof OFFER_LETTER_TOKENS)[number];

const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** The tokens a sentence uses, and any problem with it (an unknown token, a stray brace). */
export function sentenceTokens(text: string): { tokens: OfferLetterToken[]; error: string | null } {
  const tokens: OfferLetterToken[] = [];
  let error: string | null = null;
  for (const m of text.matchAll(TOKEN)) {
    const name = m[1] ?? '';
    if ((OFFER_LETTER_TOKENS as readonly string[]).includes(name)) {
      tokens.push(name as OfferLetterToken);
    } else {
      error = `unknown token {{${name}}} (allowed: ${OFFER_LETTER_TOKENS.map((t) => `{{${t}}}`).join(', ')})`;
    }
  }
  const rest = text.replace(TOKEN, '');
  if (!error && (rest.includes('{{') || rest.includes('}}'))) {
    error = 'a "{{" or "}}" that is not part of a token';
  }
  return { tokens, error };
}

const sentence = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .superRefine((s, ctx) => {
      const { error } = sentenceTokens(s);
      if (error) ctx.addIssue({ code: 'custom', message: error });
    });

/** Plain text with no token (labels, headings). */
const label = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !s.includes('{{') && !s.includes('}}'), 'labels take no tokens');

/** Optional free text (the legal entity, the address); blank = not printed. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !s.includes('{{') && !s.includes('}}'), 'takes no tokens')
    .default('');

/** When a price row must have a value for every item before a letter can be made. */
export const OFFER_ROW_REQUIRED = ['always', 'never', 'when_customer_funds_tooling'] as const;
export type OfferRowRequired = (typeof OFFER_ROW_REQUIRED)[number];

/** The item facts the Specifications table may show (the old template's "Other Assumptions"). */
export const OFFER_SPEC_FACTS = [
  'material',
  'color',
  'cavities',
  'gramWeight',
  'neckFinish',
  'decoration',
  'packaging',
] as const;
export type OfferSpecFact = (typeof OFFER_SPEC_FACTS)[number];

const rowSchema = z.object({
  label: label(80),
  required: z.enum(OFFER_ROW_REQUIRED),
});

export const offerLetterTemplateSchema = z.object({
  /** Recorded on every letter made with it; bump it when the wording changes. */
  templateVersion: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{1,40}$/, 'letters, digits, ".", "_" or "-" (≤ 40)'),
  provisional: z.boolean().default(true),
  /** Informational: the DRAFT line follows `offer_letter_wording_approved`, Legal's sign-off. */
  legalApproved: z.boolean().default(false),
  /** The small spaced-caps line above the title. Blank = none. */
  eyebrow: optionalText(60),
  title: label(80),
  introduction: sentence(1200).nullable().default(null),
  itemsHeading: label(80),
  pricingHeading: label(80),
  rows: z.object({
    piecePrice: rowSchema.extend({ required: z.literal('always') }),
    molds: rowSchema,
    changeParts: rowSchema,
  }),
  /** `tooling_funding_model` codes in which the customer pays for tooling (for `when_customer_funds_tooling`). */
  customerFundedToolingModels: z.array(z.string().trim().min(1).max(60)).max(20),
  specificationsHeading: label(80),
  /** The Specifications rows, in order. A row no item has a value for is not printed. */
  specifications: z
    .array(z.object({ fact: z.enum(OFFER_SPEC_FACTS), label: label(60) }))
    .max(OFFER_SPEC_FACTS.length)
    .default([]),
  assumptionsHeading: label(80),
  /** The pricing assumptions, one sentence each, with at most one level of sub-points. */
  assumptions: z
    .array(
      z.object({
        text: sentence(600),
        points: z.array(sentence(400)).max(10).default([]),
      }),
    )
    .max(40),
  showValidity: z.boolean().default(true),
  closing: sentence(1200).nullable().default(null),
  signOff: label(60),
  /** Printed under the signer's name. */
  signerCompany: label(80),
  /** The footer note ("Confidential"). Blank = none. */
  footerNote: optionalText(120),
  /** The legal entity and address for the footer: blank until Legal gives them. */
  legalEntity: optionalText(160),
  address: optionalText(300),
});
export type OfferLetterTemplate = z.infer<typeof offerLetterTemplateSchema>;

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || '(value)'}: ${i.message}`).join('; ');
}

/** Validates `app_setting.offer_letter_template`. Missing = the seed. */
export function parseOfferLetterTemplate(input: unknown): OfferLetterTemplate {
  if (input === null || input === undefined) return OFFER_LETTER_TEMPLATE_SEED;
  const parsed = offerLetterTemplateSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError('INVALID_CONFIG', `offer_letter_template: ${zodMessage(parsed.error)}`);
  }
  const specs = parsed.data.specifications.map((s) => s.fact);
  const dup = specs.find((f, i) => specs.indexOf(f) !== i);
  if (dup) {
    throw new DomainError(
      'INVALID_CONFIG',
      `offer_letter_template: specifications: ${dup} is listed twice`,
    );
  }
  return parsed.data;
}

const booleanSetting = (key: string, fallback: boolean) => (input: unknown) => {
  if (input === null || input === undefined) return fallback;
  if (typeof input !== 'boolean') {
    throw new DomainError('INVALID_CONFIG', `${key} must be true or false`);
  }
  return input;
};

/** `offer_letter_wording_approved`: Legal has approved the wording (false prints the DRAFT line). */
export const parseOfferLetterWordingApproved = booleanSetting(
  'offer_letter_wording_approved',
  false,
);
/** `offer_letter_block_if_costing_changed`: refuse a letter when the costing changed after G4. */
export const parseOfferLetterBlockIfCostingChanged = booleanSetting(
  'offer_letter_block_if_costing_changed',
  true,
);

export const OFFER_LETTER_WORDING_APPROVED_SEED = false;
export const OFFER_LETTER_BLOCK_IF_COSTING_CHANGED_SEED = true;

/**
 * The seed: the old Standard Quote Template's wording, adjusted only where it is plainly wrong for the
 * FB-08 / FB-11 terms recorded on the quote (each change is listed in the structure note). Provisional,
 * not approved by Legal.
 */
export const OFFER_LETTER_TEMPLATE_SEED: OfferLetterTemplate = {
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
    piecePrice: { label: 'Piece price per 1,000 pcs', required: 'always' },
    molds: { label: 'Molds', required: 'when_customer_funds_tooling' },
    changeParts: { label: 'Change parts', required: 'never' },
  },
  customerFundedToolingModels: ['CUSTOMER_FUNDED', 'ZERO_CER', 'SHARED'],
  specificationsHeading: 'Specifications',
  specifications: [
    { fact: 'material', label: 'Material (resin type)' },
    { fact: 'color', label: 'Color' },
    { fact: 'cavities', label: 'Number of cavities' },
    { fact: 'gramWeight', label: 'Gram weight' },
    { fact: 'neckFinish', label: 'Neck finish' },
    { fact: 'decoration', label: 'Decoration' },
    { fact: 'packaging', label: 'Packaging' },
  ],
  assumptionsHeading: 'Pricing assumptions',
  assumptions: [
    { text: 'Pricing does not include pallet costs.', points: [] },
    {
      text: 'Pricing of pallets is subject to change at the time of shipping due to market conditions.',
      points: [],
    },
    { text: 'This offer is valid until {{validUntil}}.', points: [] },
    { text: 'Pricing is {{priceBasis}}, {{freight}}.', points: [] },
    { text: 'Payment terms: {{paymentTerms}} from date of invoice.', points: [] },
    { text: 'Lead time to be confirmed at time of Purchase Order.', points: [] },
    { text: 'Standard Pretium Quality specifications apply.', points: [] },
    { text: 'Pretium specified resin applies.', points: [] },
    { text: 'Tooling funding: {{toolingFunding}}.', points: [] },
    { text: 'Mold ownership: {{moldOwnership}}.', points: [] },
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
    { text: 'Pretium standard terms & conditions apply.', points: [] },
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
