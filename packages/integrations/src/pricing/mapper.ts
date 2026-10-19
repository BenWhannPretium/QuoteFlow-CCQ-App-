import type { PricingBpr, PricingErf, PricingErfStatus, PricingSpr } from '@ccq/contracts';

import { BPR_COLUMNS, ERF_COLUMNS, SPR_COLUMNS, type ColumnRef } from './columnMap';
import { num, str } from '../salesforce/mapper';

/**
 * Pure mapping from pricing-app view rows (keyed by the column names in columnMap.ts) to the
 * `@ccq/contracts` DTOs. No I/O, no logging. The legacy data is messy: every column is treated as
 * possibly missing, blank or junk, and **a blank figure is unknown (null), never zero**.
 */

type Row = Record<string, unknown>;

const get = (row: Row, ref: ColumnRef) => row[ref.column];

/**
 * A figure: a finite number, or null when the cell is blank / missing / not a number. Revenue, volume
 * and net capital blank themselves from ~FY25/26 on; mapping those blanks to 0 would invent a value.
 * A real 0 stays 0.
 */
export function figure(value: unknown): number | null {
  if (typeof value === 'bigint') return Number(value);
  return num(value);
}

/** Whole days elapsed; negative or fractional junk is kept as-is (the pricing app computes it). */
const days = (value: unknown) => figure(value);

/** YYYY-MM-DD from a Date (mssql returns DATE / DATETIME as Date, UTC), an ISO string or M/D/YYYY. */
export function dateValue(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const s = str(value);
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return Number.isNaN(Date.parse(`${iso[0]}T00:00:00Z`)) ? null : iso[0];
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(s);
  if (us) {
    const out = `${us[3]}-${us[1]!.padStart(2, '0')}-${us[2]!.padStart(2, '0')}`;
    return Number.isNaN(Date.parse(`${out}T00:00:00Z`)) ? null : out;
  }
  return null;
}

/** A flag column: bit, boolean, 1/0, Y/N, Yes/No, True/False. Anything else is false. */
export function flag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === 'bigint') return value === 1n;
  const s = str(value)?.toLowerCase();
  return s === 'y' || s === 'yes' || s === 'true' || s === '1' || s === 'x';
}

/** Accepted, then rejected, then abandoned (a row with several flags set is read in that order). */
export function erfStatus(
  accepted: boolean,
  rejected: boolean,
  abandoned: boolean,
): PricingErfStatus {
  if (accepted) return 'accepted';
  if (rejected) return 'rejected';
  if (abandoned) return 'abandoned';
  return 'open';
}

/** Map one ERF row. Null when it has no ERF number. */
export function mapErf(row: Row): PricingErf | null {
  const c = ERF_COLUMNS;
  const erfNumber = str(get(row, c.erfNumber));
  if (!erfNumber) return null;
  const attachments = figure(get(row, c.attachmentCount));
  return {
    erfNumber,
    customerName: str(get(row, c.customerName)),
    sfOpportunityId: str(get(row, c.sfOpportunityId)),
    title: str(get(row, c.title)),
    status: erfStatus(
      flag(get(row, c.acceptedFlag)),
      flag(get(row, c.rejectedFlag)),
      flag(get(row, c.abandonedFlag)),
    ),
    submittedOn: dateValue(get(row, c.submittedOn)),
    priority: str(get(row, c.priority)),
    productClass: str(get(row, c.productClass)),
    channel: str(get(row, c.channel)),
    plant: str(get(row, c.plant)),
    machine: str(get(row, c.machine)),
    estRevenueUsd: figure(get(row, c.estRevenue)),
    estVolume: figure(get(row, c.estVolume)),
    estNetCapitalUsd: figure(get(row, c.estNetCapital)),
    decision: {
      type: str(get(row, c.decisionType)),
      by: str(get(row, c.decisionBy)),
      on: dateValue(get(row, c.decisionDate)),
      reason: str(get(row, c.decisionReason)),
    },
    attachmentCount: attachments === null ? null : Math.trunc(attachments),
    elapsedDays: {
      engineerAssigned: days(get(row, c.daysToEngineerAssigned)),
      eceApproved: days(get(row, c.daysToEceApproved)),
      priceConfirmed: days(get(row, c.daysToPriceConfirmed)),
    },
  };
}

export function mapBpr(row: Row): PricingBpr | null {
  const c = BPR_COLUMNS;
  const bprNumber = str(get(row, c.bprNumber));
  if (!bprNumber) return null;
  return {
    bprNumber,
    erfNumber: str(get(row, c.erfNumber)),
    customerName: str(get(row, c.customerName)),
    itemDescription: str(get(row, c.itemDescription)),
    status: str(get(row, c.status)),
    requestedBy: str(get(row, c.requestedBy)),
    requestedOn: dateValue(get(row, c.requestedOn)),
    effectiveOn: dateValue(get(row, c.effectiveOn)),
  };
}

export function mapSpr(row: Row): PricingSpr | null {
  const c = SPR_COLUMNS;
  const sprNumber = str(get(row, c.sprNumber));
  if (!sprNumber) return null;
  return {
    sprNumber,
    customerName: str(get(row, c.customerName)),
    itemDescription: str(get(row, c.itemDescription)),
    status: str(get(row, c.status)),
    requestedOn: dateValue(get(row, c.requestedOn)),
    decidedOn: dateValue(get(row, c.decidedOn)),
  };
}

/** Map rows, dropping the ones without a key. */
export function mapRows<T>(rows: readonly Row[], map: (r: Row) => T | null): T[] {
  const out: T[] = [];
  for (const r of rows) {
    const item = map(r);
    if (item) out.push(item);
  }
  return out;
}
