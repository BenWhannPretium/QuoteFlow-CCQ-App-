import { DomainError } from '../errors';

/**
 * FB-19 (W13-32 to W13-34, F-084, D-005 open, provisional): multi-item quotes. One quote number, one
 * KAM, one opportunity and one workflow; several items quoted together.
 *
 * Which fields are entered once per quote (the request) and which per item is the data model the
 * build agreed (decisions 2 and 3 of the FB-19 prompt): the item fields below live on `quote_item`,
 * everything else stays on `quote`. Pure: the settings come in as values.
 */

/**
 * The product fields of an item, as the intake's snake_case values (`evaluateIntake` input) and as
 * `quote_item` columns. Every other intake field is request level.
 */
export const ITEM_VALUE_FIELDS = [
  'product_family',
  'product_family_other',
  'components',
  'component_other',
  'liner_spec',
  'labels_purchased_by',
  // FB-24 (N17-02): several at once; `decoration_type` (one code) is deprecated.
  'decoration_types',
  'decoration_type_other',
  'decoration_print_colors',
  'resin',
  'resin_customer_specified',
  'resin_grade',
  'pcr_level',
  'pcr_level_other',
  'color_type',
  'color_description',
  'additive',
  'additives',
  'neck_diameter',
  'neck_diameter_custom',
  'neck_finish_type',
  'neck_finish_type_custom',
  'neck_special_feature',
  'neck_special_feature_custom',
  'container_size',
  'height_mm',
  'width_or_diameter_mm',
  'depth_mm',
  'gram_weight_g',
  'modify_existing_mold',
  'existing_mold_ref',
  'mold_change_description',
  'packaging_type',
  'packaging_notes',
  'drawing_status',
  'est_annual_volume',
  'est_annual_volume_confirmed',
  'product_needed_by',
  'standard_description',
] as const;
export type ItemValueField = (typeof ITEM_VALUE_FIELDS)[number];

/**
 * Fields an intake issue can name that belong to one item: the product fields, the item's own drawings
 * (`has_drawing_attachment`, the drawing-or-minimum-spec rule) and its name.
 */
const ITEM_ISSUE_FIELDS: ReadonlySet<string> = new Set<string>([
  ...ITEM_VALUE_FIELDS,
  'has_drawing_attachment',
  'drawing_or_min_spec',
  // FB-24 (N17-03): a concept item's drawing, or the request's render / photo.
  'drawing_or_render',
  'label',
  'sf_product_spec_id',
]);

/** True when an issue's field (comma-separated alternatives, dotted paths) reads an item field. */
export function isItemField(field: string): boolean {
  return field.split(',').some((f) => ITEM_ISSUE_FIELDS.has(f.trim().split('.')[0] ?? ''));
}

/**
 * Longest item label (the KAM's short name), as `quote_item_label_length_check` and the contract's
 * `ITEM_LABEL_MAX`. FB-24 (N17-05): 120 (was 60).
 */
export const ITEM_LABEL_MAX_LENGTH = 120;

/** `app_setting.quote_items_max` seed (provisional). */
export const QUOTE_ITEMS_MAX_SEED = 20;

/** `app_setting.quote_items_max`: a whole number from 1 to 200 (a missing row reads as the seed). */
export function parseQuoteItemsMax(input: unknown): number {
  if (input === undefined || input === null) return QUOTE_ITEMS_MAX_SEED;
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 1 || input > 200) {
    throw new DomainError(
      'INVALID_CONFIG',
      'quote_items_max must be a whole number from 1 to 200',
      'quote_items_max',
    );
  }
  return input;
}

/** W13-33: may an opportunity have more than one active quote (`app_setting.opportunity_active_quotes`)? */
export const OPPORTUNITY_ACTIVE_QUOTES_MODES = ['one', 'warn'] as const;
export type OpportunityActiveQuotesMode = (typeof OPPORTUNITY_ACTIVE_QUOTES_MODES)[number];
/** Seed (provisional): a KAM may start a separate quote after confirming the warning. */
export const OPPORTUNITY_ACTIVE_QUOTES_SEED: OpportunityActiveQuotesMode = 'warn';

export function parseOpportunityActiveQuotes(input: unknown): OpportunityActiveQuotesMode {
  if (input === undefined || input === null) return OPPORTUNITY_ACTIVE_QUOTES_SEED;
  if (!(OPPORTUNITY_ACTIVE_QUOTES_MODES as readonly unknown[]).includes(input)) {
    throw new DomainError(
      'INVALID_CONFIG',
      `opportunity_active_quotes must be one of: ${OPPORTUNITY_ACTIVE_QUOTES_MODES.join(', ')}`,
      'opportunity_active_quotes',
    );
  }
  return input as OpportunityActiveQuotesMode;
}

