import { z } from 'zod';

/**
 * FB-20 (F-070): the customer offer letter, generated from an approved quote (Customer Decision) as a
 * Word document. Prices come from the current costing workbook's summary (FB-14) and cannot be edited
 * here; the generator types only the Attention line and a Part # per item.
 */

export const OFFER_LETTER_PROBLEM_CODES = {
  /** A blocker stops the letter (the problem's `blockers` say which). */
  notReady: 'offer-letter-not-ready',
  /** A warning was not acknowledged (the problem's `warnings` say which). */
  unacknowledged: 'offer-letter-warnings-not-acknowledged',
} as const;

export const OfferBlockerView = z.object({
  code: z.string(),
  message: z.string(),
  itemNo: z.number().int().nullable(),
  /** Where it is fixed: the quote page, the Engineering or Quoting tab, Final Review, an Admin. */
  fixAt: z.enum(['quote', 'engineering', 'quoting', 'final_review', 'admin']).nullable(),
});
export type OfferBlockerView = z.infer<typeof OfferBlockerView>;

export const OfferWarningView = z.object({
  code: z.enum(['wording_not_approved', 'no_attention', 'no_part_number']),
  message: z.string(),
});
export type OfferWarningView = z.infer<typeof OfferWarningView>;

/** One item as the letter will print it (figures read-only). */
export const OfferLetterItemPreview = z.object({
  /** The quote item id (null on a quote with no item rows). */
  itemId: z.uuid().nullable(),
  itemNo: z.number().int(),
  name: z.string(),
  partDescription: z.string(),
  placeOfManufacture: z.string().nullable(),
  annualVolume: z.number().int().nullable(),
  /** `$#,##0.00` text, null when not printed. */
  piecePricePer1000: z.string().nullable(),
  moldCharge: z.string().nullable(),
  changePartsCharge: z.string().nullable(),
});
export type OfferLetterItemPreview = z.infer<typeof OfferLetterItemPreview>;

export const OfferLetterSummary = z.object({
  id: z.uuid(),
  letterNo: z.number().int(),
  attachmentId: z.uuid(),
  fileName: z.string(),
  letterDate: z.string(),
  attention: z.string().nullable(),
  itemCount: z.number().int(),
  quoteVersion: z.number().int(),
  /** Made for an earlier version of the quote (a re-quote followed). */
  superseded: z.boolean(),
  wordingApproved: z.boolean(),
  templateVersion: z.string(),
  costModelVersion: z.number().int(),
  generatedByName: z.string().nullable(),
  generatedAt: z.string(),
});
export type OfferLetterSummary = z.infer<typeof OfferLetterSummary>;

export const OfferLetterResponse = z.object({
  quoteNumber: z.string(),
  /** `available` false: before Final Review approval (the card says "Not available yet"). */
  available: z.boolean(),
  canGenerate: z.boolean(),
  /** The caller holds `offer.generate` on this quote. */
  mayGenerate: z.boolean(),
  blockers: z.array(OfferBlockerView),
  /** Advisory; the wording warning only (Attention and Part # are checked as they are typed). */
  warnings: z.array(OfferWarningView),
  wordingApproved: z.boolean(),
  /** The draft line printed while the wording is not approved. */
  draftText: z.string().nullable(),
  /** "Read from costing.xlsx v3, uploaded by Pat Pricing on Nov 9, 2026"; null with no workbook. */
  source: z
    .object({
      attachmentId: z.uuid(),
      fileName: z.string(),
      version: z.number().int(),
      uploadedByName: z.string().nullable(),
      uploadedAt: z.string(),
      text: z.string(),
    })
    .nullable(),
  preview: z
    .object({
      to: z.string(),
      date: z.string(),
      validUntil: z.string().nullable(),
      items: z.array(OfferLetterItemPreview),
      labels: z.object({ piecePrice: z.string(), molds: z.string(), changeParts: z.string() }),
      assumptions: z.array(z.object({ text: z.string(), points: z.array(z.string()) })),
    })
    .nullable(),
  letters: z.array(OfferLetterSummary),
});
export type OfferLetterResponse = z.infer<typeof OfferLetterResponse>;

export const GenerateOfferLetterBody = z.object({
  attention: z.string().trim().max(120).nullable().default(null),
  items: z
    .array(
      z.object({
        /** The quote item id, or null for a quote with no item rows (item 1). */
        itemId: z.uuid().nullable(),
        partNumber: z.string().trim().max(60).nullable().default(null),
      }),
    )
    .max(50)
    .default([]),
  /** The warning codes the user ticked. Every current warning must be in it. */
  acknowledgedWarnings: z
    .array(z.enum(['wording_not_approved', 'no_attention', 'no_part_number']))
    .max(10)
    .default([]),
});
export type GenerateOfferLetterBody = z.infer<typeof GenerateOfferLetterBody>;

export const GenerateOfferLetterResponse = z.object({
  letter: OfferLetterSummary,
  /** The attachment download route for the new file. */
  downloadPath: z.string(),
});
export type GenerateOfferLetterResponse = z.infer<typeof GenerateOfferLetterResponse>;
