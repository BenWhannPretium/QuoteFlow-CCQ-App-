/**
 * FB-02 product facts at intake (Nov 2–3 walkthroughs): the neck as three pick-lists, "Custom" values
 * that need a short description, the customer-specified resin grade, the quote-variants note and the
 * component follow-ups. Pure: the lists and limits come in as config (value lists, app settings), all
 * provisional.
 */

/** A value-list code whose meta has `freeText` ("Custom") needs its description field (≤ 120). */
export const CUSTOM_DESCRIPTION_FIELDS = {
  neck_diameter: 'neck_diameter_custom',
  neck_finish_type: 'neck_finish_type_custom',
  neck_special_feature: 'neck_special_feature_custom',
  color_type: 'color_description',
} as const;
export type CustomListField = keyof typeof CUSTOM_DESCRIPTION_FIELDS;
export const CUSTOM_LIST_FIELDS = Object.keys(CUSTOM_DESCRIPTION_FIELDS) as CustomListField[];

/** Short-text limits (characters) from the FB-02 prompt and the Field Inventory. */
export const INTAKE_TEXT_LIMITS = {
  custom_description: 120,
  resin_grade: 120,
  additives: 200,
  liner_spec: 120,
  existing_mold_ref: 60,
  mold_change_description: 500,
  rfp_link: 500,
} as const;

/**
 * F-013: the follow-up fields a component can ask for, named in the `component` value list's meta
 * (`followUps`). Shown only when the component is picked, then required; cleared when it is not.
 */
export const COMPONENT_FOLLOW_UP_FIELDS = [
  'liner_spec',
  'labels_purchased_by',
  'decoration_type',
  'decoration_print_colors',
] as const;
export type ComponentFollowUpField = (typeof COMPONENT_FOLLOW_UP_FIELDS)[number];

/** F-013: whole number of print colors for a decoration. */
export const PRINT_COLORS_RANGE = { min: 1, max: 12 } as const;

/** The follow-ups the picked components ask for, in list order, without duplicates. */
export function activeFollowUps(
  components: unknown,
  followUps: Readonly<Record<string, readonly ComponentFollowUpField[]>>,
): ComponentFollowUpField[] {
  const picked = Array.isArray(components) ? (components as unknown[]) : [];
  const out = new Set<ComponentFollowUpField>();
  for (const code of picked) {
    if (typeof code === 'string') for (const f of followUps[code] ?? []) out.add(f);
  }
  return COMPONENT_FOLLOW_UP_FIELDS.filter((f) => out.has(f));
}

// ── Neck (F-010, Jim Zweifel's lists, A-001) ──────────────────────────────────────────────────────

/** Codes and labels of a value list, enough to match free text against it. */
export interface ListEntry {
  code: string;
  label: string;
  /** "Custom": the value needs a description. */
  freeText?: boolean;
}

const norm = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');

function matchEntry(entries: readonly ListEntry[], text: string): ListEntry | undefined {
  const t = norm(text);
  if (!t) return undefined;
  return entries.find((e) => !e.freeText && (norm(e.code) === t || norm(e.label) === t));
}

export interface NeckParts {
  neckDiameter: string | null;
  neckFinishType: string | null;
  neckFinishTypeCustom: string | null;
}

const NECK_TEXT = /^\s*(\d{2,3}D?)\s*(?:MM)?\s*[-–/ ]\s*(.+?)\s*$/i;

/**
 * "28-410", "38/400", "120 DC", "53mm lug" → diameter + finish. The diameter must be on the list; a
 * finish that isn't becomes "Custom" with the text as its description ("DC", "lug"). Null when the
 * text has no listed diameter: the Salesforce pre-fill then leaves the neck blank (F-010).
 */
export function parseNeckText(
  text: string | null | undefined,
  lists: { diameters: readonly ListEntry[]; finishes: readonly ListEntry[] },
): NeckParts | null {
  if (!text) return null;
  const m = NECK_TEXT.exec(text);
  if (!m) return null;
  const diameter = matchEntry(lists.diameters, m[1]!);
  if (!diameter) return null;
  const finish = matchEntry(lists.finishes, m[2]!);
  if (finish) {
    return { neckDiameter: diameter.code, neckFinishType: finish.code, neckFinishTypeCustom: null };
  }
  const custom = lists.finishes.find((e) => e.freeText);
  if (!custom) return null;
  return {
    neckDiameter: diameter.code,
    neckFinishType: custom.code,
    neckFinishTypeCustom: m[2]!.slice(0, INTAKE_TEXT_LIMITS.custom_description),
  };
}

