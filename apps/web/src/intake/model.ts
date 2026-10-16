import {
  intakeValues,
  type IntakeDraftData,
  type IntakeIssue,
  type PublicConfigResponse,
  type PublicValueListEntry,
  type SfOpportunityDetail,
} from '@ccq/contracts';
import {
  evaluateIntake,
  fieldsReferenced,
  parseIntakeConfig,
  renderDescriptionTemplate,
  type IntakeConfig,
  type IntakeEvaluation,
} from '@ccq/domain';

/**
 * Wizard model. Labels and copy for the four steps live here; which fields block, the help text,
 * the description template and the value lists all come from config (`/config/public`).
 */

export const STEPS = [
  { n: 1, key: 'opportunity', title: 'Opportunity' },
  { n: 2, key: 'customer', title: 'Customer & ship-to' },
  { n: 3, key: 'product', title: 'Product & volume' },
  { n: 4, key: 'review', title: 'Drawing, notes & review' },
] as const;
export type StepNumber = (typeof STEPS)[number]['n'];

/** UI label and wizard step per intake field (snake_case, as the domain reports issues). */
export const FIELD_META: Record<string, { label: string; step: StepNumber }> = {
  sf_opportunity_id: { label: 'Salesforce opportunity', step: 1 },
  customer: { label: 'Customer', step: 2 },
  'customer.name': { label: 'Customer name', step: 2 },
  ship_to: { label: 'Ship-to / fill location', step: 2 },
  'ship_to.line1': { label: 'Ship-to street', step: 2 },
  'ship_to.city': { label: 'Ship-to city', step: 2 },
  ship_to_override_reason: { label: 'Reason for changing the ship-to', step: 2 },
  request_class: { label: 'Request class', step: 3 },
  product_family: { label: 'Product family', step: 3 },
  components: { label: 'Components', step: 3 },
  market: { label: 'Market', step: 3 },
  resin: { label: 'Resin', step: 3 },
  neck_finish: { label: 'Neck finish / type', step: 3 },
  packaging_type: { label: 'Packaging type', step: 3 },
  packaging_notes: { label: 'Packaging requirements', step: 3 },
  est_annual_volume: { label: 'Estimated annual volume', step: 3 },
  est_annual_revenue: { label: 'Estimated annual revenue', step: 3 },
  expected_close_date: { label: 'Expected close date', step: 3 },
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
  freeTextNeckFinishes: string[];
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
      drawingProvidedCodes: (lists.drawing_status ?? [])
        .filter((e) => meta(e, 'hasDrawing'))
        .map((e) => e.code),
    });
    const required = new Set<string>();
    for (const f of intake.requiredFields.flatMap(fieldsReferenced)) {
      required.add(f);
      required.add(f.split('.')[0]!);
    }
    return {
      intake,
      freeTextNeckFinishes: (lists.neck_finish ?? [])
        .filter((e) => meta(e, 'freeText'))
        .map((e) => e.code),
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

/** The same evaluation the API runs at submit, for instant feedback (the API stays the authority). */
export const evaluateDraft = (data: IntakeDraftData, cfg: WizardConfig): IntakeEvaluation =>
  evaluateIntake(intakeValues(data, cfg.freeTextNeckFinishes), cfg.intake);

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
 * Everything SF already knows, so the KAM never re-keys it: customer (or not yet established when
 * the opportunity has no Account), default ship-to, amount → revenue, close date, and best-effort
 * resin / neck finish / volume from the first product specification.
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
  return {
    ...current,
    sfOpportunityId: o.id,
    sfOpportunityName: o.name,
    customer: account
      ? { status: 'existing', sfAccountId: account.id, name: account.name }
      : { status: 'not_yet_established', sfAccountId: null, name: o.accountName ?? null },
    shipTo,
    shipToDefault: shipTo,
    shipToOverrideReason: null,
    requestClass: current.requestClass ?? cfg.intake.defaultRequestClass,
    estAnnualRevenue: usableAmount,
    estAnnualRevenueSf: o.amount,
    expectedCloseDate: o.closeDate,
    resin: current.resin ?? matchCode(cfg, 'resin', spec?.resin),
    neckFinish: current.neckFinish ?? matchCode(cfg, 'neck_finish', spec?.neckFinish),
    estAnnualVolume: current.estAnnualVolume ?? spec?.annualVolume ?? null,
    containerSize: current.containerSize ?? spec?.capacity ?? null,
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
