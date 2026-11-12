import { z } from 'zod';

/**
 * FB-14 (F-031 summary half, D-013): the one-page summary of an uploaded costing or payback model,
 * read from the workbook's cached cell values at upload. Read-only: QuoteFlow never recomputes or edits
 * a figure. Errors, blanks and negatives are shown as the workbook holds them, with advisory warnings.
 */

export const ModelSummaryStatus = z.enum([
  'complete',
  'partial',
  'unavailable',
  'not_configured',
  /** No summary was read for this version (uploaded before FB-14, or a metadata-only row). */
  'none',
]);
export type ModelSummaryStatus = z.infer<typeof ModelSummaryStatus>;

export const ModelSummaryFieldView = z.object({
  key: z.string(),
  label: z.string(),
  unit: z.enum(['usd', 'units', 'years', 'percent', 'count', 'text']),
  type: z.enum(['number', 'text', 'date']),
  /** Where it was read (shown on hover / for an Admin checking the map). */
  sheet: z.string(),
  ref: z.string(),
  definedName: z.string().nullable(),
  state: z.enum([
    'ok',
    'blank',
    'error',
    'not_calculated',
    'not_found',
    'wrong_type',
    'out_of_range',
  ]),
  number: z.number().nullable(),
  /** Text, an Excel error code, or what a number field held instead. */
  text: z.string().nullable(),
  /** ISO date (yyyy-mm-dd) for a date field. */
  date: z.string().nullable(),
  headline: z.boolean(),
  /** The cell mapping is a proposal awaiting the template owner. */
  proposed: z.boolean(),
});
export type ModelSummaryFieldView = z.infer<typeof ModelSummaryFieldView>;

export const ModelSummaryWarningView = z.object({
  code: z.string(),
  fieldKey: z.string().nullable(),
  message: z.string(),
});
export type ModelSummaryWarningView = z.infer<typeof ModelSummaryWarningView>;

export const ModelSummaryView = z.object({
  attachmentId: z.uuid(),
  kind: z.enum(['cost_model', 'roi_model', 'price_table']),
  version: z.number().int(),
  fileName: z.string(),
  uploadedByName: z.string().nullable(),
  uploadedAt: z.string(),
  status: ModelSummaryStatus,
  reason: z.string().nullable(),
  /** Why there is no (complete) summary, in plain words; null when complete or partial. */
  reasonText: z.string().nullable(),
  templateId: z.string().nullable(),
  templateLabel: z.string().nullable(),
  /** The map was provisional when the summary was read. */
  mapProvisional: z.boolean().nullable(),
  extractedAt: z.string().nullable(),
  fields: z.array(ModelSummaryFieldView),
  warnings: z.array(ModelSummaryWarningView),
});
export type ModelSummaryView = z.infer<typeof ModelSummaryView>;

export const ModelSummaryListResponse = z.object({
  /** app_setting.model_summary_visible: false hides the figures (the files still show). */
  visible: z.boolean(),
  hiddenText: z.string().nullable(),
  /** The current version of each Quoting model on the quote, costing first. */
  summaries: z.array(ModelSummaryView),
});
export type ModelSummaryListResponse = z.infer<typeof ModelSummaryListResponse>;
