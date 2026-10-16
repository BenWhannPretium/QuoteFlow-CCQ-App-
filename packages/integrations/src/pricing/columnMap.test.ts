import { describe, expect, it } from 'vitest';

import {
  COLUMN_NAME,
  ERF_COLUMNS,
  OBJECT_NAME,
  PRICING_COLUMNS,
  PRICING_OBJECTS,
  quoteColumn,
  quoteObject,
  resolveColumns,
} from './columnMap';
import { mapBpr, mapErf, mapSpr } from './mapper';

describe('pricing column map', () => {
  it('every view and column name is a plain identifier (they are spliced into SQL)', () => {
    for (const objects of Object.values(PRICING_OBJECTS)) {
      for (const name of Object.values(objects)) {
        expect(name).toMatch(OBJECT_NAME);
        expect(() => quoteObject(name)).not.toThrow();
      }
    }
    for (const map of Object.values(PRICING_COLUMNS)) {
      for (const ref of Object.values(map)) {
        expect(ref.column).toMatch(COLUMN_NAME);
        expect(() => quoteColumn(ref.column)).not.toThrow();
      }
    }
  });

  it('each object has exactly its key column(s) required', () => {
    const required = (m: Record<string, { required?: boolean }>) =>
      Object.entries(m)
        .filter(([, r]) => r.required)
        .map(([k]) => k);
    expect(required(PRICING_COLUMNS.erf)).toEqual(['erfNumber']);
    expect(required(PRICING_COLUMNS.bpr)).toEqual(['bprNumber', 'erfNumber']);
    expect(required(PRICING_COLUMNS.spr)).toEqual(['sprNumber']);
  });

  it('keeps the column names quoted in the evidence base (Cory, 2026-09-22)', () => {
    const evidence = Object.values(ERF_COLUMNS)
      .filter((r) => r.status === 'evidence')
      .map((r) => r.column);
    expect(evidence).toEqual(
      expect.arrayContaining([
        'Priority',
        'Product_Class',
        'Channel',
        'Plant',
        'Machine',
        'Est_Revenue',
        'Est_Volume',
        'Est_Net_Capital',
        'Decision_Type',
        'Decision_By',
        'Decision_Date',
        'Decision_Reason',
        'Attachment_Count',
        'Days_Submitted_To_Engineer_Assigned',
        'Days_Submitted_To_ECE_Approved',
        'Days_Submitted_To_Price_Confirmed',
      ]),
    );
  });

  it('refuses names that could break out of the brackets', () => {
    for (const bad of ['a]; drop table x --', 'Name]', "O'Brien", 'x;y', '', ' lead', 'trail ']) {
      expect(() => quoteColumn(bad), bad).toThrow(/Invalid pricing-app column/);
    }
    for (const bad of ['v_erf', 'ccq.v_erf;--', '[ccq].[v]', 'a.b.c']) {
      expect(() => quoteObject(bad), bad).toThrow(/Invalid pricing-app view/);
    }
    expect(quoteColumn('Est Revenue')).toBe('[Est Revenue]');
    expect(quoteObject('ccq.v_ERF')).toBe('[ccq].[v_ERF]');
  });

  it('resolves against the view: optional columns drop to null, missing keys are reported', () => {
    const available = new Set(['ERF_Number', 'Customer_Name', 'priority']);
    const { resolved, missingRequired, dropped } = resolveColumns(ERF_COLUMNS, available);
    expect(resolved.erfNumber?.column).toBe('ERF_Number');
    expect(resolved.priority?.column).toBe('Priority'); // case-insensitive match
    expect(resolved.estRevenue).toBeNull();
    expect(missingRequired).toEqual([]);
    expect(dropped).toContain('Est_Revenue');

    const none = resolveColumns(ERF_COLUMNS, new Set(['Customer_Name']));
    expect(none.missingRequired).toEqual(['ERF_Number']);

    const unchecked = resolveColumns(ERF_COLUMNS, null);
    expect(Object.values(unchecked.resolved).every((r) => r !== null)).toBe(true);
  });
});

/** Fixture rows shaped like the views (column names from the map), with the legacy data's blanks. */
const C = PRICING_COLUMNS;

