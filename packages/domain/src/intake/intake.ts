import { z } from 'zod';

import { commercialInputIssues, inapplicableCommercialFields } from './commercial-inputs';
import { guardrailWarning, INTAKE_GUARDRAILS_OFF, intakeGuardrailsSchema } from './guardrails';
import {
  activeFollowUps,
  COMPONENT_FOLLOW_UP_FIELDS,
  CUSTOM_DESCRIPTION_FIELDS,
  CUSTOM_LIST_FIELDS,
  DIMENSION_FIELDS,
  DIMENSION_MAX,
  INTAKE_TEXT_LIMITS,
  MIN_SPEC_FIELD_LABELS,
  MIN_SPEC_FIELDS,
  MIN_SPEC_KEYS,
  PRINT_COLORS_RANGE,
  RFP_LINK_PATTERN,
} from './product-facts';
import type { QuoteStatus } from '../types/quote';
import { requiredRuleSchema } from '../types/workflow-config';
import { evaluateRules, fieldsReferenced, getPath, isPresent } from '../workflow/rules';
import type { FieldValues } from '../workflow/rules';

/**
 * KAM intake (F-03). Sales enters only what Sales can know: there is deliberately no plant, process,
 * machine, capital, engineer, channel, product class or priority field here (REQ-04, X-90).
 *
 * Values are keyed in snake_case like the workflow rules, with two nested objects:
 * `customer { status, sf_account_id, name }` (FB-02, F-007: always the opportunity's SF Account) and
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
  // FB-02 (F-010, F-055, F-023): the neck as diameter + finish, PCR %, color.
  'neck_diameter',
  'neck_finish_type',
  'pcr_level',
  'color_type',
  // FB-11 (F-080): what Pricing needs for awareness and negotiation. Optional: a blank is amber.
  'requested_payment_terms',
  'price_basis',
  'packaging_type',
  'packaging_notes',
  'est_annual_volume',
  'est_annual_revenue',
  // FB-02 (F-009): the two need-by dates replace the editable close date (the SF close date is read-only).
  'quote_needed_by',
  'product_needed_by',
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
    /** The request class a new intake starts with (app_setting `intake_default_request_class`). */
    defaultRequestClass: z.string().min(1),
    /**
     * FB-02 (F-067): the request classes that can be submitted (app_setting
     * `intake_allowed_request_classes`, seeded ["CCQ"], provisional). Anything else stays in the
     * pricing application for now.
     */
    allowedRequestClasses: z.array(z.string().min(1)).min(1),
    /** FB-02 (F-067): shown when another class is chosen (app_setting `intake_redirect_message`; D-030). */
    redirectMessage: z.string().min(1),
    /** drawing_status codes that mean a drawing exists (value_list meta `hasDrawing`). */
    drawingProvidedCodes: z.array(z.string()),
    /**
     * FB-02: the "Custom" codes (value-list meta `freeText`) of the neck and color lists; picking one
     * needs a short description.
     */
    customCodes: z
      .partialRecord(z.enum(CUSTOM_LIST_FIELDS as [string, ...string[]]), z.array(z.string()))
      .default({}),
    /** FB-02 (F-013): component code → the follow-up fields it asks for (`component` meta `followUps`). */
    componentFollowUps: z
      .record(z.string(), z.array(z.enum(COMPONENT_FOLLOW_UP_FIELDS)))
      .default({}),
    /** FB-02 (F-075): longest "Quote variants requested" note (app_setting `intake_variants_note_max_length`). */
    variantsNoteMaxLength: z.number().int().positive().default(300),
    /**
     * FB-09 (F-019, D-016 default, provisional): longest packaging note (characters) for a NEW edit
     * (app_setting `intake_free_text_max_length`). An older, longer value stays readable.
     */
    freeTextMaxLength: z.number().int().positive().default(500),
    /**
     * FB-02 (F-016, D-018): without a bottle or competitor drawing attached, every one of these must be
     * filled to submit (app_setting `intake_min_spec_fields`, provisional). Empty = no minimum spec.
     */
    minSpecFields: z.array(z.enum(MIN_SPEC_KEYS)).default([...MIN_SPEC_KEYS]),
    /**
     * FB-11 (F-080): payment terms that are standard (app_setting `standard_payment_terms`, seeded
     * ["NET_15","NET_30"], provisional; A-012). Anything else is flagged "Non-standard: Pricing will review".
     */
    standardPaymentTerms: z.array(z.string().min(1)).default([]),
    /** FB-11 (F-080): `price_basis` codes whose meta says `delivered`; the freight fields apply to them. */
    deliveredPriceBasisCodes: z.array(z.string().min(1)).default([]),
    /**
     * FB-10 (F-066): platform-minimum warning (app_setting `intake_guardrails`, seeded OFF, provisional).
     * A non-blocking amber warning; recorded on the quote for G1.
     */
    guardrails: intakeGuardrailsSchema.default(INTAKE_GUARDRAILS_OFF),
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
  /** FB-02 (F-007, D-011): the opportunity has no Salesforce Account; the customer always comes from SF. */
  'SF_ACCOUNT_REQUIRED',
  // warnings
  /** FB-02 (F-067): only the allowed classes (CCQ) can be submitted; the rest go to the pricing app. */
  'REQUEST_CLASS_NOT_ALLOWED',
  /** FB-02 (F-016): no bottle / competitor drawing and the minimum spec is incomplete. */
  'DRAWING_OR_MIN_SPEC_REQUIRED',
  'VOLUME_PLACEHOLDER',
  /** FB-10 (F-066): the volume is below the platform minimum. A warning; the submit still goes. */
  'BELOW_PLATFORM_MINIMUM',
  'DRAWING_MISSING',
  'ENRICH',
] as const;
export type IntakeIssueCode = (typeof INTAKE_ISSUE_CODES)[number];

