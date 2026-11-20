import {
  draftItems,
  INTAKE_ITEM_FIELDS,
  intakeValues,
  type IntakeDraftData,
  type IntakeIssue,
  type IntakeItemData,
  ITEM_LABEL_MAX,
  type PublicConfigResponse,
  type PublicValueListEntry,
  type SfOpportunityDetail,
  type SfProductSpec,
} from '@ccq/contracts';
import {
  activeFollowUps,
  COMPONENT_FOLLOW_UP_FIELDS,
  type ComponentFollowUpField,
  evaluateIntake,
  fieldsReferenced,
  isItemField,
  itemName,
  intakeConfigFromSources,
  MIN_SPEC_FIELDS,
  neckSummary,
  parseNeckText,
  parseShipToSources,
  pickShipTo,
  renderDescriptionTemplate,
  sfFillsFor,
  sfPrefillOf,
  sfSuggestionsFor,
  type SfFills,
  type SfSuggestion,
  type IntakeConfig,
  type IntakeEvaluation,
  type ListEntry,
  type PrefillLists,
  type ShipToSourceKey,
} from '@ccq/domain';

import { calendarDate } from '@/lib/time';
import { marketText, valueListLabel } from '@/lib/value-label';

/**
 * Wizard model. Labels and copy for the four steps live here; which fields block, the help text,
 * the description template and the value lists all come from config (`/config/public`).
 */

export const STEPS = [
  { n: 1, key: 'opportunity', title: 'Opportunity' },
  { n: 2, key: 'customer', title: 'Customer & destination' },
  // FB-19 (W13-32): the request fields once, then the items (each with its product fields).
  { n: 3, key: 'product', title: 'Request & items' },
  { n: 4, key: 'review', title: 'Drawing, files & review' },
] as const;
export type StepNumber = (typeof STEPS)[number]['n'];

