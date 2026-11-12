import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ExcelJS from 'exceljs';
import JSZip from 'jszip';

/**
 * FB-14 synthetic model workbooks for tests and local UAT (CLAUDE.md rule 8). Built from scratch with
 * ExcelJS: the sheet names and label cells follow the **structure** of the templates received
 * 2026-11-11 (`docs/build-guide/feedback/inputs/*-structure.md`), and every number, name and label
 * value is made up (round numbers, "Synthetic" names). Nothing is copied from a real file.
 *
 * Run `pnpm --filter @ccq/integrations exec tsx test/synthetic-workbooks.ts <dir>` to write the
 * `*.synthetic.xlsx` files for a manual check; tests build them in memory.
 *
 * ExcelJS writes `xl/workbook.xml` as the last zip entry; Excel writes it right after the content
 * types, before the sheets. `asExcelOrder` re-packs the bytes with the workbook first (see PART_ORDER).
 */

/** A cached value: a number, `{ text }`, an Excel error, a formula never calculated, or an empty cell. */
type Cached = number | { text: string } | { error: string } | 'uncalculated' | 'blank';

export interface PaybackWorkbookOptions {
  /** Cached values of the headline cells (defaults: plausible round numbers). */
  units?: Cached;
  netSales?: Cached;
  materialMargin?: Cached;
  plSavings?: Cached;
  capitalRequest?: Cached;
  payback?: Cached;
  simplePayback?: Cached;
  hurdle?: Cached;
  npv?: Cached;
  irr?: Cached;
  /** Add the QF_ defined names Finance is asked to add (pointing at the same cells). */
  definedNames?: boolean;
  /** Pad with a filler sheet of this many rows (makes a multi-MB file that is never read). */
  fillerRows?: number;
  /** Change the summary sheet's title (an unrecognised layout). */
  title?: string;
}

const SUMMARY = '0. Financial Summary';
const ASSUMPTIONS = '1. Overarching Asssumptions';
const INVESTMENT = '4. Investment';
const BUSINESS_CASE = '5. Business Case';

/**
 * The part order the synthetic files use: content types, package rels, the workbook and its rels, the
 * shared strings and styles, then the sheets. ExcelJS's streaming reader then reads each sheet as it
 * arrives. (Excel itself writes the shared strings after the sheets; ExcelJS parks those sheets in temp
 * files, which works for Excel's files but drops parts of JSZip-written ones, so the synthetic files
 * avoid that path. The received drafts were checked through the reader separately.)
 */
const PART_ORDER = [
  /^\[Content_Types\]\.xml$/,
  /^_rels\/\.rels$/,
  /^xl\/workbook\.xml$/,
  /^xl\/_rels\/workbook\.xml\.rels$/,
  /^xl\/sharedStrings\.xml$/,
  /^xl\/styles\.xml$/,
  /^xl\/theme\//,
  /^xl\/worksheets\/sheet\d+\.xml$/,
];

async function asExcelOrder(buf: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  const files = Object.values(zip.files).filter((f) => !f.dir);
  const rank = (name: string) => {
    const i = PART_ORDER.findIndex((re) => re.test(name));
    return i === -1 ? PART_ORDER.length : i;
  };
  const sheetNo = (name: string) => Number(/sheet(\d+)\.xml$/.exec(name)?.[1] ?? 0);
  files.sort((a, b) => rank(a.name) - rank(b.name) || sheetNo(a.name) - sheetNo(b.name));
  const out = new JSZip();
  for (const f of files) out.file(f.name, await f.async('nodebuffer'));
  return out.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return asExcelOrder(Buffer.from(await wb.xlsx.writeBuffer()));
}

function put(ws: ExcelJS.Worksheet, ref: string, v: Cached, formula = 'SUM(1)') {
  const cell = ws.getCell(ref);
  if (v === 'blank') return;
  if (v === 'uncalculated') {
    cell.value = { formula };
    return;
  }
  const result = typeof v === 'object' && 'text' in v ? v.text : v;
  cell.value = { formula, result } as ExcelJS.CellFormulaValue;
}

