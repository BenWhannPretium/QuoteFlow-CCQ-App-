# Payback calculator: structure (FB-14)

**Source:** Stacy Slocum (Finance), email "QuoteFlow: three templates still needed for costing and ROI", received 2026-11-11: *DRAFT #3 Pretium Savings Calculator - Capital and CI Projects.xlsx*. Stacy calls it a payback calculator ("let's not call it an ROI"). It is a **draft** with notes she is still working on; she describes it as fundamentally operational. Tracker A-031 (partly received), D-013, F-031.

**What this file is.** Structure only: sheet names, header labels, cell addresses, which cells are formulas. **No figure, plant, ledger line, person or project from the workbook is recorded here or anywhere in the repo** (CLAUDE.md rules 5 and 8). The workbook itself holds real plant P&L data and is kept outside the repo. It was read once, read-only, from a scratch script (ExcelJS), never opened in Excel or saved.

## Sheets

| # | Sheet | Visible | What it is (structure) |
|---|---|---|---|
| 1 | `Instructions` | yes | How to fill the calculator |
| 2 | `Definitions` | yes | Terms |
| 3 | `0. Financial Summary` | yes | "FINANCIAL SUMMARY \| DECISION SNAPSHOT": the headline numbers (the natural one-page summary) |
| 4 | `1. Overarching Asssumptions` | yes | Project, evaluation period, discount rate, tax rate, ramp-up, depreciation, operating hours, hurdle. The sheet name has three "s" as received |
| 5 | `2. Drivers & Rates` | yes | Activity driver rates (D01–D17); the draft labels them illustrative placeholders |
| 6 | `3.Savings, Costs, Qualification` | yes | Savings lines |
| 7 | `3.a. Incremental Sales` | yes | The new-business volume path (the one that matches CCQ) |
| 8 | `4. Investment` | yes | Capital request, one-time expense, working capital, total investment, and the quote information block |
| 9 | `5. Business Case` | yes | Project return analysis: NPV, annual cash flow benefit, IRR, payback |
| 10 | `Project IRR` | **hidden** | IRR helper rows |
| 11 | `5.a. P&L Comparison` | yes | **Real plant financials** |
| 12 | `6. Post Go-Live Tracking` | **hidden** | Tracking after go-live |
| 13 | `LTM P&L (Data Dump)` | yes | **Real plant ledger data** |

**Defined names:** none on the headline cells. Two hidden link names point at a range on `5. Business Case` (an add-in's link ranges). Several names in the file are broken (`#REF!`) or point at other workbooks. **Merged cells:** the headline labels and values on `0. Financial Summary` are merged blocks; the value is in the block's top-left cell.

## `0. Financial Summary` (the headline cells)

| Label (row above the value) | Value cell | Formula? | Number format |
|---|---|---|---|
| INCREMENTAL ANNUAL UNITS (A9) | **A10** (A10:D12 merged) | formula | `#,##0` |
| INCREMENTAL NET SALES (F9) | **F10** | formula | `$#,##0` |
| INCREMENTAL MATERIAL MARGIN (K9) | **K10** | formula | `$#,##0` |
| ANNUAL P&L SAVINGS (A15) | **A16** | formula | `$#,##0` |
| CAPITAL REQUEST (F15) | **F16** | formula | `$#,##0` |
| PAYBACK (Includes taxes, WACC, Terminal Value) (K15) | **K16** | formula | `0.0 "years"` |
| SIMPLE Payback (K48) | **K49** | formula | `0.0 "years"` |

Rows 1–2 and 5–7 are formulas that repeat the project name and description from sheet 1. Column Q holds the author's working notes.

## Assumptions and investment cells read next to the headline

| Sheet | Label | Value cell | Formula? |
|---|---|---|---|
| `1. Overarching Asssumptions` | Evaluation period (project life), years (B11) | **D11** | input |
| `1. Overarching Asssumptions` | Discount rate (WACC), % per year (B12) | **D12** | input |
| `1. Overarching Asssumptions` | Hurdle — maximum simple payback accepted, years (B17) | **D17** | input |
| `4. Investment` | Capital request (B11) | D11 | formula |
| `4. Investment` | One-time expense (B12) | **D12** | formula |
| `4. Investment` | Working Capital (B13) | **D13** | formula |
| `4. Investment` | TOTAL INVESTMENT (C14) | D14 | formula |
| `5. Business Case` | NPV (B41) | **E41** | formula |
| `5. Business Case` | IRR [2] (B43) | **E43** | formula |
| `5. Business Case` | Payback Period [3] (B44) | E44 | formula |

## How the draft behaves today (no figures)

- The illustrative inputs give a **negative** payback on the summary and the business case, and IRR shows **`#NUM!`** (cached). Extraction carries both through and flags them (it never "fixes" them).
- Working capital is blank in the draft.
- Every headline cell has a cached value (the file was calculated in Excel).
- The `4. Investment` sheet's quote block holds a real vendor quote (equipment lines, payment terms). Not recorded.
- The author's notes (red text) say the layout will move: "tied to truly incremental volume only", the direct/indirect-cost assumption, EBITDA add-backs, sub-$25K projects, a print-view macro.

## The QuoteFlow map (seeded, provisional, every field proposed)

`app_setting.model_summary_templates`, template `payback_calculator`, kind `roi_model`, **active**. Recognised by `0. Financial Summary` with A3 containing "FINANCIAL SUMMARY", A9 "INCREMENTAL ANNUAL UNITS" and K15 "PAYBACK". Fourteen fields: the seven headline cells above, then project life, discount rate, hurdle, one-time expense, working capital, NPV and IRR. Each field prefers a defined name Finance is asked to add (`QF_IncrementalUnits`, `QF_IncrementalNetSales`, `QF_IncrementalMaterialMargin`, `QF_AnnualPLSavings`, `QF_CapitalRequest`, `QF_Payback`, `QF_SimplePayback`, `QF_ProjectLife`, `QF_DiscountRate`, `QF_HurdlePayback`, `QF_OneTimeExpense`, `QF_WorkingCapital`, `QF_NPV`, `QF_IRR`) and falls back to the address above until the name exists. Warnings: payback and simple payback zero or negative; simple payback above the hurdle cell.

Checked 2026-11-12 through the FB-14 reader on Linux (scratch, read-only): recognised, `complete`, 14 fields, IRR flagged as an Excel error and the payback as negative, working capital blank. About 0.1 s.