/** UI label and wizard step per intake field (snake_case, as the domain reports issues). */
export const FIELD_META: Record<string, { label: string; step: StepNumber }> = {
  sf_opportunity_id: { label: 'Salesforce opportunity', step: 1 },
  customer: { label: 'Customer', step: 2 },
  'customer.name': { label: 'Customer (Salesforce Account)', step: 2 },
  // FB-15: the "no Salesforce Account" notice is on step 2, where its Fix lands.
  'customer.sf_account_id': { label: 'Salesforce Account', step: 2 },
  ship_to: { label: 'Ship / fill destination', step: 2 },
  'ship_to.line1': { label: 'Destination street', step: 2 },
  'ship_to.city': { label: 'Destination city', step: 2 },
  'ship_to.state': { label: 'Destination state', step: 2 },
  ship_to_override_reason: { label: 'Reason for changing the destination', step: 2 },
  request_class: { label: 'Request class', step: 3 },
  // FB-24 (N17-03): a concept's assumptions, and its render, photo or drawing (attached on step 4).
  concept_assumptions: { label: 'Assumptions for this concept', step: 3 },
  drawing_or_render: { label: "Customer's render or photo, or a drawing", step: 4 },
  product_family: { label: 'Product family', step: 3 },
  // FB-15 (W13-03): the field itself is labelled "Describe the …"; these are the review-list names.
  product_family_other: { label: 'Product family description', step: 3 },
  components: { label: 'Components', step: 3 },
  component_other: { label: 'Other component description', step: 3 },
  market: { label: 'Market', step: 3 },
  sub_market: { label: 'Sub-market', step: 3 },
  resin: { label: 'Resin', step: 3 },
  neck_diameter: { label: 'Neck diameter', step: 3 },
  neck_diameter_custom: { label: 'Custom neck diameter', step: 3 },
  neck_finish_type: { label: 'Neck finish', step: 3 },
  neck_finish_type_custom: { label: 'Custom neck finish', step: 3 },
  neck_special_feature: { label: 'Special feature', step: 3 },
  neck_special_feature_custom: { label: 'Custom special feature', step: 3 },
  resin_customer_specified: { label: 'Customer-specified resin', step: 3 },
  resin_grade: { label: 'Customer-specified resin and grade', step: 3 },
  pcr_level: { label: 'PCR %', step: 3 },
  pcr_level_other: { label: 'Customer-specified PCR level', step: 3 },
  additive: { label: 'Additive', step: 3 },
  color_type: { label: 'Color', step: 3 },
  color_description: { label: 'Custom color', step: 3 },
  additives: { label: 'Additives', step: 3 },
  quote_variants_note: { label: 'Quote variants requested', step: 3 },
  liner_spec: { label: 'Liner spec', step: 3 },
  labels_purchased_by: { label: 'Labels purchased by', step: 3 },
  // FB-24 (N17-02): several at once.
  decoration_types: { label: 'Decoration types', step: 3 },
  decoration_type_other: { label: 'Decoration description', step: 3 },
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
  requested_payment_terms: { label: 'Payment terms the customer requests', step: 3 },
  requested_payment_terms_other: { label: 'Requested payment terms (describe)', step: 3 },
  tooling_funding_model: { label: 'Does the customer fund any of the tooling?', step: 3 },
  customer_share_pct: { label: 'Customer share %', step: 3 },
  returnable_dunnage: { label: 'Returnable (multi-trip) dunnage', step: 3 },
  // FB-24 (N18-02, D4).
  tooling_commitment: { label: 'Will the customer commit to the tooling?', step: 3 },
  // FB-31 (N19-10, Sarah Brennan): the contract's words. The field keys are unchanged.
  stock_hold_requested: { label: 'Inventory or safety stock requirements', step: 3 },
  stock_hold_weeks: { label: 'Inventory / safety stock (weeks)', step: 3 },
  stock_hold_note: { label: 'Inventory / safety stock note', step: 3 },
  price_basis: { label: 'Delivered or FOB', step: 3 },
  freight_type: { label: 'Freight type', step: 3 },
  freight_special_arrangements: { label: 'Special freight arrangements', step: 3 },
  // FB-15 (W13-06): customers rarely send their own reference (Bailey Schmitt, Zachary Cairns).
  bid_reference: { label: 'Customer bid / RFP reference (if the customer gave one)', step: 3 },
  packaging_type: { label: 'Packaging type', step: 3 },
  // DR-kam-sales-leader-11: the same name as the field on step 3.
  packaging_notes: { label: 'Customer-specified packaging (describe)', step: 3 },
  est_annual_volume: { label: 'Estimated annual volume', step: 3 },
  est_annual_revenue: { label: 'Estimated annual revenue', step: 3 },
  quote_needed_by: { label: 'Quote needed by', step: 3 },
  product_needed_by: { label: 'Product needed by', step: 3 },
  container_size: { label: 'Container size', step: 3 },
  standard_description: { label: 'Standard description', step: 3 },
  description: { label: 'Description', step: 3 },
  drawing_status: { label: 'Drawing', step: 4 },
  comments_for_engineering: { label: 'Comments for engineering', step: 4 },
  // FB-19 (W13-32): the items.
  items: { label: 'Items', step: 3 },
  label: { label: 'Item name', step: 3 },
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
  /** FB-12: labels of inactive entries by list and code (a rework of a quote on a retired market). */
  retired: Record<string, Record<string, string>>;
  /** FB-24 (N17-01): where the ship-to is pre-filled from, in order (`ship_to_sources`, provisional). */
  shipToSources: ShipToSourceKey[];
  /** FB-32 (N19-04): show the "Salesforce says X, Use this" hints (`intake_sf_suggestions_enabled`, provisional, off). */
  sfSuggestionsEnabled: boolean;
}

/**
 * Builds the wizard config from `/config/public`; null while a setting is missing (not seeded). FB-15
 * (W13-01): the intake config comes from the domain's `intakeConfigFromSources`, the function the API uses
 * too, fed the same settings and the same ACTIVE value lists, so the wizard can no longer call a draft
 * ready that the server refuses (it used to leave the list codes out).
 */
export function wizardConfig(config: PublicConfigResponse | undefined): WizardConfig | null {
  if (!config) return null;
  const s = config.settings;
  const lists = config.valueLists;
  try {
    const intake = intakeConfigFromSources({ settings: s, lists });
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
      retired: config.retiredValues ?? {},
      shipToSources: parseShipToSources(s.ship_to_sources),
      sfSuggestionsEnabled: s.intake_sf_suggestions_enabled === true,
    };
  } catch {
    return null;
  }
}