/** A workbook shaped like Finance's payback calculator (synthetic values). */
export async function buildPaybackWorkbook(opts: PaybackWorkbookOptions = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QuoteFlow synthetic';
  wb.addWorksheet('Instructions').getCell('A1').value = 'Synthetic instructions';
  wb.addWorksheet('Definitions').getCell('A1').value = 'Synthetic definitions';
  const s = wb.addWorksheet(SUMMARY);
  s.getCell('A3').value = opts.title ?? 'FINANCIAL SUMMARY  |  DECISION SNAPSHOT';
  s.getCell('A9').value = 'INCREMENTAL ANNUAL UNITS';
  s.getCell('F9').value = 'INCREMENTAL NET SALES';
  s.getCell('K9').value = 'INCREMENTAL MATERIAL MARGIN';
  s.getCell('A15').value = 'ANNUAL P&L SAVINGS';
  s.getCell('F15').value = 'CAPITAL REQUEST';
  s.getCell('K15').value = 'PAYBACK (Includes taxes, WACC, Terminal Value)';
  s.getCell('K48').value = 'SIMPLE Payback';
  put(s, 'A10', opts.units ?? 1_000_000);
  put(s, 'F10', opts.netSales ?? 500_000);
  put(s, 'K10', opts.materialMargin ?? 200_000);
  put(s, 'A16', opts.plSavings ?? 150_000);
  put(s, 'F16', opts.capitalRequest ?? 400_000);
  put(s, 'K16', opts.payback ?? 2.5);
  put(s, 'K49', opts.simplePayback ?? 2);
  const a = wb.addWorksheet(ASSUMPTIONS);
  a.getCell('B11').value = 'Evaluation period (project life)';
  a.getCell('D11').value = 5;
  a.getCell('B12').value = 'Discount rate (WACC)';
  a.getCell('D12').value = 0.1;
  a.getCell('B17').value = 'Hurdle — maximum simple payback accepted';
  if (opts.hurdle !== 'blank') a.getCell('D17').value = (opts.hurdle as number | undefined) ?? 3;
  const inv = wb.addWorksheet(INVESTMENT);
  inv.getCell('B11').value = 'Capital request';
  inv.getCell('B12').value = 'One-time expense';
  inv.getCell('B13').value = 'Working Capital';
  put(inv, 'D11', 400_000);
  put(inv, 'D12', 20_000);
  put(inv, 'D13', 10_000);
  const bc = wb.addWorksheet(BUSINESS_CASE);
  bc.getCell('B41').value = 'NPV ';
  bc.getCell('B43').value = 'IRR [2]';
  put(bc, 'E41', opts.npv ?? 250_000);
  put(bc, 'E43', opts.irr ?? 0.25);
  if (opts.definedNames) {
    const name = (n: string, sheet: string, ref: string) =>
      wb.definedNames.add(`'${sheet}'!$${ref.replace(/(\d+)/, '$$$1')}`, n);
    name('QF_Payback', SUMMARY, 'K16');
    name('QF_SimplePayback', SUMMARY, 'K49');
    name('QF_IRR', BUSINESS_CASE, 'E43');
  }
  if (opts.fillerRows) addFiller(wb, opts.fillerRows);
  return toBuffer(wb);
}

/** A workbook shaped like the pre-makeover ERF costing layout (synthetic values, synthetic names). */
export async function buildCostingWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet('Summary');
  s.getCell('A1').value = 'ERF SYNTHETIC-001';
  const rows: [string, string, Cached][] = [
    ['A13', 'Total ', 100],
    ['A15', 'Revenue ', 150_000],
    ['A16', 'Target Price ', 120],
    ['A18', 'CM%', 0.3],
    ['A22', 'Volume', 1_000_000],
    ['A27', 'CM$ Vol', 45_000],
  ];
  for (const [label, text, v] of rows) {
    s.getCell(label).value = text;
    const ref = label.replace('A', 'B');
    if (typeof v === 'number' && ref !== 'B16' && ref !== 'B22') put(s, ref, v);
    else s.getCell(ref).value = v as number;
  }
  s.getCell('U22').value = 'Project Total:';
  put(s, 'V22', 300_000);
  s.getCell('U24').value = 'Net Cost to Pretium:';
  put(s, 'V24', 250_000);
  wb.addWorksheet('ECE SUMMARY').getCell('C2').value = 'ECE SUMMARY';
  return toBuffer(wb);
}

/** A valid .xlsx that matches no template. */
export async function buildJunkWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A1').value = 'Synthetic list';
  ws.getCell('A2').value = 42;
  return toBuffer(wb);
}

function addFiller(wb: ExcelJS.Workbook, rows: number) {
  const f = wb.addWorksheet('Filler');
  for (let r = 1; r <= rows; r++) {
    f.addRow([r, r * 2, r * 3, `Synthetic row ${r}`, r / 7, r % 13, r * 11, `Note ${r % 97}`]);
  }
}

// CLI: write the synthetic files for a manual check.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] ?? 'synthetic-workbooks');
  mkdirSync(dir, { recursive: true });
  const files: [string, Promise<Buffer>][] = [
    ['payback.synthetic.xlsx', buildPaybackWorkbook({ definedNames: true })],
    [
      'payback-error.synthetic.xlsx',
      buildPaybackWorkbook({ irr: { error: '#NUM!' }, payback: -1.5 }),
    ],
    ['costing-pre-makeover.synthetic.xlsx', buildCostingWorkbook()],
    ['junk.synthetic.xlsx', buildJunkWorkbook()],
  ];
  for (const [name, buf] of files) writeFileSync(join(dir, name), await buf);
  process.stdout.write(`wrote ${files.length} synthetic workbooks to ${dir}
`);
}