export interface IntakeIssue {
  code: IntakeIssueCode;
  /** snake_case field (dotted for nested values); comma-separated when several satisfy the rule. */
  field: string;
  message: string;
  /** FB-02 (F-016): for DRAWING_OR_MIN_SPEC_REQUIRED, the minimum-spec fields still missing (snake_case). */
  missing?: string[];
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Day of the month of the `n`th Sunday of `month` (0-based) in `year`. */
function nthSunday(year: number, month: number, n: number): number {
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - firstDow) % 7) + (n - 1) * 7;
}

/**
 * Today's calendar date (YYYY-MM-DD) where the need-by dates are judged: US Central, Pretium HQ
 * (CLAUDE.md "Time"). A KAM at 9 PM Central on the 5th is still on the 5th. US daylight time runs
 * from 2 AM on the second Sunday of March to 2 AM on the first Sunday of November (CDT = UTC-5,
 * CST = UTC-6); computed here so the result doesn't depend on the runtime's time-zone data.
 */
export function todayInCentral(now: Date): string {
  const year = now.getUTCFullYear();
  const dstStart = Date.UTC(year, 2, nthSunday(year, 2, 2), 8); // 2 AM CST
  const dstEnd = Date.UTC(year, 10, nthSunday(year, 10, 1), 7); // 2 AM CDT
  const t = now.getTime();
  const offsetHours = t >= dstStart && t < dstEnd ? -5 : -6;
  return new Date(t + offsetHours * 3_600_000).toISOString().slice(0, 10);
}

/**
 * FB-02 (F-009): "Quote needed by" must be after today; "Product needed by" (best estimate of launch
 * need) on or after it. Presence is config (`intake_required_fields`); this only checks the order.
 */