describe('column map → DTOs (fixture rows)', () => {
  const fullErf = {
    [C.erf.erfNumber.column]: 26367,
    [C.erf.customerName.column]: '  Acme Bottling (synthetic) ',
    [C.erf.sfOpportunityId.column]: '006SYNu39EMckLrBPJ',
    [C.erf.title.column]: '32oz HDPE Round',
    [C.erf.submittedOn.column]: new Date('2024-03-05T00:00:00Z'),
    [C.erf.priority.column]: 'High',
    [C.erf.productClass.column]: 'Bottle',
    [C.erf.channel.column]: 'Food & Beverage',
    [C.erf.plant.column]: 'CHI',
    [C.erf.machine.column]: 'Bekum 304',
    [C.erf.estRevenue.column]: 1250000.5,
    [C.erf.estVolume.column]: '2,000,000',
    [C.erf.estNetCapital.column]: '$350,000',
    [C.erf.decisionType.column]: 'Approved',
    [C.erf.decisionBy.column]: 'Pricing lead (synthetic)',
    [C.erf.decisionDate.column]: '2024-04-01T13:00:00',
    [C.erf.decisionReason.column]: null,
    [C.erf.acceptedFlag.column]: true,
    [C.erf.rejectedFlag.column]: 0,
    [C.erf.abandonedFlag.column]: 'N',
    [C.erf.attachmentCount.column]: 3,
    [C.erf.daysToEngineerAssigned.column]: 4,
    [C.erf.daysToEceApproved.column]: '12',
    [C.erf.daysToPriceConfirmed.column]: 27,
  };

  it('maps a complete ERF row', () => {
    expect(mapErf(fullErf)).toEqual({
      erfNumber: '26367',
      customerName: 'Acme Bottling (synthetic)',
      sfOpportunityId: '006SYNu39EMckLrBPJ',
      title: '32oz HDPE Round',
      status: 'accepted',
      submittedOn: '2024-03-05',
      priority: 'High',
      productClass: 'Bottle',
      channel: 'Food & Beverage',
      plant: 'CHI',
      machine: 'Bekum 304',
      estRevenueUsd: 1250000.5,
      estVolume: 2000000,
      estNetCapitalUsd: 350000,
      decision: {
        type: 'Approved',
        by: 'Pricing lead (synthetic)',
        on: '2024-04-01',
        reason: null,
      },
      attachmentCount: 3,
      elapsedDays: { engineerAssigned: 4, eceApproved: 12, priceConfirmed: 27 },
    });
  });

  it('blank figures are unknown (null), never zero; a real 0 stays 0', () => {
    for (const blank of [null, undefined, '', '   ', 'N/A', '-']) {
      const erf = mapErf({
        ...fullErf,
        [C.erf.estRevenue.column]: blank,
        [C.erf.estVolume.column]: blank,
        [C.erf.estNetCapital.column]: blank,
        [C.erf.daysToPriceConfirmed.column]: blank,
        [C.erf.attachmentCount.column]: blank,
      })!;
      expect(erf.estRevenueUsd, String(blank)).toBeNull();
      expect(erf.estVolume).toBeNull();
      expect(erf.estNetCapitalUsd).toBeNull();
      expect(erf.elapsedDays.priceConfirmed).toBeNull();
      expect(erf.attachmentCount).toBeNull();
    }
    const zero = mapErf({ ...fullErf, [C.erf.estNetCapital.column]: 0 })!;
    expect(zero.estNetCapitalUsd).toBe(0);
  });

  it('a missing column is unknown, not an error', () => {
    const erf = mapErf({ [C.erf.erfNumber.column]: 'ERF-1001' })!;
    expect(erf.erfNumber).toBe('ERF-1001');
    expect(erf.status).toBe('open');
    expect(erf.estRevenueUsd).toBeNull();
    expect(erf.decision).toEqual({ type: null, by: null, on: null, reason: null });
  });

  it('reads the status from the accepted / rejected / abandoned flags in their many spellings', () => {
    const status = (a: unknown, r: unknown, x: unknown) =>
      mapErf({
        ...fullErf,
        [C.erf.acceptedFlag.column]: a,
        [C.erf.rejectedFlag.column]: r,
        [C.erf.abandonedFlag.column]: x,
      })!.status;
    expect(status(0, 'Y', null)).toBe('rejected');
    expect(status('no', false, 'Yes')).toBe('abandoned');
    expect(status(1n, 0, 0)).toBe('accepted');
    expect(status('N', '0', '')).toBe('open');
  });

  it('accepts M/D/YYYY dates from the export and drops junk dates', () => {
    const erf = (v: unknown) => mapErf({ ...fullErf, [C.erf.submittedOn.column]: v })!.submittedOn;
    expect(erf('3/5/2024')).toBe('2024-03-05');
    expect(erf('2024-13-45')).toBeNull();
    expect(erf('soon')).toBeNull();
    expect(erf(new Date('invalid'))).toBeNull();
  });

  it('rows without a key are dropped', () => {
    expect(mapErf({ ...fullErf, [C.erf.erfNumber.column]: '  ' })).toBeNull();
    expect(mapBpr({ [C.bpr.erfNumber.column]: '26367' })).toBeNull();
    expect(mapSpr({})).toBeNull();
  });

  it('maps BPR and SPR rows', () => {
    expect(
      mapBpr({
        [C.bpr.bprNumber.column]: 'BPR-410001',
        [C.bpr.erfNumber.column]: 26367,
        [C.bpr.customerName.column]: 'Acme Bottling (synthetic)',
        [C.bpr.itemDescription.column]: '32oz HDPE Round',
        [C.bpr.status.column]: 'Implemented',
        [C.bpr.requestedBy.column]: '',
        [C.bpr.requestedOn.column]: '2024-05-01',
        [C.bpr.effectiveOn.column]: null,
      }),
    ).toEqual({
      bprNumber: 'BPR-410001',
      erfNumber: '26367',
      customerName: 'Acme Bottling (synthetic)',
      itemDescription: '32oz HDPE Round',
      status: 'Implemented',
      requestedBy: null,
      requestedOn: '2024-05-01',
      effectiveOn: null,
    });
    expect(
      mapSpr({
        [C.spr.sprNumber.column]: 'SPR-52000',
        [C.spr.customerName.column]: 'Acme Bottling (synthetic)',
        [C.spr.requestedOn.column]: '2019-02-03',
      }),
    ).toEqual({
      sprNumber: 'SPR-52000',
      customerName: 'Acme Bottling (synthetic)',
      itemDescription: null,
      status: null,
      requestedOn: '2019-02-03',
      decidedOn: null,
    });
  });
});
