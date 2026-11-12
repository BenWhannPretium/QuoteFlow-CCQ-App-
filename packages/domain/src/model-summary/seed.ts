import type { ModelSummaryTemplate } from './config';

/**
 * FB-14 seeds for `app_setting.model_summary_templates`. Every map and field is **provisional** and
 * every field is **proposed**: the cell addresses come from profiling the drafts received 2026-11-11
 * (structure only: sheet names, labels and addresses; `feedback/inputs/payback-calculator-structure.md`
 * and `costing-template-structure.md`). Nothing from those files is in this repo.
 *
 * Each payback field prefers a defined name (`QF_…`) that Finance is asked to add to the headline
 * cells, and falls back to today's address until it exists: when the names are added, the map keeps
 * working however the layout moves.
 */

const PAYBACK_SUMMARY = '0. Financial Summary';
// "Asssumptions" (three s) is the sheet's name in the draft as received: kept as it is.
const PAYBACK_ASSUMPTIONS = '1. Overarching Asssumptions';
const PAYBACK_INVESTMENT = '4. Investment';
const PAYBACK_BUSINESS_CASE = '5. Business Case';

/** Finance's savings and payback calculator (draft #3), the "Payback" model (Stacy Slocum). */
export const PAYBACK_TEMPLATE_SEED: ModelSummaryTemplate = {
  templateId: 'payback_calculator',
  label: 'Pretium savings and payback calculator (capital and CI projects), draft #3',
  kind: 'roi_model',
  active: true,
  provisional: true,
  note: 'FB-14: cells proposed from the draft received 2026-11-11; Finance to confirm the headline cells and add the QF_ defined names. The layout is still moving (draft).',
  recognise: {
    sheet: PAYBACK_SUMMARY,
    labels: [
      { ref: 'A3', contains: 'FINANCIAL SUMMARY' },
      { ref: 'A9', contains: 'INCREMENTAL ANNUAL UNITS' },
      { ref: 'K15', contains: 'PAYBACK' },
    ],
  },
  fields: [
    {
      key: 'incremental_annual_units',
      label: 'Incremental annual units',
      unit: 'units',
      type: 'number',
      sheet: PAYBACK_SUMMARY,
      ref: 'QF_IncrementalUnits',
      fallbackRef: 'A10',
      headline: true,
      proposed: true,
    },
    {
      key: 'incremental_net_sales',
      label: 'Incremental net sales',
      unit: 'usd',
      type: 'number',
      sheet: PAYBACK_SUMMARY,
      ref: 'QF_IncrementalNetSales',
      fallbackRef: 'F10',
      headline: true,
      proposed: true,
    },
    {
      key: 'incremental_material_margin',
      label: 'Incremental material margin',
      unit: 'usd',
      type: 'number',
      sheet: PAYBACK_SUMMARY,
      ref: 'QF_IncrementalMaterialMargin',
      fallbackRef: 'K10',
      headline: true,
      proposed: true,
    },
    {
      key: 'annual_pl_savings',
      label: 'Annual P&L savings',
      unit: 'usd',
      type: 'number',
      sheet: PAYBACK_SUMMARY,
      ref: 'QF_AnnualPLSavings',
      fallbackRef: 'A16',
      headline: true,
      proposed: true,
    },
    {
      key: 'capital_request',
      label: 'Capital request',
      unit: 'usd',
      type: 'number',
      sheet: PAYBACK_SUMMARY,
      ref: 'QF_CapitalRequest',
      fallbackRef: 'F16',
      headline: true,
      proposed: true,
    },
    {
      key: 'payback_years',
      label: 'Payback (taxes, WACC, terminal value)',
      unit: 'years',
      type: 'number',
      sheet: PAYBACK_SUMMARY,
      ref: 'QF_Payback',
      fallbackRef: 'K16',
      headline: true,
      proposed: true,
    },
    {
      key: 'simple_payback_years',
      label: 'Simple payback',
      unit: 'years',
      type: 'number',
      sheet: PAYBACK_SUMMARY,
      ref: 'QF_SimplePayback',
      fallbackRef: 'K49',
      headline: true,
      proposed: true,
    },
    {
      key: 'project_life_years',
      label: 'Evaluation period (project life)',
      unit: 'years',
      type: 'number',
      sheet: PAYBACK_ASSUMPTIONS,
      ref: 'QF_ProjectLife',
      fallbackRef: 'D11',
      headline: false,
      proposed: true,
    },
    {
      key: 'discount_rate',
      label: 'Discount rate (WACC)',
      unit: 'percent',
      type: 'number',
      sheet: PAYBACK_ASSUMPTIONS,
      ref: 'QF_DiscountRate',
      fallbackRef: 'D12',
      headline: false,
      proposed: true,
    },
    {
      key: 'hurdle_payback_years',
      label: 'Hurdle: maximum simple payback',
      unit: 'years',
      type: 'number',
      sheet: PAYBACK_ASSUMPTIONS,
      ref: 'QF_HurdlePayback',
      fallbackRef: 'D17',
      headline: false,
      proposed: true,
    },
    {
      key: 'one_time_expense',
      label: 'One-time expense',
      unit: 'usd',
      type: 'number',
      sheet: PAYBACK_INVESTMENT,
      ref: 'QF_OneTimeExpense',
      fallbackRef: 'D12',
      headline: false,
      proposed: true,
    },
    {
      key: 'working_capital',
      label: 'Working capital',
      unit: 'usd',
      type: 'number',
      sheet: PAYBACK_INVESTMENT,
      ref: 'QF_WorkingCapital',
      fallbackRef: 'D13',
      headline: false,
      proposed: true,
    },
    {
      key: 'npv',
      label: 'NPV',
      unit: 'usd',
      type: 'number',
      sheet: PAYBACK_BUSINESS_CASE,
      ref: 'QF_NPV',
      fallbackRef: 'E41',
      headline: false,
      proposed: true,
    },
    {
      key: 'irr',
      label: 'IRR',
      unit: 'percent',
      type: 'number',
      sheet: PAYBACK_BUSINESS_CASE,
      ref: 'QF_IRR',
      fallbackRef: 'E43',
      headline: false,
      proposed: true,
    },
  ],
  warnings: {
    nonPositive: ['payback_years', 'simple_payback_years'],
    hurdle: { field: 'simple_payback_years', limitField: 'hurdle_payback_years' },
  },
};