export function needByDateIssues(values: FieldValues, now: Date): IntakeIssue[] {
  const issues: IntakeIssue[] = [];
  const quoteBy = values.quote_needed_by;
  const productBy = values.product_needed_by;
  const quoteOk = typeof quoteBy === 'string' && ISO_DATE.test(quoteBy);
  if (isPresent(quoteBy)) {
    if (!quoteOk) {
      issues.push({
        code: 'INVALID_VALUE',
        field: 'quote_needed_by',
        message: 'Quote needed by must be a date (YYYY-MM-DD)',
      });
    } else if (typeof quoteBy === 'string' && quoteBy <= todayInCentral(now)) {
      issues.push({
        code: 'INVALID_VALUE',
        field: 'quote_needed_by',
        message: 'Quote needed by must be after today',
      });
    }
  }
  if (isPresent(productBy)) {
    if (typeof productBy !== 'string' || !ISO_DATE.test(productBy)) {
      issues.push({
        code: 'INVALID_VALUE',
        field: 'product_needed_by',
        message: 'Product needed by must be a date (YYYY-MM-DD)',
      });
    } else if (quoteOk && typeof quoteBy === 'string' && productBy < quoteBy) {
      issues.push({
        code: 'INVALID_VALUE',
        field: 'product_needed_by',
        message: 'Product needed by must be on or after Quote needed by',
      });
    }
  }
  return issues;
}

/** Detail fields with their own limit (`INTAKE_TEXT_LIMITS`), checked below rather than at 120. */
const OTHER_DETAIL_OWN_LIMIT = new Set<string>([
  'resin_grade',
  'additives',
  'pcr_level_other',
  'packaging_notes',
]);

const tooLong = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > max;

/**
 * FB-02 product facts: a "Custom" neck or color value needs its description (F-010, F-023), a
 * customer-specified resin needs the supplier / grade (F-011), picked components need their
 * follow-ups (F-013), and the short texts stay short.
 */
export function productFactIssues(values: FieldValues, config: IntakeConfig): IntakeIssue[] {
  const issues: IntakeIssue[] = [];
  const missing = (field: string, message: string) =>
    issues.push({ code: 'MISSING_FIELD', field, message });
  const invalid = (field: string, message: string) =>
    issues.push({ code: 'INVALID_VALUE', field, message });

  for (const field of CUSTOM_LIST_FIELDS) {
    const code = values[field];
    const description = CUSTOM_DESCRIPTION_FIELDS[field];
    if (typeof code === 'string' && (config.customCodes[field] ?? []).includes(code)) {
      if (!isPresent(values[description])) missing(description, `${description} is required`);
    }
    // FB-09: resin_grade, pcr_level_other and additives have their own limits (checked below / by the field).
    if (
      !OTHER_DETAIL_OWN_LIMIT.has(description) &&
      tooLong(values[description], INTAKE_TEXT_LIMITS.custom_description)
    ) {
      invalid(description, `Keep it to ${INTAKE_TEXT_LIMITS.custom_description} characters`);
    }
  }
  if (tooLong(values.packaging_notes, config.freeTextMaxLength)) {
    invalid('packaging_notes', `Keep it to ${config.freeTextMaxLength} characters`);
  }
  if (tooLong(values.pcr_level_other, INTAKE_TEXT_LIMITS.pcr_level_other)) {
    invalid('pcr_level_other', `Keep it to ${INTAKE_TEXT_LIMITS.pcr_level_other} characters`);
  }

  if (
    values.resin_customer_specified === true &&
    !isPresent(values.resin_grade) &&
    !issues.some((i) => i.field === 'resin_grade') // already asked for by an Other resin (FB-09)
  ) {
    missing('resin_grade', 'resin_grade is required');
  }
  if (tooLong(values.resin_grade, INTAKE_TEXT_LIMITS.resin_grade)) {
    invalid('resin_grade', `Keep it to ${INTAKE_TEXT_LIMITS.resin_grade} characters`);
  }
  if (tooLong(values.additives, INTAKE_TEXT_LIMITS.additives)) {
    invalid('additives', `Keep it to ${INTAKE_TEXT_LIMITS.additives} characters`);
  }
  if (tooLong(values.quote_variants_note, config.variantsNoteMaxLength)) {
    invalid(
      'quote_variants_note',
      `Keep the variants note to ${config.variantsNoteMaxLength} characters`,
    );
  }

  for (const field of activeFollowUps(values.components, config.componentFollowUps)) {
    const value = values[field];
    if (!isPresent(value)) {
      missing(field, `${field} is required`);
    } else if (
      field === 'decoration_print_colors' &&
      !(
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= PRINT_COLORS_RANGE.min &&
        value <= PRINT_COLORS_RANGE.max
      )
    ) {
      invalid(
        field,
        `Number of print colors must be a whole number from ${PRINT_COLORS_RANGE.min} to ${PRINT_COLORS_RANGE.max}`,
      );
    }
  }
  if (tooLong(values.liner_spec, INTAKE_TEXT_LIMITS.liner_spec)) {
    invalid('liner_spec', `Keep it to ${INTAKE_TEXT_LIMITS.liner_spec} characters`);
  }
  return issues;
}

