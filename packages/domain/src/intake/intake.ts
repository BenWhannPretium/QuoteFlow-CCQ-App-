import { z } from 'zod';

import type { QuoteStatus } from '../types/quote';
import { requiredRuleSchema } from '../types/workflow-config';
import { evaluateRules, fieldsReferenced, getPath, isPresent } from '../workflow/rules';
import type { FieldValues } from '../workflow/rules';

/**
 * KAM intake (F-03). Sales enters only what Sales can know: there is deliberately no plant, process,
 * machine, capital, engineer, channel, product class or priority field here (REQ-04, X-90).
 *
 * Values are keyed in snake_case like the workflow rules, with two nested objects:
 * `customer { status, sf_account_id, name, location, contact_name, contact_email, contact_phone }` and
 * `ship_to` / `ship_to_default { line1, city, state, postal, country }`.
 *
 * Which fields BLOCK a submit is config (`intake_required_fields`, the required-field DSL), not code:
 * Danielle Leu and Jim Zweifel finalise "stop vs enrich" at M4 (D-05, CR-08). Every other intake field
 * that is missing is a WARNING ("Engineering may ask about this"), never an error.
 */

/** Every field the KAM can fill in, in wizard order. The enrich warnings walk this list. */
export const INTAKE_FIELDS = [
  'sf_opportunity_id',
  'customer.name',
  'ship_to',
  'request_class',
  'product_family',
  'components',
  'market',
  'resin',
  'neck_finish',
  'packaging_type',
  'packaging_notes',
  'est_annual_volume',
  'est_annual_revenue',
  'expected_close_date',
  'container_size',
  'standard_description',
  'description',
  'drawing_status',
  'comments_for_engineering',
] as const;
export type IntakeField = (typeof INTAKE_FIELDS)[number];

/** Optional text that is fine to leave blank: no "Engineering may ask" nudge for these. */
const NO_ENRICH_NUDGE: readonly string[] = ['description', 'comments_for_engineering'];

export const intakeConfigSchema = z
  .object({
    /** Blocking rules (app_setting `intake_required_fields`). */
    requiredFields: z.array(requiredRuleSchema),
    /** Volume placeholder guard (app_setting `intake_volume_placeholder`). */
    volumePlaceholder: z
      .object({
        /** Exact values that are almost always defaults (seed: 1,000,000). */
        values: z.array(z.number()).default([]),
        /** Any volume that is a whole multiple of this is "suspiciously round" (null = off). */
        roundMultiple: z.number().positive().nullable().default(null),
      })
      .strict(),
    /** The main request class; anything else may be redirected at G1 (app_setting `intake_default_request_class`). */
    defaultRequestClass: z.string().min(1),
    /** drawing_status codes that mean a drawing exists (value_list meta `hasDrawing`). */
    drawingProvidedCodes: z.array(z.string()),
  })
  .strict();

export type IntakeConfig = z.infer<typeof intakeConfigSchema>;
export type IntakeConfigInput = z.input<typeof intakeConfigSchema>;

export const parseIntakeConfig = (input: IntakeConfigInput): IntakeConfig =>
  intakeConfigSchema.parse(input);

export const INTAKE_ISSUE_CODES = [
  // blocking
  'MISSING_FIELD',
  'SHIP_TO_REASON_REQUIRED',
  'INVALID_VALUE',
  // warnings
  'VOLUME_PLACEHOLDER',
  'DRAWING_MISSING',
  'REQUEST_CLASS_REDIRECT',
  'ENRICH',
] as const;
export type IntakeIssueCode = (typeof INTAKE_ISSUE_CODES)[number];

export interface IntakeIssue {
  code: IntakeIssueCode;
  /** snake_case field (dotted for nested values); comma-separated when several satisfy the rule. */
  field: string;
  message: string;
}

export interface IntakeEvaluation {
  /** Stop the submit. */
  blocking: IntakeIssue[];
  /** Shown in amber; never stop the submit. */
  warnings: IntakeIssue[];
  ready: boolean;
}

type Address = Partial<Record<'line1' | 'city' | 'state' | 'postal' | 'country', unknown>>;

const norm = (v: unknown): string => {
  if (typeof v === 'string') return v.trim().toLowerCase().replace(/\s+/g, ' ');
  return typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
};

/** Ship-to differs from the customer default (case, spacing and blank-vs-null ignored). */
export function shipToChanged(shipTo: unknown, original: unknown): boolean {
  if (!original || typeof original !== 'object') return false;
  const a = (shipTo ?? {}) as Address;
  const b = original as Address;
  return (['line1', 'city', 'state', 'postal', 'country'] as const).some(
    (k) => norm(a[k]) !== norm(b[k]),
  );
}

