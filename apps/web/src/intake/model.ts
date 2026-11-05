import {
  intakeValues,
  type IntakeDraftData,
  type IntakeIssue,
  type PublicConfigResponse,
  type PublicValueListEntry,
  type SfOpportunityDetail,
} from '@ccq/contracts';
import {
  CUSTOM_LIST_FIELDS,
  evaluateIntake,
  fieldsReferenced,
  neckSummary,
  parseIntakeConfig,
  parseNeckText,
  renderDescriptionTemplate,
  type IntakeConfig,
  type IntakeEvaluation,
  type ListEntry,
} from '@ccq/domain';

/**
 * Wizard model. Labels and copy for the four steps live here; which fields block, the help text,
 * the description template and the value lists all come from config (`/config/public`).
 */

export const STEPS = [
  { n: 1, key: 'opportunity', title: 'Opportunity' },
  { n: 2, key: 'customer', title: 'Customer & destination' },
  { n: 3, key: 'product', title: 'Product & volume' },
  { n: 4, key: 'review', title: 'Drawing, files & review' },
] as const;
export type StepNumber = (typeof STEPS)[number]['n'];

/** UI label and wizard step per intake field (snake_case, as the domain reports issues). */
export const FIELD_META: Record<string, { label: string; step: StepNumber }> = {
  sf_opportunity_id: { label: 'Salesforce opportunity', step: 1 },
  customer: { label: 'Customer', step: 2 },
  'customer.name': { label: 'Customer (Salesforce Account)', step: 2 },
  'customer.sf_account_id': { label: 'Salesforce Account', step: 1 },
  ship_to: { label: 'Ship / fill destination', step: 2 },
  'ship_to.line1': { label: 'Destination street', step: 2 },
  'ship_to.city': { label: 'Destination city', step: 2 },
  'ship_to.state': { label: 'Destination state', step: 2 },
  ship_to_override_reason: { label: 'Reason for changing the destination', step: 2 },
  request_class: { label: 'Request class', step: 3 },
  product_family: { label: 'Product family', step: 3 },
  components: { label: 'Components', step: 3 },
  market: { label: 'Market', step: 3 },
  resin: { label: 'Resin', step: 3 },
  neck_diameter: { label: 'Neck diameter', step: 3 },
  neck_diameter_custom: { label: 'Custom neck diameter', step: 3 },
  neck_finish_type: { label: 'Neck finish', step: 3 },
  neck_finish_type_custom: { label: 'Custom neck finish', step: 3 },
  neck_special_feature: { label: 'Special feature', step: 3 },
  neck_special_feature_custom: { label: 'Custom special feature', step: 3 },
  resin_customer_specified: { label: 'Customer-specified resin', step: 3 },
  resin_grade: { label: 'Supplier / grade', step: 3 },
  pcr_level: { label: 'PCR %', step: 3 },
  color_type: { label: 'Color', step: 3 },
  color_description: { label: 'Custom color', step: 3 },
  additives: { label: 'Additives', step: 3 },
  quote_variants_note: { label: 'Quote variants requested', step: 3 },
  liner_spec: { label: 'Liner spec', step: 3 },
  labels_purchased_by: { label: 'Labels purchased by', step: 3 },
  decoration_type: { label: 'Decoration type', step: 3 },
  decoration_print_colors: { label: 'Number of print colors', step: 3 },
  height_mm: { label: 'Height (mm)', step: 3 },
  width_or_diameter_mm: { label: 'Width or diameter (mm)', step: 3 },
  depth_mm: { label: 'Depth (mm)', step: 3 },
  gram_weight_g: { label: 'Gram weight (g)', step: 3 },
  modify_existing_mold: { label: 'Modify an existing mold', step: 3 },
  existing_mold_ref: { label: 'Existing mold / part number', step: 3 },
  mold_change_description: { label: 'What changes', step: 3 },
  drawing_or_min_spec: { label: 'Drawing or minimum spec', step: 4 },
  rfp_link: { label: 'Customer RFP / portal link', step: 4 },
  packaging_type: { label: 'Packaging type', step: 3 },
  packaging_notes: { label: 'Packaging requirements', step: 3 },
  est_annual_volume: { label: 'Estimated annual volume', step: 3 },
  est_annual_revenue: { label: 'Estimated annual revenue', step: 3 },
  quote_needed_by: { label: 'Quote needed by', step: 3 },
  product_needed_by: { label: 'Product needed by', step: 3 },
  container_size: { label: 'Container size', step: 3 },
  standard_description: { label: 'Standard description', step: 3 },
  description: { label: 'Description', step: 3 },
  drawing_status: { label: 'Drawing', step: 4 },
  comments_for_engineering: { label: 'Comments for engineering', step: 4 },
};

/** Label for an issue's field ("a,b" = alternatives). */
export const issueLabel = (issue: IntakeIssue) =>
  issue.field
    .split(',')
    .map((f) => FIELD_META[f]?.label ?? f)
    .filter((v, i, all) => all.indexOf(v) === i)
    .join(' or ');

