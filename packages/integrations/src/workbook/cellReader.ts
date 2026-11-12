import { Readable } from 'node:stream';

import ExcelJS from 'exceljs';

/**
 * FB-14 (D-013): read the cells of an uploaded model workbook (.xlsx) for its one-page summary.
 *
 * Read-only and bounded. The workbook is streamed (ExcelJS's WorkbookReader, as the pricing-history
 * export reader does): only the sheets the caller asks for are kept, every other sheet is skipped, and
 * the read stops at a deadline or a cell budget. Only the values Excel cached when the file was last
 * saved are read: no formula is evaluated, no macro runs, no external link is followed, nothing goes
 * over the network. A formula without a cached value reads as `not_calculated`; a cached Excel error
 * reads as `error` (the streaming reader keeps that it was an error, not which one, for a formula).
 *
 * The shapes below match `@ccq/domain`'s `WorkbookSnapshot` (structurally) without depending on it.
 */

export type WorkbookCellReading =
  | { kind: 'number'; value: number; formula: boolean }
  | { kind: 'text'; value: string; formula: boolean }
  | { kind: 'date'; value: Date; formula: boolean }
  | { kind: 'boolean'; value: boolean; formula: boolean }
  | { kind: 'error'; code: string | null; formula: boolean }
  | { kind: 'not_calculated' };

export interface WorkbookDefinedName {
  name: string;
  sheet: string | null;
  ref: string | null;
  multiCell: boolean;
}

export interface WorkbookCells {
  sheetNames: string[];
  definedNames: WorkbookDefinedName[];
  cells: Map<string, Map<string, WorkbookCellReading>>;
}

export class WorkbookReadError extends Error {
  constructor(
    readonly code: 'UNREADABLE' | 'TIMED_OUT' | 'TOO_MANY_CELLS',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'WorkbookReadError';
  }
}

export interface ReadWorkbookCellsOptions {
  /** Which sheets to keep, decided once the defined names are known. */
  sheetsToRead(definedNames: readonly WorkbookDefinedName[]): ReadonlySet<string>;
  timeoutMs: number;
  maxCells: number;
  /** Clock for the deadline (tests). */
  now?: () => number;
}

const MAX_TEXT = 2000;

/** `'4. Investment'!$O$18` gives the sheet and top-left address; external (`[1]...`) and `#REF!` give null. */
export function parseDefinedNameRange(range: string): {
  sheet: string | null;
  ref: string | null;
  multiCell: boolean;
} {
  const m =
    /^(?:'((?:[^']|'')+)'|([^!'[\]]+))!\$?([A-Z]{1,3})\$?([0-9]+)(?::\$?([A-Z]{1,3})\$?([0-9]+))?$/.exec(
      range.trim(),
    );
  if (!m) return { sheet: null, ref: null, multiCell: false };
  const sheet = (m[1] ?? m[2] ?? '').replace(/''/g, "'");
  const ref = `${m[3]}${m[4]}`;
  const multiCell = m[5] !== undefined && `${m[5]}${m[6]}` !== ref;
  return { sheet, ref, multiCell };
}

interface RawDefinedName {
  name?: unknown;
  ranges?: unknown;
  localSheetId?: unknown;
}

function definedNamesOf(model: unknown): WorkbookDefinedName[] {
  const raw = (model as { definedNames?: RawDefinedName[] } | undefined)?.definedNames ?? [];
  const out: (WorkbookDefinedName & { local: boolean })[] = [];
  for (const d of raw) {
    if (typeof d.name !== 'string' || d.name.startsWith('_xlnm.')) continue;
    const ranges = Array.isArray(d.ranges)
      ? d.ranges.filter((r): r is string => typeof r === 'string')
      : [];
    const first = ranges[0]
      ? parseDefinedNameRange(ranges[0])
      : { sheet: null, ref: null, multiCell: false };
    out.push({
      name: d.name,
      sheet: first.sheet,
      ref: first.ref,
      multiCell: first.multiCell || ranges.length > 1,
      local: d.localSheetId !== undefined,
    });
  }
  // Workbook-scoped names before sheet-scoped ones of the same name.
  out.sort((a, b) => Number(a.local) - Number(b.local));
  return out.map(({ local: _local, ...d }) => d);
}

type ExcelCell = {
  type: ExcelJS.ValueType;
  value: unknown;
  model: { result?: unknown };
  address: string;
};

