import { parseIntakeGuardrails } from './guardrails';
import { INTAKE_LIST_FIELDS, parseIntakeConfig, type IntakeConfig } from './intake';
import { CUSTOM_LIST_FIELDS } from './product-facts';

/**
 * FB-15 (W13-01): ONE way to build the intake config, used by the API (the authority at submit) and by the
 * wizard (instant feedback). Before FB-15 each side assembled it on its own, and the wizard left out the
 * active list codes, so it called a draft "ready" that the server then refused with "The intake is missing
 * required information". Both sides now pass the same app settings and the same ACTIVE value-list entries
 * through this function.
 */

/** The app settings the intake reads (all in `PUBLIC_SETTING_KEYS`, so the wizard has them too). */
export const INTAKE_SETTING_KEYS = [
  'intake_required_fields',
  'intake_volume_placeholder',
  'intake_default_request_class',
  'intake_allowed_request_classes',
  'intake_redirect_message',
  'intake_variants_note_max_length',
  'intake_free_text_max_length',
  'intake_min_spec_fields',
  'intake_other_description_max_length',
  'standard_payment_terms',
  'intake_guardrails',
] as const;

export interface IntakeListEntry {
  code: string;
  meta: unknown;
}

export interface IntakeConfigSources {
  /** App settings by key (missing keys fall back to the schema defaults where there is one). */
  settings: Readonly<Record<string, unknown>>;
  /** ACTIVE value-list entries by list key. */
  lists: Readonly<Record<string, readonly IntakeListEntry[] | undefined>>;
}

const meta = (e: IntakeListEntry) => (e.meta ?? {}) as Record<string, unknown>;

const codesWhere = (entries: readonly IntakeListEntry[] | undefined, key: string): string[] =>
  (entries ?? []).filter((e) => meta(e)[key] === true).map((e) => e.code);

/** The intake config from settings and active list entries. Throws (zod) when a required setting is missing. */
export function intakeConfigFromSources({ settings: s, lists }: IntakeConfigSources): IntakeConfig {
  const num = (key: string) => (typeof s[key] === 'number' ? s[key] : undefined);
  const optional = <K extends string>(key: K, value: unknown) =>
    value === undefined ? {} : ({ [key]: value } as Record<K, never>);
  return parseIntakeConfig({
    requiredFields: (s.intake_required_fields ?? []) as never,
    volumePlaceholder: s.intake_volume_placeholder ?? {},
    defaultRequestClass:
      typeof s.intake_default_request_class === 'string' ? s.intake_default_request_class : '',
    allowedRequestClasses: (s.intake_allowed_request_classes ?? []) as never,
    redirectMessage: typeof s.intake_redirect_message === 'string' ? s.intake_redirect_message : '',
    ...optional('variantsNoteMaxLength', num('intake_variants_note_max_length')),
    ...optional('freeTextMaxLength', num('intake_free_text_max_length')),
    ...optional('otherDescriptionMaxLength', num('intake_other_description_max_length')),
    ...optional(
      'minSpecFields',
      Array.isArray(s.intake_min_spec_fields) ? s.intake_min_spec_fields : undefined,
    ),
    // FB-11 (F-080): a missing setting means no payment terms are flagged (it is seeded, provisional).
    ...optional(
      'standardPaymentTerms',
      Array.isArray(s.standard_payment_terms) ? s.standard_payment_terms : undefined,
    ),
    // FB-10 (F-066): a missing or malformed setting leaves the platform-minimum warning off.
    guardrails: parseIntakeGuardrails(s.intake_guardrails),
    // FB-12 (F-073): the sub-market's parent market comes from the value list's meta.
    subMarketMarkets: Object.fromEntries(
      (lists.sub_market ?? []).flatMap((e) => {
        const market = meta(e).market;
        return typeof market === 'string' ? [[e.code, market] as const] : [];
      }),
    ),
    // DR-cross-cutting-02 / FB-15: the active codes of every list an intake field picks from.
    listCodes: Object.fromEntries(
      [...new Set(Object.values(INTAKE_LIST_FIELDS).map((f) => f.list))].map((list) => [
        list,
        (lists[list] ?? []).map((e) => e.code),
      ]),
    ),
    deliveredPriceBasisCodes: codesWhere(lists.price_basis, 'delivered'),
    freightOtherCodes: codesWhere(lists.freight_type, 'freeText'),
    sharedFundingCodes: codesWhere(lists.tooling_funding_model, 'customerShare'),
    drawingProvidedCodes: codesWhere(lists.drawing_status, 'hasDrawing'),
    customCodes: Object.fromEntries(
      CUSTOM_LIST_FIELDS.map((list) => [list, codesWhere(lists[list], 'freeText')]),
    ),
    componentFollowUps: Object.fromEntries(
      (lists.component ?? [])
        .filter((e) => Array.isArray(meta(e).followUps))
        .map((e) => [e.code, meta(e).followUps as never]),
    ),
  });
}
