import { normaliseA1, isA1Ref, type ModelSummaryField, type ModelSummaryTemplate } from './config';

/**
 * FB-14: turning what was read from a workbook into a summary. Pure: the API's reader (ExcelJS,
 * streaming, cached values only) builds a `WorkbookSnapshot`; this recognises the template and picks
 * the mapped cells. Nothing here evaluates a formula or "fixes" a value: an Excel error, a negative, a
 * blank or text where a number belongs is carried through as it is and flagged (`warnings.ts`).
 */

/** One cell as the workbook stores it. A missing cell is blank. */
export type CellReading =
  | { kind: 'number'; value: number; formula: boolean }
  | { kind: 'text'; value: string; formula: boolean }
  | { kind: 'date'; value: Date; formula: boolean }
  | { kind: 'boolean'; value: boolean; formula: boolean }
  /** An Excel error. `code` is null when the reader saw an error but not which (a streamed formula). */
  | { kind: 'error'; code: string | null; formula: boolean }
  /** A formula with no cached value: the file was never calculated in Excel. */
  | { kind: 'not_calculated' };

export interface DefinedNameRef {
  name: string;
  /** Null when the name does not resolve to a cell on a sheet of this workbook (#REF!, external). */
  sheet: string | null;
  /** The top-left A1 address, and whether the name covers more than one cell. */
  ref: string | null;
  multiCell: boolean;
}

export interface WorkbookSnapshot {
  sheetNames: readonly string[];
  definedNames: readonly DefinedNameRef[];
  /** The cells of the sheets that were read (sheet name → A1 address → reading). */
  cells: ReadonlyMap<string, ReadonlyMap<string, CellReading>>;
}

export const MODEL_SUMMARY_STATUSES = [
  'complete',
  'partial',
  'unavailable',
  'not_configured',
] as const;
export type ModelSummaryStatus = (typeof MODEL_SUMMARY_STATUSES)[number];

export const MODEL_SUMMARY_REASONS = [
  'not_xlsx',
  'too_large',
  'unreadable',
  'timed_out',
  'not_recognised',
  'not_calculated',
  'fields_not_found',
] as const;
export type ModelSummaryReason = (typeof MODEL_SUMMARY_REASONS)[number];

export const MODEL_SUMMARY_FIELD_STATES = [
  'ok',
  'blank',
  'error',
  'not_calculated',
  'not_found',
  'wrong_type',
  'out_of_range',
] as const;
export type ModelSummaryFieldState = (typeof MODEL_SUMMARY_FIELD_STATES)[number];

export interface ExtractedField {
  key: string;
  label: string;
  unit: ModelSummaryField['unit'];
  type: ModelSummaryField['type'];
  /** Where it was read: the sheet and A1 address (after resolving a defined name). */
  sheet: string;
  ref: string;
  /** The defined name used, when the map's ref was one and the workbook had it. */
  definedName: string | null;
  state: ModelSummaryFieldState;
  number: number | null;
  /** Text values, error codes ("#NUM!", or "error" when the code is unknown) and out-of-range numbers. */
  text: string | null;
  date: Date | null;
  proposed: boolean;
  headline: boolean;
}

export interface ModelSummaryExtraction {
  status: ModelSummaryStatus;
  reason: ModelSummaryReason | null;
  templateId: string | null;
  fields: ExtractedField[];
}

/** Stored as numeric(18, 4) (Fabric-safe): anything at or beyond this is kept as text, flagged. */
export const MODEL_SUMMARY_MAX_ABS = 1e14;
const MAX_TEXT = 500;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function cellText(c: CellReading | undefined): string | null {
  if (!c) return null;
  if (c.kind === 'text') return c.value;
  if (c.kind === 'number') return String(c.value);
  return null;
}

/** The active templates for an attachment kind (inactive maps are never used). */
export function activeTemplates(
  templates: readonly ModelSummaryTemplate[],
  kind: string,
): ModelSummaryTemplate[] {
  return templates.filter((t) => t.kind === kind && t.active);
}

/**
 * The sheets a reader must keep cells for to try every active template of `kind`: recognition
 * sheets, label sheets, field sheets and the sheets the workbook's defined names point at for any
 * field ref that is a name. Sheets outside this set are skipped unread.
 */
export function sheetsToRead(
  templates: readonly ModelSummaryTemplate[],
  kind: string,
  definedNames: readonly DefinedNameRef[],
): Set<string> {
  const out = new Set<string>();
  const byName = definedNameIndex(definedNames);
  for (const t of activeTemplates(templates, kind)) {
    out.add(t.recognise.sheet);
    for (const l of t.recognise.labels) out.add(l.sheet ?? t.recognise.sheet);
    for (const f of t.fields) {
      out.add(f.sheet);
      if (!isA1Ref(f.ref)) {
        const d = byName.get(f.ref.toLowerCase());
        if (d?.sheet) out.add(d.sheet);
      }
    }
  }
  return out;
}

function definedNameIndex(names: readonly DefinedNameRef[]): Map<string, DefinedNameRef> {
  const m = new Map<string, DefinedNameRef>();
  // Excel names are case-insensitive; the first resolvable one wins.
  for (const d of names) {
    const k = d.name.toLowerCase();
    const prior = m.get(k);
    if (!prior || (!prior.sheet && d.sheet)) m.set(k, d);
  }
  return m;
}

