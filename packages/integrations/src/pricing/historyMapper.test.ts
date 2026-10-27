import { PricingHistoryRecord } from '@ccq/contracts';
import { describe, expect, it } from 'vitest';

import {
  cellValue,
  customerKey,
  day,
  deriveStatus,
  mapExportRow,
  requestNumberKey,
  toBpr,
  toErf,
  toHistoryRecord,
  toSpr,
} from './historyMapper';

/** An ERF row shaped like the real export (numbers as text, text dates, 0/1 flags). */
const erfRow = {
  Request_ID: 51234,
  Request_Number: 'ERF25-123',
  Fiscal_Year: 2025,
  Display_Status: 'Proposal Submitted',
  Is_Open: 1,
  Is_Abandoned: 0,
  Is_Customer_Accepted: 0,
  Is_Customer_Rejected: 0,
  Is_Corp_Sales_Rejected: 0,
  Is_On_Hold: 0,
  Customer: '  Acme Bottling, Inc. (synthetic) ',
  Product_Description: '32oz HDPE Round 38-400',
  Sales_Person: 'Synthetic Seller A',
  Market: 'Food & Beverage',
  Process: 'EBM',
  Resin: 'HDPE',
  Plant_Code: 'CHI',
  Plant_Name: 'Chicago',
  Priority: 3,
  Product_Class: 'New',
  Machine: 'Bekum 304',
  Lead_Engineer: 'Synthetic Engineer A',
  Est_Revenue: '1250000.00',
  Est_Volume: '0.00',
  Est_Net_Capital: '0.00',
  Decision_Type: null,
  Comments: 'Customer wants samples first (synthetic).',
  Engineering_Comments: '   ',
  Attachment_Count: 4,
  Created_Date: new Date(Date.UTC(2024, 10, 3, 14, 5, 0)),
  Sales_Submitted_Date: '2024-11-04 09:30:00.000',
  Engineer_Assigned_Date: '2024-11-08 10:00:00.000',
  Price_Confirmed_Date: 'not a date',
  Days_Submitted_To_Engineer_Assigned: '4.00',
  Days_Submitted_To_Price_Confirmed: null,
};

describe('mapExportRow', () => {
  it('maps the typed columns and keeps every non-empty column in fields', () => {
    const { row, zeroAsUnknown } = mapExportRow('erf', erfRow);
    expect(row).toMatchObject({
      kind: 'erf',
      requestId: 51234,
      requestNumber: 'ERF25-123',
      requestNumberKey: 'ERF25-123',
      fiscalYear: 2025,
      status: 'open',
      displayStatus: 'Proposal Submitted',
      isOpen: true,
      customer: 'Acme Bottling, Inc. (synthetic)',
      customerKey: 'acme bottling inc synthetic',
      plantCode: 'CHI',
      submittedOn: '2024-11-04',
      estRevenueUsd: 1_250_000,
      estVolume: null,
      comments: 'Customer wants samples first (synthetic).',
    });
    expect(row!.fields.Created_Date).toBe('2024-11-03 14:05:00.000');
    expect(row!.fields).not.toHaveProperty('Engineering_Comments'); // blank
    expect(row!.fields).not.toHaveProperty('Decision_Type'); // null
    expect(zeroAsUnknown).toBe(1); // Est_Volume; net capital is not counted
  });

  it('a zero estimate or price is unknown; net capital 0 stays 0', () => {
    const erf = toErf(mapExportRow('erf', erfRow).row!);
    expect(erf.estVolume).toBeNull();
    expect(erf.estNetCapitalUsd).toBe(0);
    const bpr = toBpr(
      mapExportRow('bpr', {
        Request_ID: 1,
        Request_Number: 'BPR24-0001',
        Fiscal_Year: 2024,
        Price_Agreed_To: 0,
        Est_Revenue: '0',
      }).row!,
    );
    expect(bpr.priceAgreedTo).toBeNull();
    expect(bpr.estRevenueUsd).toBeNull();
    const spr = toSpr(
      mapExportRow('spr', {
        Request_ID: 2,
        Request_Number: 'SPR19-001',
        Fiscal_Year: 2019,
        Current_Price: '0.412',
        Target_Price: '0.00',
        Est_Annual_Unit_Volume: '250000',
      }).row!,
    );
    expect(spr).toMatchObject({ currentPrice: 0.412, targetPrice: null, estVolume: 250_000 });
  });

  it('drops an estimate too large for numeric(38, 4) (B-27); the raw value stays in fields', () => {
    const { row } = mapExportRow('bpr', {
      Request_ID: 3,
      Request_Number: 'BPR24-0003',
      Fiscal_Year: 2024,
      Est_Revenue: '1e35',
    });
    expect(row!.estRevenueUsd).toBeNull();
    expect(row!.fields.Est_Revenue).toBe('1e35');
    expect(
      toBpr(
        mapExportRow('bpr', {
          Request_ID: 4,
          Request_Number: 'BPR24-0004',
          Fiscal_Year: 2024,
          Est_Revenue: '1000000000000',
        }).row!,
      ),
    ).toMatchObject({ estRevenueUsd: 1e12 });
  });

  it('skips rows without a request id, number or fiscal year', () => {
    expect(mapExportRow('erf', { ...erfRow, Request_ID: null }).row).toBeNull();
    expect(mapExportRow('erf', { ...erfRow, Request_ID: '12.5' }).row).toBeNull();
    expect(mapExportRow('erf', { ...erfRow, Request_Number: ' ' }).row).toBeNull();
    expect(mapExportRow('erf', { ...erfRow, Fiscal_Year: undefined }).row).toBeNull();
  });

  it('falls back to the created date when sales never submitted', () => {
    const { row } = mapExportRow('erf', { ...erfRow, Sales_Submitted_Date: null });
    expect(row!.submittedOn).toBe('2024-11-03');
  });
});

