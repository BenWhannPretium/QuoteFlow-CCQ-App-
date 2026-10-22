import type { Readable } from 'node:stream';

import type { PricingHistoryKind } from '@ccq/contracts';
import ExcelJS from 'exceljs';

import { sheetSpecFor } from './exportColumns';

/**
 * Streams the pricing-app export workbook (.xlsx) sheet by sheet, row by row, without loading it
 * whole (the October 2026 file is 28 MB / 47k rows: about 12 s and ~0.5 GB at peak). Sheets that are
 * not ERF / BPR / SPR are ignored. Cell values are passed through raw; `mapExportRow` normalises them.
 */

export class PricingExportError extends Error {
  constructor(
    readonly code: 'INVALID_FILE' | 'MISSING_COLUMNS' | 'NO_SHEETS',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'PricingExportError';
  }
}

export interface ExportSheet {
  kind: PricingHistoryKind;
  sheet: string;
  header: string[];
  /** Mapped columns the sheet lacks (their values become null). */
  missingColumns: string[];
  rows: AsyncIterable<Record<string, unknown>>;
}

type WorksheetReader = AsyncIterable<{ values: unknown }> & { name: string };

/** Header cells → names; data rows → header-keyed objects (empty rows skipped). */
async function* sheetRows(
  rows: AsyncIterator<{ values: unknown }>,
  header: string[],
): AsyncGenerator<Record<string, unknown>> {
  for (let next = await rows.next(); !next.done; next = await rows.next()) {
    const values = next.value.values as unknown[];
    const out: Record<string, unknown> = {};
    let any = false;
    for (let i = 1; i < values.length; i++) {
      const name = header[i - 1];
      if (!name || values[i] === undefined || values[i] === null) continue;
      out[name] = values[i];
      any = true;
    }
    if (any) yield out;
  }
}

/**
 * The ERF / BPR / SPR sheets of an export. Each sheet's `rows` must be consumed before the next
 * sheet is requested (the workbook is streamed). Throws PricingExportError for a file that is not an
 * .xlsx, a known sheet without its required columns, or a workbook with none of the three sheets.
 */
export async function* readPricingExport(input: string | Readable): AsyncGenerator<ExportSheet> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(input, {
    sharedStrings: 'cache',
    worksheets: 'emit',
    hyperlinks: 'ignore',
    // Styles tell a date cell from a number: needed for Created_Date / Modified_Date.
    styles: 'cache',
    entries: 'emit',
  });
  let found = 0;
  try {
    for await (const ws of workbook as unknown as AsyncIterable<WorksheetReader>) {
      const spec = sheetSpecFor(ws.name);
      const rows = ws[Symbol.asyncIterator]();
      if (!spec) {
        for (let n = await rows.next(); !n.done; n = await rows.next()) {
          // Drain an unrelated sheet.
        }
        continue;
      }
      const first = await rows.next();
      const header = first.done
        ? []
        : ((first.value.values as unknown[])
            .slice(1)
            .map((v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '')) ??
          []);
      const missingRequired = spec.required.filter((c) => !header.includes(c));
      if (missingRequired.length > 0) {
        throw new PricingExportError(
          'MISSING_COLUMNS',
          `Sheet "${ws.name}" lacks the required column(s): ${missingRequired.join(', ')}`,
        );
      }
      found++;
      yield {
        kind: spec.kind,
        sheet: ws.name,
        header,
        missingColumns: spec.mapped.filter((c) => !header.includes(c)),
        rows: sheetRows(rows, header),
      };
    }
  } catch (err) {
    if (err instanceof PricingExportError) throw err;
    throw new PricingExportError(
      'INVALID_FILE',
      'The file could not be read as an .xlsx workbook (expected the pricing-app export)',
      { cause: err },
    );
  }
  if (found === 0) {
    throw new PricingExportError(
      'NO_SHEETS',
      'The workbook has no ERF, BPR or SPR sheet (expected "ERF Export", "BPR Export", "SPR Export")',
    );
  }
}

/** Write sheets of header-keyed rows as an .xlsx (tests, the synthetic dev export). */
export async function writeExportXlsx(
  sheets: { name: string; rows: Record<string, unknown>[] }[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const { name, rows } of sheets) {
    const ws = workbook.addWorksheet(name);
    const header = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    ws.addRow(header);
    for (const r of rows) ws.addRow(header.map((h) => r[h] ?? null));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
