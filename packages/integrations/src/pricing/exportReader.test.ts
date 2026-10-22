import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { EXPORT_SHEETS } from './exportColumns';
import { PricingExportError, readPricingExport, writeExportXlsx } from './exportReader';
import { mapExportRow, toHistoryRecord } from './historyMapper';
import { syntheticExportSheets, syntheticPricingExport } from './synthetic';
import { loadSyntheticFixture } from '../salesforce/fixtures/index';

async function readAll(buffer: Buffer) {
  const out: { kind: string; sheet: string; missing: string[]; rows: Record<string, unknown>[] }[] =
    [];
  for await (const s of readPricingExport(Readable.from(buffer))) {
    const rows: Record<string, unknown>[] = [];
    for await (const r of s.rows) rows.push(r);
    out.push({ kind: s.kind, sheet: s.sheet, missing: s.missingColumns, rows });
  }
  return out;
}

describe('readPricingExport', () => {
  it('streams the three sheets with their header-keyed rows (round trip)', async () => {
    const x = syntheticPricingExport();
    const sheets = await readAll(await writeExportXlsx(syntheticExportSheets(x)));
    expect(sheets.map((s) => [s.kind, s.sheet, s.rows.length])).toEqual([
      ['bpr', 'BPR Export', x.bpr.length],
      ['erf', 'ERF Export', x.erf.length],
      ['spr', 'SPR Export', x.spr.length],
    ]);
    const erf = sheets.find((s) => s.kind === 'erf')!;
    expect(erf.rows[0]!.Request_Number).toBe(x.erf[0]!.Request_Number);
    expect(erf.missing).toEqual([]);
    for (const s of sheets) {
      for (const raw of s.rows) {
        const { row } = mapExportRow(s.kind as 'erf', raw);
        expect(row).not.toBeNull();
        expect(toHistoryRecord(row!).kind).toBe(s.kind);
      }
    }
  });

  it('reports mapped columns a sheet lacks, and ignores unrelated sheets', async () => {
    const buffer = await writeExportXlsx([
      { name: 'Notes', rows: [{ a: 1 }] },
      {
        name: 'ERF Export',
        rows: [{ Request_ID: 1, Request_Number: 'ERF26-001', Fiscal_Year: 2026, Customer: 'X' }],
      },
    ]);
    const [erf, ...rest] = await readAll(buffer);
    expect(rest).toEqual([]);
    expect(erf!.missing).toContain('Est_Revenue');
    expect(erf!.missing).not.toContain('Customer');
  });

  it('refuses a sheet without its required columns', async () => {
    const buffer = await writeExportXlsx([
      { name: 'SPR Export', rows: [{ Request_Number: 'SPR19-001', Fiscal_Year: 2019 }] },
    ]);
    await expect(readAll(buffer)).rejects.toMatchObject({
      code: 'MISSING_COLUMNS',
      message: expect.stringContaining('Request_ID') as string,
    });
  });

  it('refuses a workbook with none of the sheets, and a file that is not an .xlsx', async () => {
    await expect(
      readAll(await writeExportXlsx([{ name: 'Sheet1', rows: [{ a: 1 }] }])),
    ).rejects.toMatchObject({
      code: 'NO_SHEETS',
    });
    const err = await readAll(Buffer.from('Request_ID,Request_Number\n1,ERF25-1\n')).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PricingExportError);
    expect((err as PricingExportError).code).toBe('INVALID_FILE');
  });

  it('keeps Excel date cells as dates', async () => {
    const buffer = await writeExportXlsx([
      {
        name: 'BPR Export',
        rows: [
          {
            Request_ID: 9,
            Request_Number: 'BPR26-0009',
            Fiscal_Year: 2026,
            Created_Date: new Date(Date.UTC(2026, 0, 15, 8, 0, 0)),
          },
        ],
      },
    ]);
    const [bpr] = await readAll(buffer);
    const { row } = mapExportRow('bpr', bpr!.rows[0]!);
    expect(row!.fields.Created_Date).toBe('2026-01-15 08:00:00.000');
    expect(row!.submittedOn).toBe('2026-01-15');
  });
});

describe('synthetic export', () => {
  const x = syntheticPricingExport();

  it('is deterministic and synthetic only', () => {
    expect(syntheticPricingExport()).toEqual(x);
    for (const r of [...x.erf, ...x.bpr, ...x.spr]) {
      if (typeof r.Customer === 'string') expect(r.Customer).toMatch(/synthetic/i);
      expect(r.Sales_Person_Email).toBeNull();
    }
  });

  it('has the real headers, an ERF per SF ERF number, and the legacy quirks', () => {
    for (const spec of EXPORT_SHEETS) {
      const rows = x[spec.kind];
      for (const c of spec.required) expect(Object.keys(rows[0]!)).toContain(c);
    }
    const numbers = new Set(x.erf.map((e) => e.Request_Number));
    for (const o of loadSyntheticFixture().opportunities) {
      if (typeof o.ERF_Number__c === 'string' && o.ERF_Number__c.trim()) {
        expect(numbers.has(o.ERF_Number__c.trim())).toBe(true);
      }
    }
    expect(x.erf.some((e) => String(e.Request_Number).startsWith('EP'))).toBe(true);
    expect(
      x.erf.filter((e) => Number(e.Fiscal_Year) >= 2023).every((e) => e.Est_Volume === 0),
    ).toBe(true);
    expect(new Set(x.erf.map((e) => e.Request_Number)).size).toBeLessThan(x.erf.length);
    expect(x.spr.every((s) => String(s.Created_Date) < '2025-11-01')).toBe(true);
  });
});