/** Whether `template` matches the workbook: its sheet exists and every label cell reads as expected. */
export function templateMatches(
  snapshot: WorkbookSnapshot,
  template: ModelSummaryTemplate,
): boolean {
  if (!snapshot.sheetNames.includes(template.recognise.sheet)) return false;
  return template.recognise.labels.every((l) => {
    const sheet = l.sheet ?? template.recognise.sheet;
    const text = cellText(snapshot.cells.get(sheet)?.get(normaliseA1(l.ref)));
    return text !== null && norm(text).includes(norm(l.contains));
  });
}

function readField(
  snapshot: WorkbookSnapshot,
  field: ModelSummaryField,
  names: Map<string, DefinedNameRef>,
): ExtractedField {
  let sheet = field.sheet;
  let ref: string | null = isA1Ref(field.ref) ? normaliseA1(field.ref) : null;
  let definedName: string | null = null;
  let notFound = false;
  if (ref === null) {
    const d = names.get(field.ref.toLowerCase());
    if (d && d.sheet && d.ref && !d.multiCell) {
      sheet = d.sheet;
      ref = normaliseA1(d.ref);
      definedName = d.name;
    } else if (field.fallbackRef) {
      ref = normaliseA1(field.fallbackRef);
    } else {
      notFound = true;
    }
  }
  const base = {
    key: field.key,
    label: field.label,
    unit: field.unit,
    type: field.type,
    sheet,
    ref: ref ?? field.ref,
    definedName,
    proposed: field.proposed,
    headline: field.headline,
    number: null,
    text: null,
    date: null,
  };
  if (notFound || !snapshot.sheetNames.includes(sheet)) return { ...base, state: 'not_found' };
  const cell = snapshot.cells.get(sheet)?.get(ref!);
  return { ...base, ...valueFor(field.type, cell) };
}

type FieldValue = Pick<ExtractedField, 'state' | 'number' | 'text' | 'date'>;

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
/** Excel's 1900 date system; serials above 9999-12-31 are not dates. */
function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  return new Date(EXCEL_EPOCH_MS + Math.round(serial * 86400000));
}

const empty = { number: null, text: null, date: null };

function valueFor(type: ModelSummaryField['type'], c: CellReading | undefined): FieldValue {
  if (!c) return { state: 'blank', ...empty };
  if (c.kind === 'not_calculated') return { state: 'not_calculated', ...empty };
  if (c.kind === 'error') return { state: 'error', ...empty, text: c.code ?? 'error' };
  if (c.kind === 'text' && c.value.trim() === '') return { state: 'blank', ...empty };
  switch (type) {
    case 'number':
      if (c.kind === 'number') {
        if (!Number.isFinite(c.value)) return { state: 'error', ...empty, text: 'error' };
        if (Math.abs(c.value) >= MODEL_SUMMARY_MAX_ABS) {
          return { state: 'out_of_range', ...empty, text: String(c.value) };
        }
        return { state: 'ok', ...empty, number: c.value };
      }
      // Text that looks like a number stays text: QuoteFlow never reinterprets a cell (flagged).
      return { state: 'wrong_type', ...empty, text: shown(c) };
    case 'date':
      if (c.kind === 'date') return { state: 'ok', ...empty, date: c.value };
      if (c.kind === 'number') {
        const d = excelSerialToDate(c.value);
        return d
          ? { state: 'ok', ...empty, date: d }
          : { state: 'wrong_type', ...empty, text: shown(c) };
      }
      return { state: 'wrong_type', ...empty, text: shown(c) };
    case 'text':
      return { state: 'ok', ...empty, text: shown(c) };
  }
}

function shown(c: CellReading): string {
  switch (c.kind) {
    case 'text':
      return c.value.trim().slice(0, MAX_TEXT);
    case 'number':
      return String(c.value);
    case 'boolean':
      return c.value ? 'TRUE' : 'FALSE';
    case 'date':
      return c.value.toISOString().slice(0, 10);
    default:
      return '';
  }
}

/**
 * The summary of one workbook against the active templates of its kind. The first template that
 * matches is used. No active template for the kind: `not_configured` (quiet). Templates exist but
 * none matches: `unavailable` / `not_recognised`. A recognised workbook is `complete` when every field
 * was found and calculated, `partial` when some were not (the rest still show), and `unavailable` when
 * none was (all not calculated → `not_calculated`, else `fields_not_found`). Errors, blanks, negatives
 * and text in a number field are values, not failures: they are kept and flagged.
 */
export function extractModelSummary(
  snapshot: WorkbookSnapshot,
  templates: readonly ModelSummaryTemplate[],
  kind: string,
): ModelSummaryExtraction {
  const candidates = activeTemplates(templates, kind);
  if (candidates.length === 0) {
    return { status: 'not_configured', reason: null, templateId: null, fields: [] };
  }
  const template = candidates.find((t) => templateMatches(snapshot, t));
  if (!template) {
    return { status: 'unavailable', reason: 'not_recognised', templateId: null, fields: [] };
  }
  const names = definedNameIndex(snapshot.definedNames);
  const fields = template.fields.map((f) => readField(snapshot, f, names));
  const missing = fields.filter((f) => f.state === 'not_found' || f.state === 'not_calculated');
  if (missing.length === fields.length) {
    const allUncalculated = fields.every((f) => f.state === 'not_calculated');
    return {
      status: 'unavailable',
      reason: allUncalculated ? 'not_calculated' : 'fields_not_found',
      templateId: template.templateId,
      fields,
    };
  }
  return {
    status: missing.length ? 'partial' : 'complete',
    reason: null,
    templateId: template.templateId,
    fields,
  };
}

/** A summary that could not be read at all (the reader failed, the file is too large, …). */
export function unavailableSummary(reason: ModelSummaryReason): ModelSummaryExtraction {
  return { status: 'unavailable', reason, templateId: null, fields: [] };
}
