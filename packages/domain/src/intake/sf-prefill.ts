import { parseNeckText, type ListEntry } from './product-facts';

/**
 * FB-32 (N19-04, Sarah Brennan): the Salesforce-to-QuoteFlow prefill map. Which Salesforce product
 * specification field feeds which intake question, and how, is data here instead of logic repeated in
 * two functions of the wizard (`prefillFromOpportunity` for item 1, `itemFromSpec` for "Add from
 * Salesforce products"). Pure: no I/O, nothing is read from or written to Salesforce here.
 *
 * Adding a field Zachary Cairns confirms is one entry in `PREFILL_MAP` plus one in the connector's
 * `fieldMap.ts` (and the DTO in `packages/contracts/src/sf-product-spec.ts`). Nothing is added to the map
 * unless the field is already mapped in `fieldMap.ts`, its meaning is not in doubt and a list match is exact.
 *
 * Two kinds of entry:
 * - `fill`: the intake pre-fills the question, tags it "from Salesforce" and offers the way back
 *   (FB-02, F-008). Value-list matching is the original, forgiving rule (`matchCodeLoose`).
 * - `suggest`: the intake only offers "Salesforce says X, Use this" and fills nothing by itself, and only
 *   when the text equals an entry exactly (`matchCodeExact`). Off unless the setting
 *   `intake_sf_suggestions_enabled` is on (provisional, seeded false).
 */

/** The fields of a Salesforce product specification the map can read (`SfProductSpec`). */
export type SfSpecField =
  'name' | 'productType' | 'resin' | 'capacity' | 'neckFinish' | 'color' | 'annualVolume';

export type SfSpecInput = Partial<Record<SfSpecField, string | number | null | undefined>>;

/**
 * How a Salesforce value becomes an intake value:
 * - `text`: trimmed text, cut to `maxLength`;
 * - `number`: a number as it is;
 * - `neck`: Salesforce's neck text ("28-410") as the three neck lists (diameter, finish, finish description);
 * - `valueList:<key>`: the code of the entry of that value list (loose for `fill`, exact for `suggest`).
 */
export type PrefillMatch = 'text' | 'number' | 'neck' | `valueList:${string}`;

export interface PrefillEntry {
  /** The item key the answer lands on (`neck` fills the three neck keys). */
  quoteflowField: string;
  /** The specification field to read, or several in order of preference (the first non-blank wins). */
  sfSource: SfSpecField | readonly SfSpecField[];
  kind: 'fill' | 'suggest';
  match: PrefillMatch;
  /** `suggest` only: Salesforce's own label for the field (from a describe), shown on the hint. */
  sfLabel?: string;
}

/**
 * The map. `fill` entries are what the intake pre-filled before FB-32 (resin, neck, annual volume,
 * container size), plus item 1's name (FB-32, B1). The one `suggest` entry is Salesforce's "Color"
 * (`Color__c`, a free-text field on the specification, labelled "Color" in the org's describe of
 * 2026-11-19).
 *
 * Considered and not added (see docs/build-guide/feedback/salesforce-prefill-candidates.md): `Product_Type__c`
 * (label "Product Type", a picklist of Competitive, Non-Stock, NPD, RFP, Stock, Stock Plus and Stock Plus
 * Extended: a kind of quote, not a bottle family, so it does not feed the product family question); the
 * market, sub-market, container size and neck finish of the product record (names not confirmed).
 */
export const PREFILL_MAP: readonly PrefillEntry[] = [
  { quoteflowField: 'resin', sfSource: 'resin', kind: 'fill', match: 'valueList:resin' },
  { quoteflowField: 'neck', sfSource: 'neckFinish', kind: 'fill', match: 'neck' },
  { quoteflowField: 'estAnnualVolume', sfSource: 'annualVolume', kind: 'fill', match: 'number' },
  { quoteflowField: 'containerSize', sfSource: 'capacity', kind: 'fill', match: 'text' },
  { quoteflowField: 'label', sfSource: ['name', 'capacity'], kind: 'fill', match: 'text' },
  {
    quoteflowField: 'colorType',
    sfSource: 'color',
    kind: 'suggest',
    match: 'valueList:color_type',
    sfLabel: 'Color',
  },
];

/** The keys of `sfPrefill` the `fill` entries produce, in the order the draft stores them. */
export const SF_PREFILL_KEYS = [
  'resin',
  'neckDiameter',
  'neckFinishType',
  'neckFinishTypeCustom',
  'estAnnualVolume',
  'containerSize',
  'label',
] as const;

const NECK_KEYS = ['neckDiameter', 'neckFinishType', 'neckFinishTypeCustom'] as const;

/** Value lists by key (the wizard's `cfg.lists` fits). */
export type PrefillLists = (listKey: string) => readonly ListEntry[];

const trimmed = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
};

const loose = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
const exact = (v: string) => v.trim().toLowerCase();

/**
 * The value-list code whose code or label equals `text` ignoring case and every non-alphanumeric
 * character ("Wal-Mart" equals "walmart"). The rule the intake has always used to pre-fill the resin.
 */
