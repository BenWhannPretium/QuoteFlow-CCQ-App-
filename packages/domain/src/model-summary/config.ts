import { z } from 'zod';

import { DomainError } from '../errors';

/**
 * FB-14 (F-031 summary half, D-013, A-031 partly received): the one-page summary of an uploaded model
 * workbook. QuoteFlow reads a handful of cells from the workbook (cached values only: no formula is
 * evaluated, nothing is recomputed) and shows them next to the file on the Quoting tab and at Final
 * Review. Which cells are read is **data, not code**: `app_setting.model_summary_templates` holds one
 * map per template, an Admin edits it in the console, and every seeded map is provisional until its
 * owner (Finance for the payback calculator, Pricing for the costing workbook) confirms it.
 *
 * A map says which attachment kind it applies to, how to recognise the template (a sheet name plus one
 * or more label cells that must read as expected), and the fields to read. A field's `ref` is a
 * defined name when the workbook has one (preferred: it survives a layout change), otherwise an A1
 * address on `sheet`.
 */

/** The attachment kinds a summary may be read from (FB-07's Quoting models). */
export const MODEL_SUMMARY_KINDS = ['cost_model', 'roi_model', 'price_table'] as const;
export type ModelSummaryKind = (typeof MODEL_SUMMARY_KINDS)[number];

/** How a value is shown. `percent` is a fraction (0.12 → 12.0 %), as Excel stores it. */
export const MODEL_SUMMARY_UNITS = ['usd', 'units', 'years', 'percent', 'count', 'text'] as const;
export type ModelSummaryUnit = (typeof MODEL_SUMMARY_UNITS)[number];

export const MODEL_SUMMARY_FIELD_TYPES = ['number', 'text', 'date'] as const;
export type ModelSummaryFieldType = (typeof MODEL_SUMMARY_FIELD_TYPES)[number];

/** An A1 address (no sheet, no range): `K16`, `$K$16`. */
export const A1_REF = /^\$?[A-Z]{1,3}\$?[1-9][0-9]{0,6}$/;
/** An Excel defined name: a letter, `_` or `\` first; no spaces; not an A1 address. */
const DEFINED_NAME = /^[A-Za-z_\\][A-Za-z0-9_.\\]{0,254}$/;

export function isA1Ref(ref: string): boolean {
  return A1_REF.test(ref.trim().toUpperCase());
}

/** `$k$16` → `K16`. */
export function normaliseA1(ref: string): string {
  return ref.trim().toUpperCase().replace(/\$/g, '');
}

const keySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{0,62}$/, 'use lower_snake_case');

const refSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((r) => isA1Ref(r) || DEFINED_NAME.test(r), 'an A1 address (K16) or a defined name');

const sheetSchema = z.string().trim().min(1).max(100);

export const modelSummaryFieldSchema = z.object({
  key: keySchema,
  label: z.string().trim().min(1).max(120),
  unit: z.enum(MODEL_SUMMARY_UNITS),
  type: z.enum(MODEL_SUMMARY_FIELD_TYPES),
  /** The sheet an A1 `ref` is on. With a defined name, the name wins and this is the fallback sheet. */
  sheet: sheetSchema,
  ref: refSchema,
  /**
   * When `ref` is a defined name and the workbook does not have it yet: the A1 address on `sheet` to
   * read instead (so a map can prefer the name the owner is asked to add, and still work today).
   */
  fallbackRef: z
    .string()
    .trim()
    .refine((r) => isA1Ref(r), 'an A1 address')
    .optional(),
  /** A headline figure: a blank value is flagged (advisory). */
  headline: z.boolean().default(false),
  /** The mapping is a proposal awaiting the template owner's confirmation. */
  proposed: z.boolean().default(true),
});
export type ModelSummaryField = z.infer<typeof modelSummaryFieldSchema>;

export const modelSummaryLabelCheckSchema = z.object({
  /** Sheet to look on; defaults to the recognition sheet. */
  sheet: sheetSchema.optional(),
  ref: z
    .string()
    .trim()
    .refine((r) => isA1Ref(r), 'an A1 address'),
  /** The cell's text must contain this (case and spacing ignored). */
  contains: z.string().trim().min(1).max(200),
});