describe('status', () => {
  const f = (o: Record<string, number>) => ({ Is_Open: 0, ...o });
  it('abandoned, then rejected, accepted, on hold, open, completed', () => {
    expect(deriveStatus('erf', f({ Is_Abandoned: 1, Is_Customer_Accepted: 1 }))).toBe('abandoned');
    expect(deriveStatus('erf', f({ Is_Corp_Sales_Rejected: 1 }))).toBe('rejected');
    expect(deriveStatus('erf', f({ Is_Customer_Rejected: 1, Is_Customer_Accepted: 1 }))).toBe(
      'rejected',
    );
    expect(deriveStatus('spr', f({ Is_Customer_Accepted: 1, Is_Open: 1 }))).toBe('accepted');
    expect(deriveStatus('erf', f({ Is_On_Hold: 1, Is_Open: 1 }))).toBe('on_hold');
    expect(deriveStatus('erf', f({ Is_Open: 1 }))).toBe('open');
    expect(deriveStatus('erf', f({}))).toBe('completed');
    // BPRs have no customer flags.
    expect(deriveStatus('bpr', f({ Is_Customer_Accepted: 1 }))).toBe('completed');
  });
});

describe('DTOs', () => {
  it('every kind maps to the contract shape', () => {
    for (const kind of ['erf', 'bpr', 'spr'] as const) {
      const rec = toHistoryRecord(mapExportRow(kind, erfRow).row!);
      expect(PricingHistoryRecord.parse(rec).kind).toBe(kind);
    }
  });

  it('the ERF carries milestones, elapsed days and free text; junk dates are null', () => {
    const erf = toErf(mapExportRow('erf', erfRow).row!);
    expect(erf).toMatchObject({
      plant: 'Chicago (CHI)',
      priority: 3,
      leadEngineer: 'Synthetic Engineer A',
      engineeringComments: null,
      attachmentCount: 4,
      milestones: { engineerAssignedOn: '2024-11-08', priceConfirmedOn: null },
      elapsedDays: { engineerAssigned: 4, priceConfirmed: null },
      decision: { type: null, by: null, on: null, reason: null },
    });
  });
});

describe('helpers', () => {
  it('normalises cells from exceljs', () => {
    expect(cellValue({ richText: [{ text: 'Acme ' }, { text: 'Co' }] })).toBe('Acme Co');
    expect(cellValue({ formula: 'A1*2', result: 42 })).toBe(42);
    expect(cellValue({ text: 'link', hyperlink: 'https://x' })).toBe('link');
    expect(cellValue({ error: '#N/A' })).toBeUndefined();
    expect(cellValue(Number.NaN)).toBeUndefined();
    expect(cellValue(new Date('invalid'))).toBeUndefined();
    expect(cellValue(true)).toBe(true);
  });

  it('reads dates in the export formats and refuses impossible ones', () => {
    expect(day({ d: '2025-02-28 23:59:59.000' }, 'd')).toBe('2025-02-28');
    expect(day({ d: '3/5/2024' }, 'd')).toBe('2024-03-05');
    expect(day({ d: '2025-02-30 00:00:00.000' }, 'd')).toBeNull();
    expect(day({ d: 20250101 }, 'd')).toBeNull();
  });

  it('matches customer names across punctuation, case and legal suffixes', () => {
    const key = customerKey('ACME BOTTLING INC');
    expect(customerKey('Acme Bottling, Inc.')).toBe(key);
    expect(customerKey('acme  bottling')).toBe(key);
    expect(customerKey('Acme Bottling Co., LLC')).toBe(key);
    expect(customerKey('Smith & Sons')).toBe(customerKey('Smith and Sons'));
    expect(customerKey('Smith & Sons')).not.toBe(customerKey('Smith Sons Inc'));
    expect(customerKey('  ')).toBeNull();
    expect(customerKey(null)).toBeNull();
  });

  it('keys request numbers as typed', () => {
    expect(requestNumberKey(' erf 25-123 ')).toBe('ERF25-123');
    expect(requestNumberKey('EP09-045')).toBe('EP09-045');
  });
});