/**
 * F-016: is there a drawing (`has_drawing_attachment`: a bottle or competitor drawing on the draft or
 * quote), and which minimum-spec fields are still empty. Where attachments aren't known (a stored
 * quote's completeness check), a drawing status from `drawingProvidedCodes` stands in for the file.
 */
export function drawingOrSpecStatus(
  values: FieldValues,
  config: IntakeConfig,
): { drawingAttached: boolean; missing: string[]; specComplete: boolean; satisfied: boolean } {
  const attached = values.has_drawing_attachment;
  const drawingAttached =
    typeof attached === 'boolean'
      ? attached
      : typeof values.drawing_status === 'string' &&
        config.drawingProvidedCodes.includes(values.drawing_status);
  const missing = config.minSpecFields
    .flatMap((key) => MIN_SPEC_FIELDS[key])
    .filter((field) => !isPresent(values[field]));
  const specComplete = missing.length === 0;
  return { drawingAttached, missing, specComplete, satisfied: drawingAttached || specComplete };
}

/** F-015, F-016, F-014: mold modification details, dimensions and the RFP link. */
export function moldAndLinkIssues(values: FieldValues): IntakeIssue[] {
  const issues: IntakeIssue[] = [];
  if (values.modify_existing_mold === true) {
    for (const field of ['existing_mold_ref', 'mold_change_description']) {
      if (!isPresent(values[field])) {
        issues.push({ code: 'MISSING_FIELD', field, message: `${field} is required` });
      }
    }
  }
  for (const field of ['existing_mold_ref', 'mold_change_description', 'rfp_link'] as const) {
    if (tooLong(values[field], INTAKE_TEXT_LIMITS[field])) {
      issues.push({
        code: 'INVALID_VALUE',
        field,
        message: `Keep it to ${INTAKE_TEXT_LIMITS[field]} characters`,
      });
    }
  }
  for (const field of DIMENSION_FIELDS) {
    const v = values[field];
    if (
      isPresent(v) &&
      !(typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= DIMENSION_MAX)
    ) {
      issues.push({
        code: 'INVALID_VALUE',
        field,
        message: 'Enter a number above zero',
      });
    }
  }
  const link = values.rfp_link;
  if (isPresent(link) && !(typeof link === 'string' && RFP_LINK_PATTERN.test(link.trim()))) {
    issues.push({
      code: 'INVALID_VALUE',
      field: 'rfp_link',
      message: 'Use a full https:// link',
    });
  }
  return issues;
}

/**
 * Fields whose value no longer applies and is cleared when the intake is stored: a description for a
 * value that isn't "Custom", the resin grade without the checkbox, a follow-up of a component that
 * isn't picked (F-013 "cleared when it is deselected").
 */
export function inapplicableIntakeFields(values: FieldValues, config: IntakeConfig): string[] {
  const out: string[] = [];
  for (const field of CUSTOM_LIST_FIELDS) {
    const code = values[field];
    if (!(typeof code === 'string' && (config.customCodes[field] ?? []).includes(code))) {
      const detail = CUSTOM_DESCRIPTION_FIELDS[field];
      // FB-09: the additives and packaging notes are optional for any other choice, so never cleared here.
      if (detail !== 'additives' && detail !== 'packaging_notes') out.push(detail);
    }
  }
  // The resin grade also stays while the customer specifies the resin (FB-02), independent of "Other".
  if (values.resin_customer_specified === true) {
    const i = out.indexOf('resin_grade');
    if (i >= 0) out.splice(i, 1);
  }
  if (values.modify_existing_mold !== true) {
    out.push('existing_mold_ref', 'mold_change_description');
  }
  const active = activeFollowUps(values.components, config.componentFollowUps);
  out.push(...COMPONENT_FOLLOW_UP_FIELDS.filter((f) => !active.includes(f)));
  // FB-11 (F-080): freight applies only to a delivered price.
  out.push(...inapplicableCommercialFields(values, config.deliveredPriceBasisCodes));
  return out;
}