/** "Is this the customer's real annual volume?" Today it is "almost always entered as one million". */
export function isPlaceholderVolume(
  volume: unknown,
  guard: IntakeConfig['volumePlaceholder'],
): boolean {
  if (typeof volume !== 'number' || !Number.isFinite(volume) || volume <= 0) return false;
  if (guard.values.includes(volume)) return true;
  return guard.roundMultiple !== null && volume % guard.roundMultiple === 0;
}

/** True for a quote that blocks a second CCQ quote on the same SF opportunity. */
export const isActiveQuoteStatus = (status: QuoteStatus): boolean => status !== 'closed';

/**
 * Blocking vs warning for an intake. Pure: the API calls it on every autosave (to show the review)
 * and again inside the submit transaction (the authority).
 */
export function evaluateIntake(values: FieldValues, config: IntakeConfig): IntakeEvaluation {
  const blocking: IntakeIssue[] = evaluateRules(config.requiredFields, values).map((e) => ({
    code: 'MISSING_FIELD',
    field: e.field ?? '',
    message: e.message,
  }));
  const warnings: IntakeIssue[] = [];

  const volume = values.est_annual_volume;
  if (
    isPresent(volume) &&
    !(typeof volume === 'number' && Number.isInteger(volume) && volume > 0)
  ) {
    blocking.push({
      code: 'INVALID_VALUE',
      field: 'est_annual_volume',
      message: 'Estimated annual volume must be a whole number of units above zero',
    });
  }
  const revenue = values.est_annual_revenue;
  if (isPresent(revenue) && !(typeof revenue === 'number' && revenue >= 0)) {
    blocking.push({
      code: 'INVALID_VALUE',
      field: 'est_annual_revenue',
      message: 'Estimated annual revenue cannot be negative',
    });
  }

  // Ship-to is governed: a change from the customer default needs a reason (B-09 makes it an override).
  if (
    shipToChanged(values.ship_to, values.ship_to_default) &&
    !isPresent(values.ship_to_override_reason)
  ) {
    blocking.push({
      code: 'SHIP_TO_REASON_REQUIRED',
      field: 'ship_to_override_reason',
      message: 'Say why the ship-to differs from the customer default',
    });
  }

  if (
    isPlaceholderVolume(volume, config.volumePlaceholder) &&
    values.est_annual_volume_confirmed !== true
  ) {
    warnings.push({
      code: 'VOLUME_PLACEHOLDER',
      field: 'est_annual_volume',
      message: "Is this the customer's real annual volume? Round defaults lead to rework.",
    });
  }

  // The drawing prompt never blocks (Danielle Leu).
  const drawing = values.drawing_status;
  if (typeof drawing !== 'string' || !config.drawingProvidedCodes.includes(drawing)) {
    warnings.push({
      code: 'DRAWING_MISSING',
      field: 'drawing_status',
      message: 'Quotes without a drawing usually take longer.',
    });
  }

  const requestClass = values.request_class;
  if (isPresent(requestClass) && requestClass !== config.defaultRequestClass) {
    warnings.push({
      code: 'REQUEST_CLASS_REDIRECT',
      field: 'request_class',
      message: 'This may be redirected at qualification.',
    });
  }

  // Enrich: every other intake field that is empty is an amber "Engineering may ask about this".
  const flagged = new Set(
    [...blocking, ...warnings]
      .flatMap((i) => i.field.split(','))
      .concat(config.requiredFields.flatMap(fieldsReferenced)),
  );
  for (const field of INTAKE_FIELDS) {
    const covered = flagged.has(field) || [...flagged].some((f) => f.startsWith(`${field}.`));
    if (covered || NO_ENRICH_NUDGE.includes(field)) continue;
    if (!isPresent(getPath(values, field))) {
      warnings.push({ code: 'ENRICH', field, message: 'Engineering may ask about this.' });
    }
  }

  return { blocking, warnings, ready: blocking.length === 0 };
}

/**
 * Suggested standard description (Sarah Brennan's suggestion). The template is provisional config
 * (app_setting `intake_description_template`): `{field}` is replaced by its value, and a `[ … ]`
 * segment is dropped when any field inside it is empty. Example:
 * `"{container_size} {product_family}[, {resin}][ with {components}]"` → `16 oz Bottle, HDPE with Closure`.
 */
export function renderDescriptionTemplate(
  template: string,
  parts: Readonly<Record<string, string | readonly string[] | null | undefined>>,
): string {
  const text = (key: string) => {
    const v = parts[key];
    if (Array.isArray(v)) return (v as readonly string[]).filter((s) => s.trim()).join(', ');
    return typeof v === 'string' ? v.trim() : '';
  };
  const fill = (segment: string) => segment.replace(/\{(\w+)\}/g, (_, key: string) => text(key));
  const withOptional = template.replace(/\[([^\]]*)\]/g, (_, inner: string) => {
    const keys = [...inner.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
    return keys.every((k) => text(k) !== '') ? fill(inner) : '';
  });
  return fill(withOptional)
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;])/g, '$1')
    .replace(/^[\s,;·-]+|[\s,;·-]+$/g, '')
    .trim();
}