/**
 * FB-15 (W13-02): every field the server would block on gets the red asterisk: the configured rules plus,
 * while no drawing is attached, the minimum-spec fields (`intake_min_spec_fields`). The conditional
 * follow-ups ("Describe…", a component's liner spec…) mark themselves while they are shown.
 */
export function requiredFieldsNow(
  cfg: WizardConfig,
  hasDrawing: boolean,
  /** FB-24 (N17-03): a concept request: the minimum spec is optional, so no asterisks on it. */
  concept = false,
): Set<string> {
  if (hasDrawing || concept) return cfg.requiredFields;
  const out = new Set(cfg.requiredFields);
  for (const key of cfg.intake.minSpecFields) for (const f of MIN_SPEC_FIELDS[key]) out.add(f);
  return out;
}

/**
 * The same evaluation the API runs at submit, for instant feedback (the API stays the authority).
 * `hasDrawing`: a bottle or competitor drawing is attached (FB-02, F-016). FB-15 (W13-01): `kept` is the
 * reworked quote's own list codes (the draft's `keptListValues`), so a code retired since stays accepted
 * here exactly as on the server.
 */
export const evaluateDraft = (
  data: IntakeDraftData,
  cfg: WizardConfig,
  /** FB-19: per item (its own drawings and links), or one answer for every item. */
  hasDrawing: boolean | ((item: IntakeItemData, index: number) => boolean),
  kept: Record<string, string[]> = {},
  now: Date = new Date(),
  /** FB-24 (N17-03): a sample photo / render is on file (a concept's file rule); omitted = not known. */
  hasRender?: boolean,
): IntakeEvaluation =>
  evaluateIntake(intakeValues(data, hasDrawing, hasRender), cfg.intake, now, kept);

/**
 * FB-15 (W13-01): a problem's field path as the intake's snake_case field. The server sends snake_case
 * (`ship_to.state`), `subMarket`, and JSON-pointer-like paths (`/data/sfOpportunityId`, `/quote_needed_by`).
 */