const ERF_SUMMARY = 'Summary';

/**
 * Pricing's ERF costing workbook **as it is before the makeover** (Gemma Cebolla, 2026-11-11: the
 * costing templates are being remade). Seeded **inactive**: the layout is being retired, so a costing
 * upload shows "summary not configured" until the new template's map is added. The layout has one
 * column per variant; this map reads the first variant's column only.
 */
export const ERF_COSTING_TEMPLATE_SEED: ModelSummaryTemplate = {
  templateId: 'erf_costing_pre_makeover',
  label: 'ERF costing workbook, pre-makeover layout (inactive)',
  kind: 'cost_model',
  active: false,
  provisional: true,
  note: 'FB-14: for the ERF costing layout in use before the costing-template makeover. Inactive: not the costing template going forward. Reads the first variant column of the Summary sheet only.',
  recognise: {
    sheet: ERF_SUMMARY,
    labels: [
      { ref: 'A13', contains: 'Total' },
      { ref: 'A15', contains: 'Revenue' },
      { ref: 'A18', contains: 'CM%' },
      { sheet: 'ECE SUMMARY', ref: 'C2', contains: 'ECE SUMMARY' },
    ],
  },
  fields: [
    {
      key: 'unit_cost',
      label: 'Total cost (first variant)',
      unit: 'usd',
      type: 'number',
      sheet: ERF_SUMMARY,
      ref: 'B13',
      headline: true,
      proposed: true,
    },
    {
      key: 'target_price',
      label: 'Target price (first variant)',
      unit: 'usd',
      type: 'number',
      sheet: ERF_SUMMARY,
      ref: 'B16',
      headline: true,
      proposed: true,
    },
    {
      key: 'revenue',
      label: 'Revenue (first variant)',
      unit: 'usd',
      type: 'number',
      sheet: ERF_SUMMARY,
      ref: 'B15',
      headline: false,
      proposed: true,
    },
    {
      key: 'contribution_margin_pct',
      label: 'Contribution margin % (first variant)',
      unit: 'percent',
      type: 'number',
      sheet: ERF_SUMMARY,
      ref: 'B18',
      headline: true,
      proposed: true,
    },
    {
      key: 'contribution_margin_usd',
      label: 'Contribution margin $ on volume (first variant)',
      unit: 'usd',
      type: 'number',
      sheet: ERF_SUMMARY,
      ref: 'B27',
      headline: false,
      proposed: true,
    },
    {
      key: 'annual_volume',
      label: 'Annual volume (first variant)',
      unit: 'units',
      type: 'number',
      sheet: ERF_SUMMARY,
      ref: 'B22',
      headline: true,
      proposed: true,
    },
    {
      key: 'capital_project_total',
      label: 'Capital project total (first size)',
      unit: 'usd',
      type: 'number',
      sheet: ERF_SUMMARY,
      ref: 'V22',
      headline: false,
      proposed: true,
    },
    {
      key: 'capital_net_cost',
      label: 'Net capital cost to Pretium (first size)',
      unit: 'usd',
      type: 'number',
      sheet: ERF_SUMMARY,
      ref: 'V24',
      headline: false,
      proposed: true,
    },
  ],
  warnings: { nonPositive: [], hurdle: null },
};

export const MODEL_SUMMARY_TEMPLATES_SEED: readonly ModelSummaryTemplate[] = [
  PAYBACK_TEMPLATE_SEED,
  ERF_COSTING_TEMPLATE_SEED,
];

export const MODEL_SUMMARY_VISIBLE_SEED = true;
