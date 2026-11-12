import { describe, expect, it } from 'vitest';

import { parseDefinedNameRange, readWorkbookCells, WorkbookReadError } from './cellReader';
import {
  buildCostingWorkbook,
  buildJunkWorkbook,
  buildPaybackWorkbook,
} from '../../test/synthetic-workbooks';

const ALL = () =>
  new Set([
    '0. Financial Summary',
    '1. Overarching Asssumptions',
    '4. Investment',
    '5. Business Case',
  ]);
const opts = { sheetsToRead: ALL, timeoutMs: 5000, maxCells: 10_000 };

describe('parseDefinedNameRange', () => {
  it('resolves quoted and plain sheets, ranges, external and broken refs', () => {
    expect(parseDefinedNameRange("'4. Investment'!$O$18")).toEqual({
      sheet: '4. Investment',
      ref: 'O18',
      multiCell: false,
    });
    expect(parseDefinedNameRange('Summary!$B$2:$C$4')).toEqual({
      sheet: 'Summary',
      ref: 'B2',
      multiCell: true,
    });
    expect(parseDefinedNameRange("'It''s'!A1")).toEqual({
      sheet: "It's",
      ref: 'A1',
      multiCell: false,
    });
    expect(parseDefinedNameRange('[1]Tables!$C$9:$C$15').sheet).toBeNull();
    expect(parseDefinedNameRange('#REF!').sheet).toBeNull();
    expect(parseDefinedNameRange('255').sheet).toBeNull();
  });
});

describe('readWorkbookCells (synthetic workbooks)', () => {
  it('reads cached values of formulas and plain cells, and the sheet list', async () => {
    const wb = await readWorkbookCells(await buildPaybackWorkbook(), opts);
    expect(wb.sheetNames).toContain('0. Financial Summary');
    const s = wb.cells.get('0. Financial Summary')!;
    expect(s.get('K16')).toEqual({ kind: 'number', value: 2.5, formula: true });
    expect(s.get('A9')).toMatchObject({ kind: 'text', value: 'INCREMENTAL ANNUAL UNITS' });
    expect(wb.cells.get('1. Overarching Asssumptions')!.get('D12')).toEqual({
      kind: 'number',
      value: 0.1,
      formula: false,
    });
    // Sheets not asked for are skipped unread.
    expect(wb.cells.has('Instructions')).toBe(false);
  });

  it('keeps errors, negatives, blanks and uncalculated formulas apart', async () => {
    const buf = await buildPaybackWorkbook({
      irr: { error: '#NUM!' },
      payback: -1.5,
      units: 'blank',
      npv: 'uncalculated',
      netSales: { text: '1,000' },
    });
    const wb = await readWorkbookCells(buf, opts);
    const s = wb.cells.get('0. Financial Summary')!;
    expect(wb.cells.get('5. Business Case')!.get('E43')).toMatchObject({
      kind: 'error',
      formula: true,
    });
    expect(s.get('K16')).toEqual({ kind: 'number', value: -1.5, formula: true });
    expect(s.get('A10')).toBeUndefined();
    expect(wb.cells.get('5. Business Case')!.get('E41')).toEqual({ kind: 'not_calculated' });
    expect(s.get('F10')).toEqual({ kind: 'text', value: '1,000', formula: true });
  });

  it('returns the defined names, resolved to a sheet and cell', async () => {
    const wb = await readWorkbookCells(await buildPaybackWorkbook({ definedNames: true }), opts);
    expect(wb.definedNames).toContainEqual({
      name: 'QF_Payback',
      sheet: '0. Financial Summary',
      ref: 'K16',
      multiCell: false,
    });
  });

  it('a non-workbook is UNREADABLE; a junk workbook reads with nothing kept', async () => {
    await expect(readWorkbookCells(Buffer.from('not a zip at all'), opts)).rejects.toMatchObject({
      code: 'UNREADABLE',
    });
    const junk = await readWorkbookCells(await buildJunkWorkbook(), opts);
    expect(junk.sheetNames).toEqual(['Sheet1']);
    expect(junk.cells.size).toBe(0);
  });

  it('stops at the cell budget and the deadline', async () => {
    const buf = await buildPaybackWorkbook();
    await expect(readWorkbookCells(buf, { ...opts, maxCells: 3 })).rejects.toMatchObject({
      code: 'TOO_MANY_CELLS',
    });
    let t = 0;
    const err = await readWorkbookCells(buf, {
      ...opts,
      now: () => (t += 1000),
      timeoutMs: 1500,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkbookReadError);
    expect((err as WorkbookReadError).code).toBe('TIMED_OUT');
  });

  it('reads the summary sheets of a multi-MB workbook quickly (the filler sheet is never parsed)', async () => {
    const big = await buildPaybackWorkbook({ fillerRows: 60_000 });
    expect(big.length).toBeGreaterThan(2_000_000);
    const start = Date.now();
    const wb = await readWorkbookCells(big, opts);
    expect(Date.now() - start).toBeLessThan(4000);
    expect(wb.cells.get('0. Financial Summary')!.get('K16')).toMatchObject({ value: 2.5 });
  }, 30_000);

  it('reads the synthetic pre-makeover costing layout', async () => {
    const wb = await readWorkbookCells(await buildCostingWorkbook(), {
      ...opts,
      sheetsToRead: () => new Set(['Summary', 'ECE SUMMARY']),
    });
    expect(wb.cells.get('Summary')!.get('B13')).toEqual({
      kind: 'number',
      value: 100,
      formula: true,
    });
    expect(wb.cells.get('ECE SUMMARY')!.get('C2')).toMatchObject({ kind: 'text' });
  });
});