export function problemField(path: string): string {
  const bare = path.replace(/^\/(data\/)?/, '').replace(/\//g, '.');
  return bare.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * FB-15 (W13-01): every issue a refused submit (422) lists, for the list under the notice. The server's
 * `blocking` (with codes and the min-spec `missing` list) is preferred; otherwise its `errors`.
 */
export function submitProblemIssues(problem: Record<string, unknown>): IntakeIssue[] {
  const blocking = problem.blocking;
  if (Array.isArray(blocking) && blocking.length > 0) {
    return (blocking as IntakeIssue[]).map((b) => ({ ...b, field: problemField(b.field) }));
  }
  const errors = problem.errors;
  if (!Array.isArray(errors)) return [];
  return (errors as { path?: unknown; message?: unknown }[]).flatMap((e) =>
    typeof e.message === 'string'
      ? [
          {
            code: 'SERVER',
            field: typeof e.path === 'string' ? problemField(e.path) : '',
            message: e.message,
          },
        ]
      : [],
  );
}

/** A blocking issue as the wizard's own evaluation lists them (the server's refusals join that list). */
export type SaveIssue = IntakeEvaluation['blocking'][number];

/** "999999999999.99" as "999,999,999,999.99": a limit the server names is easier to read grouped. */
const groupDigits = (text: string) =>
  text.replace(/\d{5,}(?:\.\d+)?/g, (n) =>
    Number(n).toLocaleString('en-US', { maximumFractionDigits: 6 }),
  );

/**
 * UX-017: the fields a refused autosave names. A value outside what the API accepts (a revenue of 16
 * digits) is refused with a 400 whose `errors[].path` points into the request ("/data/estAnnualRevenue",
 * "/data/items/1/heightMm"). The save status used to say only "Request body is invalid". Each error on
 * a field of the form becomes a blocking issue on that field, worded "Label: what to enter", so it shows
 * under the field and in the review list like any other. A path that is not a field of the form is left
 * out: the save status still says the save failed.
 */
export function saveProblemIssues(
  problem: Record<string, unknown>,
  data?: IntakeDraftData,
): SaveIssue[] {
  const errors = problem.errors;
  if (!Array.isArray(errors)) return [];
  const items = data ? draftItems(data) : [];
  const issues: SaveIssue[] = [];
  for (const e of errors as { path?: unknown; message?: unknown }[]) {
    if (typeof e.path !== 'string' || typeof e.message !== 'string') continue;
    const inItem = /^\/data\/items\/(\d+)\/(.+)$/.exec(e.path);
    const field = problemField(inItem ? `/${inItem[2]}` : e.path);
    const label = FIELD_META[field]?.label;
    if (!label) continue;
    // FB-19: an issue names its item only when the intake has several (a one-item intake's are item 1's).
    const item = inItem && items.length > 1 ? Number(inItem[1]) + 1 : undefined;
    if (issues.some((i) => i.field === field && i.item === item)) continue;
    const said = groupDigits(e.message);
    const words = said.startsWith(label)
      ? said
      : `${label}: ${said.charAt(0).toLowerCase()}${said.slice(1)}`;
    issues.push({
      code: 'INVALID_VALUE',
      field,
      message: item === undefined ? words : `${itemName(item, items[item - 1]?.label)}: ${words}`,
      ...(item === undefined ? {} : { item }),
    });
  }
  return issues;
}

/**
 * UX-017: the wizard's evaluation with the fields the server refused on the last save added to the
 * blocking list (unless the wizard already flags the same field), so Submit waits for them too.
 */
export function withSaveIssues(
  evaluation: IntakeEvaluation,
  issues: readonly SaveIssue[],
): IntakeEvaluation {
  const extra = issues.filter(
    (i) =>
      !evaluation.blocking.some(
        (b) => b.code === i.code && b.field === i.field && b.item === i.item,
      ),
  );
  if (extra.length === 0) return evaluation;
  return { ...evaluation, blocking: [...evaluation.blocking, ...extra], ready: false };
}

/**
 * The words for one issue in a list: "Market is required", or the server's own message. FB-19: an item's
 * issue on a multi-item intake names the item ("Item 2 (16 oz bottle): Neck finish is required"); its
 * own message already does.
 */
export const issueText = (issue: IntakeIssue): string => issueTextIn(undefined)(issue);

/** `issueText` naming each item by its label ("Item 2 (16 oz bottle)"), from the draft's items. */
export const issueTextIn =
  (data: IntakeDraftData | undefined) =>
  (issue: IntakeIssue): string => {
    if (issue.code !== 'MISSING_FIELD') return issue.message;
    const text = `${issueLabel(issue)} is required`;
    if (issue.item === undefined) return text;
    const item = data ? draftItems(data)[issue.item - 1] : undefined;
    return `${itemName(issue.item, item?.label)}: ${text}`;
  };

// ── FB-19 (W13-32 to W13-34): the items of an intake ─────────────────────────────────────────────

/** Every key an item holds (its product fields and its own bookkeeping). */
export const ITEM_KEYS: ReadonlySet<string> = new Set<string>([
  ...INTAKE_ITEM_FIELDS,
  'key',
  'label',
  'sfProductSpecId',
  'linkedDrawingIds',
  'duplicatedFrom',
]);

/** A new item's key (a uuid; the quote item id replaces it at submit). */
export const newItemKey = (): string => globalThis.crypto.randomUUID();

/** A blank item. */
export const newItem = (): IntakeItemData => ({ key: newItemKey() });

/**
 * One item as the product fields see it: the request with the item's own fields on top, so a field that
 * reads the market or the quote's need-by date keeps working.
 */
export function itemView(data: IntakeDraftData, index: number): IntakeDraftData {
  const item = draftItems(data)[index];
  return item ? { ...data, ...item } : data;
}

/**
 * Splits a patch made on an item's view: the item's own keys go to that item, the rest to the request.
 * Returns the draft patch to apply (`items` replaced as a whole).
 */
export function routeItemPatch(
  current: IntakeDraftData,
  index: number,
  patch: Partial<IntakeDraftData>,
): Partial<IntakeDraftData> {
  const items = draftItems(current);
  const own: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) (ITEM_KEYS.has(k) ? own : rest)[k] = v;
  if (Object.keys(own).length === 0) return rest;
  return {
    ...(rest as Partial<IntakeDraftData>),
    items: items.map((it, i) => (i === index ? { ...it, ...own } : it)),
  };
}

/**
 * F-084 "duplicate and change only the container fields": a copy of every product field (the label gets
 * "(copy)") and of the item's drawings, as links to the same files.
 */
export function duplicateItem(
  item: IntakeItemData,
  ownDrawingIds: readonly string[],
): IntakeItemData {
  const label = item.label?.trim();
  return {
    ...item,
    key: newItemKey(),
    label: label ? `${label} (copy)`.slice(0, ITEM_LABEL_MAX) : null,
    duplicatedFrom: item.key,
    sfProductSpecId: null,
    linkedDrawingIds: [...new Set([...(item.linkedDrawingIds ?? []), ...ownDrawingIds])],
  };
}

/** Moves the item at `from` to `to` (both in range), keeping the others in order. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/**
 * The issues the selected item's fields show: the request's (no item) and that item's own. A one-item
 * intake's issues carry no item number: all of them are item 1's.
 */
export function scopeEvaluation(evaluation: IntakeEvaluation, itemNo: number): IntakeEvaluation {
  const keep = (i: IntakeIssue) => !isItemField(i.field) || (i.item ?? 1) === itemNo;
  return {
    blocking: evaluation.blocking.filter(keep),
    warnings: evaluation.warnings.filter(keep),
    ready: evaluation.ready,
  };
}

/** How many blocking issues each item has (the Items list's "n to do"), by item number. */
export function itemIssueCounts(evaluation: IntakeEvaluation, itemCount: number): number[] {
  return Array.from(
    { length: itemCount },
    (_, i) =>
      evaluation.blocking.filter((b) => isItemField(b.field) && (b.item ?? 1) === i + 1).length,
  );
}

/** "16 oz bottle", "Item 2", for lists and headings. */
export const draftItemName = (item: IntakeItemData, index: number) =>
  itemName(index + 1, item.label);

/** The value-list entry for a code (its label and meta). */
export const listEntry = (cfg: WizardConfig, listKey: string, code: string | null | undefined) =>
  code ? cfg.lists[listKey]?.find((e) => e.code === code) : undefined;

/** True when `code` is the list's "Custom" value (meta `freeText`): its description is required. */
export const isCustom = (cfg: WizardConfig, listKey: string, code: string | null | undefined) =>
  listEntry(cfg, listKey, code)?.meta.freeText === true;

/**
 * F-013: each component follow-up's draft key and its cleared value. The decoration types are a list
 * since FB-24 (N17-02), so they clear to `[]`. Clearing them to `null` crashed the wizard on any
 * component click ("decorationTypes is not iterable", shown as "Can't reach QuoteFlow") and made
 * every autosave fail the draft schema (2026-11-19).
 */
const FOLLOW_UP_CLEARED = {
  liner_spec: { linerSpec: null },
  labels_purchased_by: { labelsPurchasedBy: null },
  decoration_types: { decorationTypes: [], decorationType: undefined },
  decoration_print_colors: { decorationPrintColors: null },
} as const satisfies Record<ComponentFollowUpField, Partial<IntakeItemData>>;

/**
 * The patch for ticking or unticking a component: the picked codes in list order, with the follow-ups
 * of components no longer picked cleared. An unpicked "Other" (or Decoration) takes its description
 * with it (FB-15, W13-03).
 */
export function componentTogglePatch(
  data: IntakeDraftData,
  code: string,
  on: boolean,
  cfg: WizardConfig,
): Partial<IntakeDraftData> {
  const set = new Set(data.components ?? []);
  if (on) set.add(code);
  else set.delete(code);
  const components = (cfg.lists.component ?? []).map((e) => e.code).filter((c) => set.has(c));
  const active = activeFollowUps(components, cfg.intake.componentFollowUps);
  const cleared: Partial<IntakeDraftData> = {};
  for (const f of COMPONENT_FOLLOW_UP_FIELDS) {
    if (!active.includes(f)) Object.assign(cleared, FOLLOW_UP_CLEARED[f]);
  }
  if (!components.some((c) => isCustom(cfg, 'component', c))) cleared.componentOther = null;
  if (!active.includes('decoration_types')) cleared.decorationTypeOther = null;
  return { components, ...cleared };
}

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
  valueListLabel({ valueLists: cfg.lists, retiredValues: cfg.retired }, listKey, code) ?? '';

/** FB-12: "Food › Snacks & Confections" for the review step and the suggested description. */
export const marketLabel = (cfg: WizardConfig, data: IntakeDraftData): string | null =>
  marketText({ valueLists: cfg.lists, retiredValues: cfg.retired }, data.market, data.subMarket);

export function suggestedDescription(data: IntakeDraftData, cfg: WizardConfig): string {
  return renderDescriptionTemplate(cfg.descriptionTemplate, {
    container_size: data.containerSize ?? '',
    product_family: valueLabel(cfg, 'product_family', data.productFamily),
    resin: valueLabel(cfg, 'resin', data.resin),
    components: (data.components ?? []).map((c) => valueLabel(cfg, 'component', c)),
    market: valueLabel(cfg, 'market', data.market),
  });
}

/** The value lists as the prefill map reads them (FB-32). */
const listsOf =
  (cfg: WizardConfig): PrefillLists =>
  (listKey) =>
    asListEntries(cfg, listKey);

/** What the prefill map's `fill` entries read from one product specification (FB-32). */
const sfFillsOf = (spec: SfProductSpec | undefined, cfg: WizardConfig): SfFills =>
  sfFillsFor(spec, listsOf(cfg), { labelMaxLength: ITEM_LABEL_MAX });

const fillText = (fills: SfFills, key: string): string | null => {
  const v = fills[key];
  return typeof v === 'string' ? v : null;
};
const fillNumber = (fills: SfFills, key: string): number | null => {
  const v = fills[key];
  return typeof v === 'number' ? v : null;
};
/** The three neck keys of the fills (all present when Salesforce's neck text parsed, none otherwise). */
const fillNeck = (fills: SfFills) =>
  'neckDiameter' in fills
    ? {
        neckDiameter: fillText(fills, 'neckDiameter'),
        neckFinishType: fillText(fills, 'neckFinishType'),
        neckFinishTypeCustom: fillText(fills, 'neckFinishTypeCustom'),
      }
    : null;

/**
 * FB-32 (N19-04): the "Salesforce says X, Use this" hints for one item's product specification, from the
 * prefill map's `suggest` entries. Nothing while `intake_sf_suggestions_enabled` is off, none for a field
 * the specification does not have or whose text is not exactly a list entry.
 */
export function sfSuggestionsForSpec(
  spec: SfProductSpec | undefined,
  cfg: WizardConfig,
): SfSuggestion[] {
  return cfg.sfSuggestionsEnabled ? sfSuggestionsFor(spec, listsOf(cfg)) : [];
}

/**
 * Everything SF already knows, so the KAM never re-keys it (FB-02, F-008): the customer (always the
 * opportunity's SF Account, F-007), the default ship / fill destination, amount → revenue, and
 * best-effort resin / neck / volume / container size from the first product specification. What came
 * from SF is recorded in `sfPrefill`: the wizard pre-fills the field, tags it "from Salesforce" and lets
 * the KAM change it (nothing is written back to Salesforce). The SF close date is never copied: the
 * draft shows the latest synced one read-only.
 */
export function prefillFromOpportunity(
  detail: SfOpportunityDetail,
  cfg: WizardConfig,
  current: IntakeDraftData = {},
): IntakeDraftData {
  const o = detail.opportunity;
  const account = detail.account;
  // FB-15 (W13-04): the pre-fill still uses the first specification; every one is kept for FB-19.
  const spec = detail.productSpecs[0];
  // FB-24 (N17-01): the ship-to from the first source in `ship_to_sources` with a city and a state (the
  // first product specification is item 1's), and where it came from. The opportunity's free-text
  // "Ship to Locations" is kept to show beside it, never parsed.
  const picked = pickShipTo(cfg.shipToSources, { productSpec: spec, account: account?.shipTo });
  const shipTo = picked?.address ?? null;
  const sfShipToLocations = o.shipToLocations?.trim() ? o.shipToLocations.trim() : null;
  const usableAmount =
    o.amount !== null && !o.dataQuality.includes('amount_suspect') ? o.amount : null;
  const sfAccountId = account?.id ?? o.accountId ?? null;
  // The KAM's "not yet a Pretium customer" answer survives re-picking an opportunity on the same account.
  const sameAccount = current.customer?.sfAccountId === sfAccountId;
  // FB-32: what Salesforce supplies comes from the prefill map (`PREFILL_MAP`), not from code here.
  const fills = sfFillsOf(spec, cfg);
  // FB-19: the first specification pre-fills item 1 (the others can be added from the Items list).
  const [first, ...others] = draftItems(current);
  // FB-32 (B1): item 1's name comes from Salesforce only while the KAM has not typed one. A name that is
  // the one Salesforce supplied last time is not typed: a different opportunity replaces it.
  const typedLabel =
    first?.label?.trim() && first.label !== first.sfPrefill?.label ? first.label : null;
  if (typedLabel) delete fills.label;
  const sfNeck = fillNeck(fills);
  const item1: IntakeItemData = {
    ...(first ?? newItem()),
    key: first?.key ?? newItemKey(),
    sfProductSpecId: spec?.id ?? first?.sfProductSpecId ?? null,
    label: fillText(fills, 'label') ?? typedLabel,
    resin: fillText(fills, 'resin') ?? first?.resin ?? null,
    // F-010: SF's Neck_Finish__c by the same rule as the migration; blank when it can't be parsed.
    ...(sfNeck
      ? sfNeck
      : {
          neckDiameter: first?.neckDiameter ?? null,
          neckFinishType: first?.neckFinishType ?? null,
          neckFinishTypeCustom: first?.neckFinishTypeCustom ?? null,
        }),
    estAnnualVolume: fillNumber(fills, 'estAnnualVolume') ?? first?.estAnnualVolume ?? null,
    containerSize: fillText(fills, 'containerSize') ?? first?.containerSize ?? null,
    sfPrefill: sfPrefillOf(fills) as NonNullable<IntakeDraftData['sfPrefill']>,
  };
  const request = Object.fromEntries(
    Object.entries(current).filter(([k]) => !ITEM_KEYS.has(k)),
  ) as IntakeDraftData;
  return {
    ...request,
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
    shipToSource: picked?.source ?? null,
    sfShipToLocations,
    requestClass: current.requestClass ?? cfg.intake.defaultRequestClass,
    estAnnualRevenue: usableAmount,
    estAnnualRevenueSf: o.amount,
    items: [item1, ...others],
    sfProductSpecs: detail.productSpecs.slice(0, 50),
    sfProductSpecsStatus: detail.productSpecsStatus,
  };
}

/**
 * FB-19 (W13-32): "Add from Salesforce products": one item per product specification the opportunity
 * had, pre-filled the way item 1 is (resin, neck, volume and container size), tagged "from Salesforce".
 */
export function itemFromSpec(spec: SfProductSpec, cfg: WizardConfig): IntakeItemData {
  const fills = sfFillsOf(spec, cfg);
  return {
    key: newItemKey(),
    label: fillText(fills, 'label'),
    sfProductSpecId: spec.id,
    resin: fillText(fills, 'resin'),
    ...(fillNeck(fills) ?? {}),
    estAnnualVolume: fillNumber(fills, 'estAnnualVolume'),
    containerSize: fillText(fills, 'containerSize'),
    sfPrefill: sfPrefillOf(fills) as NonNullable<IntakeDraftData['sfPrefill']>,
  };
}

export const formatUsd = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '—'
    : n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** DR-kam-sales-leader-13: the one calendar-date style ("Nov 30, 2026"). */
export const formatDate = (iso: string | null | undefined) => calendarDate(iso, '—');

export const formatAddress = (a: IntakeDraftData['shipTo']) =>
  a
    ? [a.line1, a.city, [a.state, a.postal].filter(Boolean).join(' '), a.country]
        .filter((p) => p && p.trim())
        .join(', ')
    : '';