/** `app_setting.opportunity_active_quote_message` seed (provisional wording). */
export const OPPORTUNITY_ACTIVE_QUOTE_MESSAGE_SEED =
  '{quoteNumber} is already open for this opportunity (KAM: {kamName}). Add these items to it instead if it is still with you, or continue to start a separate quote.';

export function parseOpportunityActiveQuoteMessage(input: unknown): string {
  if (input === undefined || input === null) return OPPORTUNITY_ACTIVE_QUOTE_MESSAGE_SEED;
  if (typeof input !== 'string' || input.trim() === '' || input.length > 500) {
    throw new DomainError(
      'INVALID_CONFIG',
      'opportunity_active_quote_message must be text of 1 to 500 characters',
      'opportunity_active_quote_message',
    );
  }
  return input;
}

/** An open quote on the same opportunity, as the warning names it (only these two facts). */
export interface OpenQuoteOnOpportunity {
  quoteNumber: string;
  kamName: string | null;
}

/**
 * The warning a KAM sees on an opportunity that already has an active quote: the configured template
 * filled in for each open quote (one sentence each), or null when there is none.
 */
export function activeQuoteWarning(
  template: string,
  open: readonly OpenQuoteOnOpportunity[],
): string | null {
  if (open.length === 0) return null;
  const numbers = open.map((o) => o.quoteNumber).join(', ');
  const kams = [...new Set(open.map((o) => o.kamName ?? 'unknown'))].join(', ');
  return template.replace(/\{quoteNumber\}/g, numbers).replace(/\{kamName\}/g, kams);
}

/** What the submit decides about other active quotes on the opportunity (W13-33). */
export type ActiveQuoteDecision =
  { ok: true; separate: boolean } | { ok: false; reason: 'one' | 'unconfirmed' };

/**
 * `one`: refuse while another quote is open. `warn`: allowed once the KAM confirmed the warning
 * (`confirmed`), refused until then so the KAM always sees it. No open quote: allowed.
 */
export function decideActiveQuotes(
  mode: OpportunityActiveQuotesMode,
  openCount: number,
  confirmed: boolean,
): ActiveQuoteDecision {
  if (openCount === 0) return { ok: true, separate: false };
  if (mode === 'one') return { ok: false, reason: 'one' };
  return confirmed ? { ok: true, separate: true } : { ok: false, reason: 'unconfirmed' };
}

/** "Item 2 (16 oz bottle)", or "Item 2" without a label. */
export function itemName(itemNo: number, label: string | null | undefined): string {
  const l = label?.trim();
  return l ? `Item ${itemNo} (${l})` : `Item ${itemNo}`;
}

/**
 * "16 oz bottle + 2 more": item 1's label (or its name) and how many others. One item: just its label
 * (or "1 item" when it has none).
 */
export function itemsSummary(items: readonly { itemNo: number; label: string | null }[]): string {
  if (items.length === 0) return '';
  const sorted = [...items].sort((a, b) => a.itemNo - b.itemNo);
  const first = sorted[0]!;
  const name =
    first.label?.trim() || (items.length === 1 ? '1 item' : itemName(first.itemNo, null));
  return items.length === 1 ? name : `${name} + ${items.length - 1} more`;
}

/** An item's facts the quote mirror reads (snake_case, `quote_item` columns). */
export type ItemFacts = Readonly<Record<string, unknown>> & {
  est_annual_volume?: unknown;
  est_annual_volume_confirmed?: unknown;
};

/**
 * Decision 6: the product columns on `quote` mirror item 1, the volume is the SUM of every item's
 * (null when no item has one) and it is confirmed only when every item's is. Items in item order;
 * returns the snake_case quote values.
 */
export function quoteMirror(items: readonly ItemFacts[]): Record<string, unknown> {
  const first = items[0] ?? {};
  const out: Record<string, unknown> = {};
  for (const f of ITEM_VALUE_FIELDS) out[f] = first[f] ?? null;
  const volumes = items
    .map((i) => i.est_annual_volume)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  out.est_annual_volume = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) : null;
  out.est_annual_volume_confirmed =
    items.length > 0 && items.every((i) => i.est_annual_volume_confirmed === true);
  return out;
}

/** "2.1 M units a year in total" style volume words for the priority breakdown. */
export function itemsVolumeText(itemCount: number, totalVolume: number | null): string | null {
  if (itemCount <= 1) return null;
  const units =
    totalVolume === null
      ? 'volume not given'
      : totalVolume >= 1_000_000
        ? `${(totalVolume / 1_000_000).toFixed(1).replace(/\.0$/, '')} M units a year in total`
        : `${totalVolume.toLocaleString('en-US')} units a year in total`;
  return `${itemCount} items, ${units}`;
}