/** True for a quote that blocks a second CCQ quote on the same SF opportunity. */
export const isActiveQuoteStatus = (status: QuoteStatus): boolean => status !== 'closed';

/**
 * Blocking vs warning for an intake. Pure: the API calls it on every autosave (to show the review)
 * and again inside the submit transaction (the authority). `now` judges the need-by dates.
 */
export function evaluateIntake(
  values: FieldValues,
  config: IntakeConfig,
  now: Date,
): IntakeEvaluation {
  const blocking: IntakeIssue[] = evaluateRules(config.requiredFields, values).map((e) => ({
    code: 'MISSING_FIELD',
    field: e.field ?? '',
    message: e.message,
  }));
  const warnings: IntakeIssue[] = [];

  // F-007 (D-011): new accounts start in Salesforce, so the customer is always the opportunity's SF
  // Account. An opportunity without one is fixed in Salesforce, not typed here.
  if (
    isPresent(values.sf_opportunity_id) &&
    !isPresent(getPath(values, 'customer.sf_account_id'))
  ) {
    blocking.push({
      code: 'SF_ACCOUNT_REQUIRED',
      field: 'customer.sf_account_id',
      message:
        'This opportunity has no Salesforce Account. Add the account to the opportunity in Salesforce, then pick it again.',
    });
  }

  blocking.push(...needByDateIssues(values, now));
  blocking.push(...productFactIssues(values, config));
  blocking.push(...moldAndLinkIssues(values));
  const commercial = commercialInputIssues(values, {
    standardPaymentTerms: config.standardPaymentTerms,
    deliveredPriceBasisCodes: config.deliveredPriceBasisCodes,
  });
  blocking.push(...commercial.blocking);
  warnings.push(...commercial.warnings);

  // F-016 (D-018): a drawing, or the minimum spec, to advance.
  const drawingOrSpec = drawingOrSpecStatus(values, config);
  if (!drawingOrSpec.satisfied) {
    const words = drawingOrSpec.missing.map((f) => MIN_SPEC_FIELD_LABELS[f] ?? f).join(', ');
    blocking.push({
      code: 'DRAWING_OR_MIN_SPEC_REQUIRED',
      field: 'drawing_or_min_spec',
      message: `Attach a bottle or competitor drawing, or complete the minimum spec. Missing: ${words}.`,
      missing: drawingOrSpec.missing,
    });
  }

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

  // FB-10 (F-066): below the platform minimum is amber, never a block ("You can still submit").
  const belowMinimum = guardrailWarning(config.guardrails, {
    volume,
    processType: values.process_type,
  });
  if (belowMinimum) {
    warnings.push({
      code: belowMinimum.code,
      field: belowMinimum.field,
      message: belowMinimum.message,
    });
  }

  // No drawing on file is amber even when the minimum spec carries the submit (Danielle Leu: quotes
  // without a drawing take longer). A drawing status alone no longer counts (F-016).
  if (!drawingOrSpec.drawingAttached) {
    warnings.push({
      code: 'DRAWING_MISSING',
      field: 'drawing_status',
      message: 'Quotes without a drawing usually take longer.',
    });
  }

  // F-067: only CCQ work is submitted here; stock, stock-plus, price inquiries and pack-out evaluations
  // stay in the pricing application (configurable message, D-030 may move pack-out changes).
  const requestClass = values.request_class;
  if (!isPresent(requestClass)) {
    if (!blocking.some((b) => b.field === 'request_class'))
      blocking.push({
        code: 'MISSING_FIELD',
        field: 'request_class',
        message: 'request_class is required',
      });
  } else if (
    typeof requestClass !== 'string' ||
    !config.allowedRequestClasses.includes(requestClass)
  ) {
    blocking.push({
      code: 'REQUEST_CLASS_NOT_ALLOWED',
      field: 'request_class',
      message: config.redirectMessage,
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