/** One streamed cell as a reading; null for an empty cell. */
export function readingOf(cell: ExcelCell): WorkbookCellReading | null {
  const V = ExcelJS.ValueType;
  const v = cell.value;
  if (cell.type === V.Formula) {
    const r = cell.model.result;
    if (r === undefined || r === null) return { kind: 'not_calculated' };
    if (typeof r === 'number') {
      // A cached error comes through the stream as NaN (the code is not kept).
      return Number.isNaN(r)
        ? { kind: 'error', code: null, formula: true }
        : { kind: 'number', value: r, formula: true };
    }
    if (typeof r === 'string') return { kind: 'text', value: r.slice(0, MAX_TEXT), formula: true };
    if (typeof r === 'boolean') return { kind: 'boolean', value: r, formula: true };
    if (r instanceof Date) return { kind: 'date', value: r, formula: true };
    if (typeof r === 'object' && 'error' in r) {
      return { kind: 'error', code: String(r.error), formula: true };
    }
    return { kind: 'error', code: null, formula: true };
  }
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return { kind: 'number', value: v, formula: false };
  if (typeof v === 'string') return { kind: 'text', value: v.slice(0, MAX_TEXT), formula: false };
  if (typeof v === 'boolean') return { kind: 'boolean', value: v, formula: false };
  if (v instanceof Date) return { kind: 'date', value: v, formula: false };
  if (typeof v === 'object') {
    if ('error' in v) {
      return { kind: 'error', code: String(v.error), formula: false };
    }
    if ('richText' in v && Array.isArray(v.richText)) {
      const text = (v as { richText: { text?: unknown }[] }).richText
        .map((t) => (typeof t.text === 'string' ? t.text : ''))
        .join('');
      return { kind: 'text', value: text.slice(0, MAX_TEXT), formula: false };
    }
    if ('text' in v && typeof v.text === 'string') {
      return {
        kind: 'text',
        value: (v as { text: string }).text.slice(0, MAX_TEXT),
        formula: false,
      };
    }
  }
  return null;
}

type StreamedRow = {
  eachCell(opts: { includeEmpty: boolean }, fn: (c: ExcelCell) => void): void;
};
type StreamedSheet = AsyncIterable<StreamedRow> & { name?: string };
type ReaderModel = { sheets?: { name?: unknown }[]; definedNames?: unknown };

/**
 * A buffer as 64 KB chunks, as a file stream would deliver it. Handed over as one chunk, unzipper ends
 * the entry stream early when ExcelJS parks the sheets in temp files (Excel writes the shared strings
 * after the sheets), and the shared strings are never read.
 */
function* chunks(buf: Buffer, size = 64 * 1024): Generator<Buffer> {
  for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size);
}

/**
 * Read the kept sheets' cells. Throws WorkbookReadError: UNREADABLE (not an .xlsx, corrupt),
 * TIMED_OUT (past `timeoutMs`), TOO_MANY_CELLS (past `maxCells`).
 */
export async function readWorkbookCells(
  input: Buffer | Readable,
  opts: ReadWorkbookCellsOptions,
): Promise<WorkbookCells> {
  const now = opts.now ?? (() => Date.now());
  const deadline = now() + opts.timeoutMs;
  const stream = Buffer.isBuffer(input) ? Readable.from(chunks(input)) : input;
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      stream.destroy();
      reject(new WorkbookReadError('TIMED_OUT', 'The workbook took too long to read'));
    }, opts.timeoutMs);
  });
  try {
    return await Promise.race([read(stream, opts, now, deadline), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

async function read(
  stream: Readable,
  opts: ReadWorkbookCellsOptions,
  now: () => number,
  deadline: number,
): Promise<WorkbookCells> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(stream, {
    worksheets: 'emit',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    // Styles tell a date from a number (a typed date cell).
    styles: 'cache',
    entries: 'emit',
  });
  const modelOf = () => (reader as unknown as { model?: ReaderModel }).model;
  const cells = new Map<string, Map<string, WorkbookCellReading>>();
  let wanted: ReadonlySet<string> | null = null;
  let count = 0;
  const check = () => {
    if (now() > deadline) {
      throw new WorkbookReadError('TIMED_OUT', 'The workbook took too long to read');
    }
  };
  try {
    for await (const ws of reader as unknown as AsyncIterable<StreamedSheet>) {
      check();
      // Excel writes workbook.xml (sheet names, defined names) before the sheets. A workbook written
      // the other way round makes ExcelJS fail, and the file reads as UNREADABLE (the upload is kept).
      wanted ??= opts.sheetsToRead(definedNamesOf(modelOf()));
      const name = ws.name ?? '';
      if (!name || !wanted.has(name)) continue; // skipped: ExcelJS drains it unparsed
      const sheet = new Map<string, WorkbookCellReading>();
      cells.set(name, sheet);
      for await (const row of ws) {
        check();
        row.eachCell({ includeEmpty: false }, (cell) => {
          const r = readingOf(cell);
          if (!r) return;
          if (++count > opts.maxCells) {
            throw new WorkbookReadError(
              'TOO_MANY_CELLS',
              'The workbook has too many cells to read',
            );
          }
          sheet.set(cell.address, r);
        });
      }
    }
  } catch (err) {
    if (err instanceof WorkbookReadError) throw err;
    throw new WorkbookReadError('UNREADABLE', 'The file could not be read as an .xlsx workbook', {
      cause: err,
    });
  }
  const model = modelOf();
  const listed = (model?.sheets ?? [])
    .map((s) => (typeof s.name === 'string' ? s.name : null))
    .filter((s): s is string => s !== null);
  if (wanted === null || listed.length === 0) {
    // No worksheet, or no workbook part: not a workbook QuoteFlow can summarise.
    throw new WorkbookReadError('UNREADABLE', 'The file is not a workbook with sheets');
  }
  return { sheetNames: listed, definedNames: definedNamesOf(model), cells };
}