export const issueStep = (issue: IntakeIssue): StepNumber =>
  FIELD_META[issue.field.split(',')[0] ?? '']?.step ?? 4;

export interface WizardConfig {
  intake: IntakeConfig;
  /** Fields any blocking rule reads, for the "required" marker. */
  requiredFields: Set<string>;
  help: Record<string, string>;
  descriptionTemplate: string;
  newOpportunityUrl: string | null;
  lists: Record<string, PublicValueListEntry[]>;
}

/** Builds the wizard config from `/config/public`; null while a setting is missing (not seeded). */
export function wizardConfig(config: PublicConfigResponse | undefined): WizardConfig | null {
  if (!config) return null;
  const s = config.settings;
  const lists = config.valueLists;
  const meta = (e: PublicValueListEntry, key: string) => e.meta[key] === true;
  try {
    const intake = parseIntakeConfig({
      requiredFields: (s.intake_required_fields ?? []) as never,
      volumePlaceholder: s.intake_volume_placeholder ?? {},
      defaultRequestClass:
        typeof s.intake_default_request_class === 'string' ? s.intake_default_request_class : 'CCQ',
      allowedRequestClasses: (s.intake_allowed_request_classes ?? []) as never,
      redirectMessage:
        typeof s.intake_redirect_message === 'string' ? s.intake_redirect_message : '',
      ...(typeof s.intake_variants_note_max_length === 'number'
        ? { variantsNoteMaxLength: s.intake_variants_note_max_length }
        : {}),
      ...(Array.isArray(s.intake_min_spec_fields)
        ? { minSpecFields: s.intake_min_spec_fields as never }
        : {}),
      drawingProvidedCodes: (lists.drawing_status ?? [])
        .filter((e) => meta(e, 'hasDrawing'))
        .map((e) => e.code),
      customCodes: Object.fromEntries(
        CUSTOM_LIST_FIELDS.map((list) => [
          list,
          (lists[list] ?? []).filter((e) => meta(e, 'freeText')).map((e) => e.code),
        ]),
      ),
      componentFollowUps: Object.fromEntries(
        (lists.component ?? [])
          .filter((e) => Array.isArray(e.meta.followUps))
          .map((e) => [e.code, e.meta.followUps as never]),
      ),
    });
    const required = new Set<string>();
    for (const f of intake.requiredFields.flatMap(fieldsReferenced)) {
      required.add(f);
      required.add(f.split('.')[0]!);
    }
    return {
      intake,
      requiredFields: required,
      help: (s.intake_field_help ?? {}) as Record<string, string>,
      descriptionTemplate:
        typeof s.intake_description_template === 'string' ? s.intake_description_template : '',
      newOpportunityUrl:
        typeof s.salesforce_new_opportunity_url === 'string'
          ? s.salesforce_new_opportunity_url
          : null,
      lists,
    };
  } catch {
    return null;
  }
}

/**
 * The same evaluation the API runs at submit, for instant feedback (the API stays the authority).
 * `hasDrawing`: a bottle or competitor drawing is attached (FB-02, F-016).
 */
export const evaluateDraft = (
  data: IntakeDraftData,
  cfg: WizardConfig,
  hasDrawing: boolean,
): IntakeEvaluation => evaluateIntake(intakeValues(data, hasDrawing), cfg.intake, new Date());

/** The value-list entry for a code (its label and meta). */
export const listEntry = (cfg: WizardConfig, listKey: string, code: string | null | undefined) =>
  code ? cfg.lists[listKey]?.find((e) => e.code === code) : undefined;

/** True when `code` is the list's "Custom" value (meta `freeText`): its description is required. */
export const isCustom = (cfg: WizardConfig, listKey: string, code: string | null | undefined) =>
  listEntry(cfg, listKey, code)?.meta.freeText === true;

const asListEntries = (cfg: WizardConfig, listKey: string): ListEntry[] =>
  (cfg.lists[listKey] ?? []).map((e) => ({
    code: e.code,
    label: e.label,
    freeText: e.meta.freeText === true,
  }));

/** F-010: an SF Neck_Finish__c text ("28-410", "120 DC") as the three-list neck; null when unparseable. */
export const neckFromSalesforce = (cfg: WizardConfig, text: string | null | undefined) =>
  parseNeckText(text, {
    diameters: asListEntries(cfg, 'neck_diameter'),
    finishes: asListEntries(cfg, 'neck_finish_type'),
  });

