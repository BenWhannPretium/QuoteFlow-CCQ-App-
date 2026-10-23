import type {
  PricingBpr,
  PricingErf,
  PricingHistoryKind,
  PricingHistoryRecord,
  PricingHistoryStatus,
  PricingSpr,
} from '@ccq/contracts';

import { ZERO_IS_UNKNOWN } from './exportColumns';

/**
 * Pure mapping for the pricing-history import (B-15 revised): an export row (header → cell value) to
 * the stored row, and a stored row to the `@ccq/contracts` DTO. No I/O, no logging. The legacy data
 * is messy: every value may be missing, blank, 0-for-blank or junk.
 */

/** A cell as stored in `fields`: dates become 'YYYY-MM-DD HH:MM:SS.mmm' like the export's text dates. */
export type FieldValue = string | number | boolean;
export type ExportFields = Record<string, FieldValue>;

/** One row for `pricing_history_record`. */
export interface PricingHistoryRow {
  kind: PricingHistoryKind;
  requestId: number;
  requestNumber: string;
  requestNumberKey: string;
  fiscalYear: number;
  status: PricingHistoryStatus;
  displayStatus: string | null;
  isOpen: boolean;
  customer: string | null;
  customerKey: string | null;
  productDescription: string | null;
  itemNumber: string | null;
  salesPerson: string | null;
  market: string | null;
  process: string | null;
  resin: string | null;
  plantCode: string | null;
  plantName: string | null;
  /** YYYY-MM-DD. */
  submittedOn: string | null;
  estRevenueUsd: number | null;
  estVolume: number | null;
  comments: string | null;
  /** Every non-empty column of the export row. */
  fields: ExportFields;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** A Date as the export's text-date format, in UTC (Excel dates carry no zone). */
function dateText(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`
  );
}

/**
 * A cell value from exceljs (or a test) normalised for storage: trimmed text, finite numbers,
 * booleans, dates as text; rich text, hyperlinks and formulas reduced to their text / result. Blank,
 * whitespace and error cells → undefined (not stored).
 */
export function cellValue(value: unknown): FieldValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : dateText(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const t = value.trim();
    return t === '' ? undefined : t;
  }
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return cellValue(
        (v.richText as { text?: unknown }[])
          .map((r) => (typeof r.text === 'string' ? r.text : ''))
          .join(''),
      );
    }
    if ('result' in v) return cellValue(v.result);
    if ('text' in v) return cellValue(v.text);
  }
  return undefined;
}

export const text = (fields: ExportFields, key: string): string | null => {
  const v = fields[key];
  if (v === undefined || typeof v === 'boolean') return null;
  return typeof v === 'number' ? String(v) : v;
};

/** A finite number (numeric text accepted: "1,250,000", "$350"). */
export function number(fields: ExportFields, key: string): number | null {
  const v = fields[key];
  let n: number | null = null;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const parsed = Number(v.replace(/[,$\s]/g, ''));
    n = v.trim() !== '' && Number.isFinite(parsed) ? parsed : null;
  }
  if (n === null) return null;
  // Blank estimates and prices were written as 0 by the legacy app: unknown, not zero.
  return n === 0 && ZERO_IS_UNKNOWN.has(key) ? null : n;
}

/** A 0/1 flag (also true/false, Y/N, Yes/No). */
export function flag(fields: ExportFields, key: string): boolean {
  const v = fields[key];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  return typeof v === 'string' && /^(1|y|yes|true|x)$/i.test(v);
}

/** YYYY-MM-DD from 'YYYY-MM-DD HH:MM:SS.mmm' (or an ISO / M/D/YYYY date); junk → null. */
export function day(fields: ExportFields, key: string): string | null {
  const s = text(fields, key);
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(s);
  const out = iso
    ? iso[0]
    : us
      ? `${us[3]}-${us[1]!.padStart(2, '0')}-${us[2]!.padStart(2, '0')}`
      : null;
  if (!out) return null;
  const d = new Date(`${out}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === out ? out : null;
}

/** The lookup key for a request number as typed: upper case, no spaces ("erf 25-123" → "ERF25-123"). */
export const requestNumberKey = (value: string): string =>
  value.trim().toUpperCase().replace(/\s+/g, '');

const LEGAL_SUFFIX =
  /\s+(inc|incorporated|llc|l\s?l\s?c|ltd|limited|co|corp|corporation|company|lp|llp|plc|sa|gmbh|ag|bv|ulc)$/;

/**
 * The name the history is matched on (the export has no Salesforce id): lower case, "&" as "and",
 * punctuation dropped, spaces collapsed and a trailing legal suffix removed, so "Acme Bottling, Inc."
 * and "ACME BOTTLING INC" meet. Null for a blank name.
 */
export function customerKey(name: string | null | undefined): string | null {
  if (!name) return null;
  let key = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (let i = 0; i < 2; i++) key = key.replace(LEGAL_SUFFIX, '').trim();
  return key === '' ? null : key;
}

/**
 * Status from the export's flags, in this order: abandoned, rejected (customer or corporate sales),
 * accepted, on hold, open, else completed. `Display_Status` keeps the legacy label.
 */
export function deriveStatus(kind: PricingHistoryKind, f: ExportFields): PricingHistoryStatus {
  if (flag(f, 'Is_Abandoned')) return 'abandoned';
  if (kind !== 'bpr') {
    if (flag(f, 'Is_Customer_Rejected') || flag(f, 'Is_Corp_Sales_Rejected')) return 'rejected';
    if (flag(f, 'Is_Customer_Accepted')) return 'accepted';
    if (flag(f, 'Is_On_Hold')) return 'on_hold';
  }
  return flag(f, 'Is_Open') ? 'open' : 'completed';
}

export interface MapResult {
  row: PricingHistoryRow | null;
  /** Estimates / prices of 0 that were read as unknown. */
  zeroAsUnknown: number;
}

const REVENUE: Record<PricingHistoryKind, string> = {
  erf: 'Est_Revenue',
  bpr: 'Est_Revenue',
  spr: 'Est_Annual_Revenue',
};
const VOLUME: Record<PricingHistoryKind, string> = {
  erf: 'Est_Volume',
  bpr: 'Est_Volume',
  spr: 'Est_Annual_Unit_Volume',
};

/** An export row (header → raw cell) to a stored row. `row` is null without a request id / number. */
export function mapExportRow(kind: PricingHistoryKind, raw: Record<string, unknown>): MapResult {
  const fields: ExportFields = {};
  let zeroAsUnknown = 0;
  for (const [key, value] of Object.entries(raw)) {
    const v = cellValue(value);
    if (v === undefined) continue;
    fields[key] = v;
    // Numbers often arrive as text ("0.00"): count every estimate / price that parses to 0.
    if (ZERO_IS_UNKNOWN.has(key) && Number(String(v).replace(/[,$\s]/g, '')) === 0) {
      zeroAsUnknown++;
    }
  }
  const requestId = number(fields, 'Request_ID');
  const requestNumber = text(fields, 'Request_Number');
  const fiscalYear = number(fields, 'Fiscal_Year');
  if (requestId === null || !Number.isInteger(requestId) || !requestNumber || fiscalYear === null) {
    return { row: null, zeroAsUnknown: 0 };
  }
  const customer = text(fields, 'Customer');
  return {
    zeroAsUnknown,
    row: {
      kind,
      requestId,
      requestNumber,
      requestNumberKey: requestNumberKey(requestNumber),
      fiscalYear: Math.trunc(fiscalYear),
      status: deriveStatus(kind, fields),
      displayStatus: text(fields, 'Display_Status'),
      isOpen: flag(fields, 'Is_Open'),
      customer,
      customerKey: customerKey(customer),
      productDescription: text(fields, 'Product_Description'),
      itemNumber: text(fields, 'Item_Number'),
      salesPerson: text(fields, 'Sales_Person'),
      market: text(fields, 'Market'),
      process: text(fields, 'Process'),
      resin: text(fields, 'Resin'),
      plantCode: text(fields, 'Plant_Code'),
      plantName: text(fields, 'Plant_Name'),
      submittedOn: day(fields, 'Sales_Submitted_Date') ?? day(fields, 'Created_Date'),
      estRevenueUsd: number(fields, REVENUE[kind]),
      estVolume: number(fields, VOLUME[kind]),
      comments: text(fields, 'Comments'),
      fields,
    },
  };
}

/** The stored row's parts every DTO shares. */
type StoredRow = Omit<PricingHistoryRow, 'requestNumberKey' | 'customerKey' | 'isOpen'>;

const decisionOf = (f: ExportFields) => ({
  type: text(f, 'Decision_Type'),
  by: text(f, 'Decision_By'),
  on: day(f, 'Decision_Date'),
  reason: text(f, 'Decision_Reason'),
});

const plantOf = (r: StoredRow) =>
  r.plantName && r.plantCode && r.plantName !== r.plantCode
    ? `${r.plantName} (${r.plantCode})`
    : (r.plantName ?? r.plantCode);

function baseOf(r: StoredRow) {
  return {
    requestNumber: r.requestNumber,
    fiscalYear: r.fiscalYear,
    status: r.status,
    displayStatus: r.displayStatus,
    customer: r.customer,
    productDescription: r.productDescription,
    itemNumber: r.itemNumber,
    salesPerson: r.salesPerson,
    market: r.market,
    process: r.process,
    resin: r.resin,
    plant: plantOf(r),
    submittedOn: r.submittedOn,
    estRevenueUsd: r.estRevenueUsd,
    estVolume: r.estVolume,
    comments: r.comments,
  };
}

export function toErf(r: StoredRow): PricingErf {
  const f = r.fields;
  const attachments = number(f, 'Attachment_Count');
  return {
    kind: 'erf',
    ...baseOf(r),
    priority: number(f, 'Priority'),
    productClass: text(f, 'Product_Class'),
    channel: text(f, 'Channel'),
    machine: text(f, 'Machine'),
    leadEngineer: text(f, 'Lead_Engineer'),
    estNetCapitalUsd: number(f, 'Est_Net_Capital'),
    decision: decisionOf(f),
    engineeringComments: text(f, 'Engineering_Comments'),
    priceConfirmation: text(f, 'Price_Confirmation'),
    attachmentCount: attachments === null ? null : Math.trunc(attachments),
    milestones: {
      engineerAssignedOn: day(f, 'Engineer_Assigned_Date'),
      eceApprovedOn: day(f, 'ECE_Complete_Approved_Date'),
      priceConfirmedOn: day(f, 'Price_Confirmed_Date'),
      proposalSubmittedOn: day(f, 'Proposal_Submitted_Date'),
      contractFinalizedOn: day(f, 'Finalized_Contract_Date'),
    },
    elapsedDays: {
      engineerAssigned: number(f, 'Days_Submitted_To_Engineer_Assigned'),
      eceApproved: number(f, 'Days_Submitted_To_ECE_Approved'),
      priceConfirmed: number(f, 'Days_Submitted_To_Price_Confirmed'),
      firstToLast: number(f, 'Days_First_To_Last_Status'),
    },
  };
}

export function toBpr(r: StoredRow): PricingBpr {
  const f = r.fields;
  return {
    kind: 'bpr',
    ...baseOf(r),
    bprType: text(f, 'BPR_Type'),
    packout: text(f, 'Packout'),
    priceAgreedTo: number(f, 'Price_Agreed_To'),
    priceConfirmedOn: day(f, 'Price_Confirmed_Date'),
    oracleUpdatedOn: day(f, 'Price_Updated_In_Oracle_Date'),
    daysToPriceConfirmed: number(f, 'Days_Submitted_To_Price_Confirmed'),
    csSetupText: text(f, 'CS_Setup_Text'),
    abandonedReason: text(f, 'Abandoned_Reason'),
  };
}

export function toSpr(r: StoredRow): PricingSpr {
  const f = r.fields;
  return {
    kind: 'spr',
    ...baseOf(r),
    sprType: text(f, 'SPR_Type'),
    competitorName: text(f, 'Competitor_Name'),
    competitiveOffer: text(f, 'Competitive_Offer'),
    currentPrice: number(f, 'Current_Price'),
    targetPrice: number(f, 'Target_Price'),
    decision: decisionOf(f),
    priceConfirmedOn: day(f, 'Price_Confirmed_Date'),
  };
}

export function toHistoryRecord(r: StoredRow): PricingHistoryRecord {
  return r.kind === 'erf' ? toErf(r) : r.kind === 'bpr' ? toBpr(r) : toSpr(r);
}