export function matchCodeLoose(entries: readonly ListEntry[], text: string | null | undefined) {
  if (!text) return null;
  const t = loose(text);
  return entries.find((e) => loose(e.code) === t || loose(e.label) === t)?.code ?? null;
}

/**
 * The value-list code whose code or label equals `text` ignoring only case and surrounding spaces.
 * Stricter than `matchCodeLoose`: punctuation and inner spaces must agree. Used for suggestions, which
 * are a guess about what a Salesforce field means, so only an unmistakable match is offered. An entry
 * that needs a description (`freeText`, "Custom color") is never matched: Salesforce cannot supply it.
 */
export function matchCodeExact(entries: readonly ListEntry[], text: string | null | undefined) {
  const t = trimmed(text);
  if (!t) return null;
  const key = exact(t);
  return (
    entries.find((e) => !e.freeText && (exact(e.code) === key || exact(e.label) === key))?.code ??
    null
  );
}

function sourceValue(spec: SfSpecInput, source: PrefillEntry['sfSource']) {
  for (const s of Array.isArray(source) ? source : [source]) {
    const v = spec[s as SfSpecField];
    if (typeof v === 'number') return v;
    const t = trimmed(v);
    if (t !== null) return t;
  }
  return null;
}

/** What the `fill` entries found: an item key → its value. A key is present only when Salesforce had a usable value. */
export type SfFills = Partial<Record<string, string | number | null>>;

export interface SfFillOptions {
  /** The longest item name (the contracts' `ITEM_LABEL_MAX`). */
  labelMaxLength: number;
  /** Which map to read (default `PREFILL_MAP`). */
  map?: readonly PrefillEntry[];
}

/**
 * The values the `fill` entries read from one product specification. A neck that parses gives all three
 * neck keys (the finish description null when the finish is on the list); one that does not gives none.
 */
export function sfFillsFor(
  spec: SfSpecInput | null | undefined,
  lists: PrefillLists,
  { labelMaxLength, map = PREFILL_MAP }: SfFillOptions,
): SfFills {
  const out: SfFills = {};
  if (!spec) return out;
  for (const entry of map) {
    if (entry.kind !== 'fill') continue;
    const raw = sourceValue(spec, entry.sfSource);
    if (raw === null) continue;
    if (entry.match === 'number') {
      if (typeof raw === 'number') out[entry.quoteflowField] = raw;
    } else if (entry.match === 'neck') {
      const neck =
        typeof raw === 'string'
          ? parseNeckText(raw, {
              diameters: lists('neck_diameter'),
              finishes: lists('neck_finish_type'),
            })
          : null;
      if (neck) for (const k of NECK_KEYS) out[k] = neck[k];
    } else if (entry.match === 'text') {
      if (typeof raw !== 'string') continue;
      out[entry.quoteflowField] =
        entry.quoteflowField === 'label' ? raw.slice(0, labelMaxLength) : raw;
    } else {
      const code =
        typeof raw === 'string'
          ? matchCodeLoose(lists(entry.match.slice('valueList:'.length)), raw)
          : null;
      if (code) out[entry.quoteflowField] = code;
    }
  }
  return out;
}

/** `sfPrefill` for the fills: every key in `SF_PREFILL_KEYS`, null where Salesforce had nothing. */
export function sfPrefillOf(
  fills: SfFills,
): Record<(typeof SF_PREFILL_KEYS)[number], string | number | null> {
  return Object.fromEntries(SF_PREFILL_KEYS.map((k) => [k, fills[k] ?? null])) as Record<
    (typeof SF_PREFILL_KEYS)[number],
    string | number | null
  >;
}

export interface SfSuggestion {
  /** The item key the suggestion would fill. */
  quoteflowField: string;
  /** Salesforce's own label for the field. */
  sfLabel: string;
  /** What Salesforce holds, as it holds it. */
  sfText: string;
  /** The list code "Use this" would set. */
  code: string;
}

/**
 * The hints for one product specification: for each `suggest` entry, "Salesforce says <text>" with the
 * code to set, only when the text equals an entry of that question's list exactly. Never fills anything.
 * The caller shows them only while `intake_sf_suggestions_enabled` is on.
 */
export function sfSuggestionsFor(
  spec: SfSpecInput | null | undefined,
  lists: PrefillLists,
  map: readonly PrefillEntry[] = PREFILL_MAP,
): SfSuggestion[] {
  if (!spec) return [];
  const out: SfSuggestion[] = [];
  for (const entry of map) {
    if (entry.kind !== 'suggest' || !entry.match.startsWith('valueList:')) continue;
    const raw = sourceValue(spec, entry.sfSource);
    if (typeof raw !== 'string') continue;
    const code = matchCodeExact(lists(entry.match.slice('valueList:'.length)), raw);
    if (code) {
      out.push({
        quoteflowField: entry.quoteflowField,
        sfLabel: entry.sfLabel ?? 'Salesforce',
        sfText: raw,
        code,
      });
    }
  }
  return out;
}