/** "28 mm / 410 / Tamper Evident" with Custom values shown as their description. */
export function neckLabel(
  cfg: WizardConfig,
  n: {
    neckDiameter?: string | null | undefined;
    neckDiameterCustom?: string | null | undefined;
    neckFinishType?: string | null | undefined;
    neckFinishTypeCustom?: string | null | undefined;
    neckSpecialFeature?: string | null | undefined;
    neckSpecialFeatureCustom?: string | null | undefined;
  },
): string {
  const one = (list: string, code: string | null | undefined, custom: string | null | undefined) =>
    isCustom(cfg, list, code) ? (custom ?? 'Custom') : valueLabel(cfg, list, code) || null;
  return neckSummary({
    diameter: one('neck_diameter', n.neckDiameter, n.neckDiameterCustom),
    finish: one('neck_finish_type', n.neckFinishType, n.neckFinishTypeCustom),
    feature: one('neck_special_feature', n.neckSpecialFeature, n.neckSpecialFeatureCustom),
  });
}

export const valueLabel = (cfg: WizardConfig, listKey: string, code: string | null | undefined) =>
  code ? (cfg.lists[listKey]?.find((e) => e.code === code)?.label ?? code) : '';

export function suggestedDescription(data: IntakeDraftData, cfg: WizardConfig): string {
  return renderDescriptionTemplate(cfg.descriptionTemplate, {
    container_size: data.containerSize ?? '',
    product_family: valueLabel(cfg, 'product_family', data.productFamily),
    resin: valueLabel(cfg, 'resin', data.resin),
    components: (data.components ?? []).map((c) => valueLabel(cfg, 'component', c)),
    market: valueLabel(cfg, 'market', data.market),
  });
}

/** Value-list code matching SF text by code or label, ignoring case and punctuation. */
function matchCode(cfg: WizardConfig, listKey: string, text: string | null | undefined) {
  if (!text) return null;
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  const t = norm(text);
  return cfg.lists[listKey]?.find((e) => norm(e.code) === t || norm(e.label) === t)?.code ?? null;
}

/**
 * Everything SF already knows, so the KAM never re-keys it (FB-02, F-008): the customer (always the
 * opportunity's SF Account, F-007), the default ship / fill destination, amount → revenue, and
 * best-effort resin / neck / volume / container size from the first product specification. What came
 * from SF is recorded in `sfPrefill` and shown read-only with a "from Salesforce" tag; only revenue
 * and the destination (with a reason) can be changed. The SF close date is never copied: the draft
 * shows the latest synced one read-only.
 */
export function prefillFromOpportunity(
  detail: SfOpportunityDetail,
  cfg: WizardConfig,
  current: IntakeDraftData = {},
): IntakeDraftData {
  const o = detail.opportunity;
  const account = detail.account;
  const spec = detail.productSpecs[0];
  const shipTo = account?.shipTo ?? null;
  const usableAmount =
    o.amount !== null && !o.dataQuality.includes('amount_suspect') ? o.amount : null;
  const sfAccountId = account?.id ?? o.accountId ?? null;
  // The KAM's "not yet a Pretium customer" answer survives re-picking an opportunity on the same account.
  const sameAccount = current.customer?.sfAccountId === sfAccountId;
  const sfResin = matchCode(cfg, 'resin', spec?.resin);
  // F-010: SF's Neck_Finish__c by the same rule as the migration; blank when it can't be parsed.
  const sfNeck = neckFromSalesforce(cfg, spec?.neckFinish);
  const sfVolume = spec?.annualVolume ?? null;
  const sfSize = spec?.capacity?.trim() ? spec.capacity.trim() : null;
  const sfPrefill: NonNullable<IntakeDraftData['sfPrefill']> = {
    resin: sfResin,
    neckDiameter: sfNeck?.neckDiameter ?? null,
    neckFinishType: sfNeck?.neckFinishType ?? null,
    neckFinishTypeCustom: sfNeck?.neckFinishTypeCustom ?? null,
    estAnnualVolume: sfVolume,
    containerSize: sfSize,
  };
  return {
    ...current,
    sfOpportunityId: o.id,
    sfOpportunityName: o.name,
    customer: {
      status: sameAccount && current.customer ? current.customer.status : 'existing',
      sfAccountId,
      name: account?.name ?? o.accountName ?? null,
    },
    shipTo,
    shipToDefault: shipTo,
    shipToOverrideReason: null,
    requestClass: current.requestClass ?? cfg.intake.defaultRequestClass,
    estAnnualRevenue: usableAmount,
    estAnnualRevenueSf: o.amount,
    resin: sfResin ?? current.resin ?? null,
    ...(sfNeck
      ? sfNeck
      : {
          neckDiameter: current.neckDiameter ?? null,
          neckFinishType: current.neckFinishType ?? null,
          neckFinishTypeCustom: current.neckFinishTypeCustom ?? null,
        }),
    estAnnualVolume: sfVolume ?? current.estAnnualVolume ?? null,
    containerSize: sfSize ?? current.containerSize ?? null,
    sfPrefill,
  };
}

export const formatUsd = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '—'
    : n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';

export const formatAddress = (a: IntakeDraftData['shipTo']) =>
  a
    ? [a.line1, a.city, [a.state, a.postal].filter(Boolean).join(' '), a.country]
        .filter((p) => p && p.trim())
        .join(', ')
    : '';