/** Advisory warnings: which fields are paybacks, and which field holds the hurdle. */
export const modelSummaryWarningsSchema = z
  .object({
    /** Fields where zero or a negative value is flagged ("the payback is negative"). */
    nonPositive: z.array(keySchema).default([]),
    /** Flag `field` above the value read from `limitField` (the hurdle), when both have numbers. */
    hurdle: z.object({ field: keySchema, limitField: keySchema }).nullable().default(null),
  })
  .default({ nonPositive: [], hurdle: null });

export const modelSummaryTemplateSchema = z
  .object({
    templateId: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,62}$/, 'use lower_snake_case'),
    label: z.string().trim().min(1).max(200),
    kind: z.enum(MODEL_SUMMARY_KINDS),
    /** Inactive maps are never used: the file shows "summary not configured" (quietly). */
    active: z.boolean(),
    provisional: z.boolean().default(true),
    note: z.string().trim().max(1000).optional(),
    recognise: z.object({
      sheet: sheetSchema,
      labels: z.array(modelSummaryLabelCheckSchema).min(1).max(10),
    }),
    fields: z.array(modelSummaryFieldSchema).min(1).max(40),
    warnings: modelSummaryWarningsSchema,
  })
  .superRefine((t, ctx) => {
    const keys = t.fields.map((f) => f.key);
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dup)
      ctx.addIssue({ code: 'custom', message: `duplicate field key ${dup}`, path: ['fields'] });
    const known = new Set(keys);
    for (const k of t.warnings.nonPositive) {
      if (!known.has(k))
        ctx.addIssue({ code: 'custom', message: `unknown field ${k}`, path: ['warnings'] });
    }
    if (t.warnings.hurdle) {
      for (const k of [t.warnings.hurdle.field, t.warnings.hurdle.limitField]) {
        if (!known.has(k))
          ctx.addIssue({ code: 'custom', message: `unknown field ${k}`, path: ['warnings'] });
      }
    }
  });
export type ModelSummaryTemplate = z.infer<typeof modelSummaryTemplateSchema>;

const templatesSchema = z.array(modelSummaryTemplateSchema).superRefine((list, ctx) => {
  const ids = list.map((t) => t.templateId);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) ctx.addIssue({ code: 'custom', message: `duplicate templateId ${dup}` });
});

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || '(value)'}: ${i.message}`).join('; ');
}

/** Validates `app_setting.model_summary_templates`. Null / missing = no templates (nothing is read). */
export function parseModelSummaryTemplates(input: unknown): ModelSummaryTemplate[] {
  if (input === null || input === undefined) return [];
  const parsed = templatesSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError('INVALID_CONFIG', `model_summary_templates: ${zodMessage(parsed.error)}`);
  }
  return parsed.data;
}

/**
 * The work cap for one extraction (provisional). A larger file is stored and shows "summary
 * unavailable: the file is too large to read"; a read that runs past `timeoutMs` stops and shows
 * "took too long". Both sit well inside the upload request's budget.
 */
export interface ModelSummaryLimits {
  maxBytes: number;
  timeoutMs: number;
  /** Cells kept in memory across the sheets read (a guard against a bloated workbook). */
  maxCells: number;
}

export const MODEL_SUMMARY_LIMITS_SEED: ModelSummaryLimits = {
  maxBytes: 15 * 1024 * 1024,
  timeoutMs: 5000,
  maxCells: 200_000,
};

const limitsSchema = z.object({
  maxBytes: z
    .number()
    .int()
    .min(1024)
    .max(100 * 1024 * 1024),
  timeoutMs: z.number().int().min(100).max(20_000),
  maxCells: z.number().int().min(100).max(2_000_000),
});

export function parseModelSummaryLimits(input: unknown): ModelSummaryLimits {
  if (input === null || input === undefined) return { ...MODEL_SUMMARY_LIMITS_SEED };
  const parsed = limitsSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError('INVALID_CONFIG', `model_summary_limits: ${zodMessage(parsed.error)}`);
  }
  return parsed.data;
}

/** `app_setting.model_summary_visible`: may QuoteFlow show the extracted figures (open, 04 §2a)? */
export function parseModelSummaryVisible(input: unknown): boolean {
  if (input === null || input === undefined) return true;
  if (typeof input !== 'boolean') {
    throw new DomainError('INVALID_CONFIG', 'model_summary_visible must be true or false');
  }
  return input;
}
