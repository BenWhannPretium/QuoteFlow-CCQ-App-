import type { PricingHistoryKind } from '@ccq/contracts';

/**
 * The legacy pricing app's back-end export (Cory McGahan; ERF 8,535 × 99, BPR 26,560 × 62, SPR
 * 12,189 × 91 as of the October 2026 file). These are the **real** column headers of that file. They
 * are the only place CCQ names them.
 *
 * Every column of a row is kept in `pricing_history_record.fields` (free text included, by decision
 * on 2026-10-22; it can be dropped later). The columns below are the ones CCQ also reads into typed
 * columns or DTO fields. `required` columns must exist or the sheet is refused; a missing mapped
 * column only turns its values into null (reported by the import check).
 */

export interface SheetSpec {
  kind: PricingHistoryKind;
  /** Matches the sheet name ("ERF Export"). */
  sheet: RegExp;
  required: readonly string[];
  mapped: readonly string[];
}

const COMMON_REQUIRED = ['Request_ID', 'Request_Number', 'Fiscal_Year'] as const;

const COMMON_MAPPED = [
  'Display_Status',
  'Is_Open',
  'Is_Abandoned',
  'Customer',
  'Product_Description',
  'Sales_Person',
  'Market',
  'Process',
  'Resin',
  'Plant_Code',
  'Plant_Name',
  'Comments',
  'Created_Date',
  'Sales_Submitted_Date',
  'Price_Confirmed_Date',
] as const;

const ERF_MAPPED = [
  ...COMMON_MAPPED,
  'Is_Customer_Accepted',
  'Is_Customer_Rejected',
  'Is_Corp_Sales_Rejected',
  'Is_On_Hold',
  'Priority',
  'Product_Class',
  'Channel',
  'Machine',
  'Lead_Engineer',
  'Est_Revenue',
  'Est_Volume',
  'Est_Net_Capital',
  'Decision_Type',
  'Decision_By',
  'Decision_Date',
  'Decision_Reason',
  'Engineering_Comments',
  'Price_Confirmation',
  'Attachment_Count',
  'Engineer_Assigned_Date',
  'ECE_Complete_Approved_Date',
  'Proposal_Submitted_Date',
  'Finalized_Contract_Date',
  'Days_Submitted_To_Engineer_Assigned',
  'Days_Submitted_To_ECE_Approved',
  'Days_Submitted_To_Price_Confirmed',
  'Days_First_To_Last_Status',
] as const;

const BPR_MAPPED = [
  ...COMMON_MAPPED,
  'Is_Workflow_Complete',
  'BPR_Type',
  'Item_Number',
  'Packout',
  'Price_Agreed_To',
  'Est_Revenue',
  'Est_Volume',
  'Price_Updated_In_Oracle_Date',
  'Days_Submitted_To_Price_Confirmed',
  'CS_Setup_Text',
  'Abandoned_Reason',
] as const;

const SPR_MAPPED = [
  ...COMMON_MAPPED,
  'Is_Customer_Accepted',
  'Is_Customer_Rejected',
  'Is_Corp_Sales_Rejected',
  'Is_On_Hold',
  'SPR_Type',
  'Item_Number',
  'Competitor_Name',
  'Competitive_Offer',
  'Current_Price',
  'Target_Price',
  'Est_Annual_Revenue',
  'Est_Annual_Unit_Volume',
  'Decision_Type',
  'Decision_By',
  'Decision_Date',
  'Decision_Reason',
] as const;

export const EXPORT_SHEETS: readonly SheetSpec[] = [
  { kind: 'erf', sheet: /^ERF\b/i, required: COMMON_REQUIRED, mapped: ERF_MAPPED },
  { kind: 'bpr', sheet: /^BPR\b/i, required: COMMON_REQUIRED, mapped: BPR_MAPPED },
  { kind: 'spr', sheet: /^SPR\b/i, required: COMMON_REQUIRED, mapped: SPR_MAPPED },
];

export const sheetSpecFor = (sheetName: string): SheetSpec | undefined =>
  EXPORT_SHEETS.find((s) => s.sheet.test(sheetName.trim()));

/**
 * Estimates and prices where the legacy app wrote 0 for "blank" (ERF volume is 0 on ~99% of ERFs
 * since FY23; revenue zeros climb to 44% in FY26). A 0 here maps to null ("Unknown").
 * `Est_Net_Capital` is deliberately absent: 0 there reads as "no capital" (provisional, ask Pricing).
 */
export const ZERO_IS_UNKNOWN = new Set([
  'Est_Revenue',
  'Est_Volume',
  'Est_Annual_Revenue',
  'Est_Annual_Unit_Volume',
  'Price_Agreed_To',
  'Current_Price',
  'Target_Price',
]);