/** The pre-FB-02 `neck_finish` codes that split cleanly (migration 0028). */
export const LEGACY_NECK_SPLITS: Readonly<Record<string, [diameter: string, finish: string]>> = {
  '28-410': ['28', '410'],
  '38-400': ['38', '400'],
  '89-400': ['89', '400'],
  '110-400': ['110', '400'],
};

/**
 * Migration 0028's rule for a stored pre-FB-02 `neck_finish` (repeated in SQL there; the integration
 * test checks they agree): the four standard codes split into diameter + finish; `120-DC` becomes 120
 * + Custom "DC"; any other text (the old "Other" free text) becomes finish Custom with the text kept.
 */
export function migrateLegacyNeckFinish(stored: string | null | undefined): NeckParts {
  const value = stored?.trim() ?? '';
  if (!value) return { neckDiameter: null, neckFinishType: null, neckFinishTypeCustom: null };
  const split = LEGACY_NECK_SPLITS[value];
  if (split)
    return { neckDiameter: split[0], neckFinishType: split[1], neckFinishTypeCustom: null };
  if (value === '120-DC' || value === '120 DC') {
    return { neckDiameter: '120', neckFinishType: 'CUSTOM', neckFinishTypeCustom: 'DC' };
  }
  return {
    neckDiameter: null,
    neckFinishType: 'CUSTOM',
    neckFinishTypeCustom: value.slice(0, INTAKE_TEXT_LIMITS.custom_description),
  };
}

/** "28 mm / 410 / Tamper evident" from codes, for headers and the review (labels resolved by the caller). */
export function neckSummary(parts: {
  diameter: string | null;
  diameterCustom?: string | null;
  finish: string | null;
  finishCustom?: string | null;
  feature?: string | null;
  featureCustom?: string | null;
}): string {
  return [
    parts.diameterCustom ?? parts.diameter,
    parts.finishCustom ?? parts.finish,
    parts.featureCustom ?? parts.feature,
  ]
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .join(' / ');
}

// ── Drawing or minimum spec (F-016, D-018 decided) ────────────────────────────────────────────────

/**
 * The minimum-spec keys `intake_min_spec_fields` may list (D-018: Paul Slomkowski, Jim Zweifel,
 * Matthew Graden, Tania Nazario). "Neck" means diameter and finish.
 * A-024 may add `layerStructure` and a container photo: not fields yet, so not keys yet.
 */
export const MIN_SPEC_KEYS = [
  'height',
  'widthOrDiameter',
  'depth',
  'gramWeight',
  'neck',
  'resin',
  'color',
] as const;
export type MinSpecKey = (typeof MIN_SPEC_KEYS)[number];

/** The intake fields (snake_case) behind each key, with the words the message uses. */
export const MIN_SPEC_FIELDS: Readonly<Record<MinSpecKey, readonly string[]>> = {
  height: ['height_mm'],
  widthOrDiameter: ['width_or_diameter_mm'],
  depth: ['depth_mm'],
  gramWeight: ['gram_weight_g'],
  neck: ['neck_diameter', 'neck_finish_type'],
  resin: ['resin'],
  color: ['color_type'],
};

export const MIN_SPEC_FIELD_LABELS: Readonly<Record<string, string>> = {
  height_mm: 'height',
  width_or_diameter_mm: 'width or diameter',
  depth_mm: 'depth',
  gram_weight_g: 'gram weight',
  neck_diameter: 'neck diameter',
  neck_finish_type: 'neck finish',
  resin: 'resin',
  color_type: 'color',
};

/** F-016: product dimensions in mm and grams, numeric(10,2) in the database. */
export const DIMENSION_FIELDS = [
  'height_mm',
  'width_or_diameter_mm',
  'depth_mm',
  'gram_weight_g',
] as const;
export const DIMENSION_MAX = 99_999_999.99;

/** F-014: an optional customer RFP / portal link: https only, ≤ 500 characters, no spaces. */
export const RFP_LINK_PATTERN = /^https:\/\/[^\s/?#]+\.[^\s/?#]+(?:[/?#]\S*)?$/i;
