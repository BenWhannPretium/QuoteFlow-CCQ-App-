# Engineering estimate workbook: mapping to QuoteFlow (F-026)

**Status (2026-11-10): the workbook is identified and mapped. No fields were added. Four points need Paul
Slomkowski or Pricing (see "Open points"); then this file is the F-026 record.**

F-026 (Bailey Schmitt, PMO): "Every cost-driving field in the engineering estimate workbook has a home in
QuoteFlow or is intentionally excluded."

## Which workbook

Kal Kaliszewski (Director, Engineering Program Office) told Ben (reported to the build on 2026-11-10) that the
engineering estimate workbook **is the *Pretium Project Workbook Template.xlsx***, the same file he sent Bailey on 2026-11-04 as the
BOM template (A-030). So F-026 and F-058 (the equipment BOM upload) use one file. This replaces the 2026-11-09
note that it was "not the estimate workbook" and that a separate file was missing.

A **filled-in copy** (a real project) was reviewed on 2026-11-10 and its layout is mapped below. That copy has a
real project, named people and figures, so it is **not committed** (CLAUDE.md rule 8). Everything below comes
from its headers, formulas and structure only. A masked or synthetic copy can go in
[`inputs/`](inputs/README.md) if a build session needs sample cells.

**Name of the one-page tab.** The one-page BOM tab is named **CER BOM** (title "CER BOM SUMMARY"). The Nov 6
notes, the decision records (D-033), the UAT scripts and one label on the Engineering tab call it "CSR BOM".
The template has no CSR tab. This looks like a transcription slip; Kal can confirm. The label fix is a
follow-up (see "Terminology").

## What the workbook is

It is a **post-award project workbook**: nine tabs that run an approved project. At quote time Engineering
uses only a small part of it.

| Tab | What it holds | Used at quote time? |
|---|---|---|
| Project Charter | Title, author, date, objectives, project manager, team, total budget, targets (decommission, cycle time, scrap target %), scope, risks, a monthly milestone chart | Partly: objectives, cycle time, scrap target |
| Scope Document | Title, CER number, project manager, location, business case, in and out of scope, assumptions, risks | Partly: location and the text blocks |
| EPO BOM | The detailed project BOM: about 400 lines in 11 sections, with costs, classification, tax, contingency, payment timing, lead time | **Yes**: the source of the capital estimate |
| CER BOM | A one-page roll-up of the EPO BOM, one row per section | **Yes**: the page Engineering uploads (D-033) |
| Resource Sheet, Contractor List | Internal contacts and approved contractors | No |
| Scope Change Document | Scope changes after approval | No |
| Action Register | Project actions with owners and dates | No |
| Lessons Learned | Project retrospective log | No |

## How the BOM works

- **Classification flag, one per line.** Column M holds **C** (capital), **E** (expense) or **P** (customer
  paid). Formulas split each line into the Capital, Expense and Customer Paid subtotals from it. This is the
  "C or P flag" in D-033; the workbook has a third value, **E**.
- **Cost per line:** Qty × Unit price, plus freight and duty, rigging and installation, mechanical and
  electrical installation. Tax and contingency are added per classification.
- **Global assumptions** in `L11:L13` on the EPO BOM: tax on or off (Y/N), the tax rate and the contingency
  rate. The tax column is not automated per plant (A-034).
- **Totals:** per line Total Capital, Total Expense, Total Customer Paid, Total Item Cost and lead time in
  weeks. The sheet sums them (EPO BOM row 413) and the CER BOM tab rolls them up by section.
- **11 sections:** injection machinery, injection tooling, blowmolding machinery, blowmolding tooling,
  downstream tooling, ISBM / IBM / EBM machinery, ISBM / IBM / EBM tooling, quality, downstream,
  infrastructure, building.
- **Careful with "Total Budget".** In the copy reviewed, the Project Charter's *Total Budget* equals the BOM's
  *Total Item Cost* (capital + expense + customer paid), not the capital alone. The QuoteFlow budgetary
  capital estimate must be read from **Total Capital**.

## Mapping

"QuoteFlow field" is an existing field or **in the upload** (a file the Engineering tab keeps, versioned,
and Pricing and Final Review read; D-033). "Excluded" means intentionally not a QuoteFlow field, with the
reason. Costing stays in Excel and the pricing app (CLAUDE.md rule 5), so line figures are not QuoteFlow
fields.

| Workbook tab / cell | What it holds | QuoteFlow field | Decision |
|---|---|---|---|
| Charter B1, E1 and S1 (title, prepared by, date) | Project name, author, date | Quote number, opportunity name, audit trail | **Excluded**: already on the quote |
| Charter B5; Scope Doc A, B, C, D | Objectives, scope in and out, assumptions, risks | `technicalConceptNotes` | **Covered** as free text |
| Charter E5 and G5 (project manager) | The engineer running it | Assigned engineer (F-062) | **Covered** |
| Charter E6 (key team members) | Post-award team | None | **Excluded**: post-award |
| Charter N5 and Q5 (total budget) | Equals Total Item Cost in the example reviewed | None | **Not mapped** (see "Careful with Total Budget") |
| Charter N6 (decommission) | Label only in the template | `toolingNotes` if needed | **Open (point 3)** |
| Charter N7 (cycle time) | Target cycle time | `cycleTimeS` | **Covered** |
| Charter N8 (scrap target %) | Scrap assumption | None | **Open (point 3)** |
| Charter rows 21 to 32 (milestones) | Project schedule | None | **Excluded**: post-award |
| Scope Doc C3 (CER number) | The CER id | The CER id at G6 hand-off | **Excluded at quote time** |
| Scope Doc E4 and EPO BOM B2 (plant) | Project location | `plantCode` | **Covered** (22 plants, FB-13) |
| EPO BOM A4, CER BOM A4 (ERF #) | Legacy ERF number | `erf_number` (legacy reference) | **Covered** |
| EPO BOM C11 and C12 (estimated cost, Total Capital) | Roll-ups of AQ413 and AN413 | Total Capital → `prelimCapitalUsd` (budgetary capital estimate, includes contingency) | **Covered**: Engineering types the figure; the file backs it |
| EPO BOM C13 and C14 (Total Expense, Total Customer Paid) | Roll-ups of AO413 and AP413 | In the upload | **Open (point 2)**: keep in the file, or add fields |
| EPO BOM F11 and F12 (start, end date) | Project dates | None | **Excluded**: post-award |
| EPO BOM L11, L12, L13 | Tax on or off, tax rate, contingency rate | In the upload | **Excluded**: costing stays in Excel; tax per plant stays A-034 |
| EPO BOM A to F (ID, item, vendor, qty, unit price, sub total) | The line item | In the upload | **Excluded as fields**: figures stay in Excel |
| EPO BOM G, H (expense, customer paid amounts) | Line amounts | In the upload | **Excluded as fields** |
| EPO BOM M (C, E or P) | Line classification | In the upload | **Covered** (D-033) |
| EPO BOM I to L (freight, rigging, mechanical, electrical) | Installed cost parts | In the upload | **Excluded as fields** |
| EPO BOM N to X (tax, contingency, subtotals by class) | Formulas | In the upload | **Excluded as fields** |
| EPO BOM Y (redeployable) | Formula | In the upload | **Template defect** (see below) |
| EPO BOM Z to AM (payment lags and dates) and AU to AW (down, ship, final %) | Vendor payment timing | None | **Excluded at quote time**: cash timing is Finance's ROI model (FB-07) |
| EPO BOM AN to AQ (per-line totals) | Totals | In the upload | **Excluded as fields** |
| EPO BOM AR (lead time, weeks) | Equipment lead time | None | **Open (point 4)**: candidate field |
| EPO BOM AS, AT (comments, PO date) | Notes; post-award purchase date | None | **Excluded** |
| EPO BOM AY to BF ("Project Coordinator Only") | Purchase and install totals | None | **Excluded**: post-award buying |
| CER BOM rows 11 to 21 (per section: lead time, Total Capital, Total Expense, Total Customer Paid, comments) | The one-page roll-up | In the upload | **Covered** (D-033) |
| Resource Sheet, Contractor List, Scope Change, Action Register, Lessons Learned | Post-award project tabs | None | **Excluded** |

## What QuoteFlow already covers (so the mapping can point at it)

| Engineering input | Where it lives today |
|---|---|
| Process, machine, plant, cavitation, cycle time | Engineering Review solution fields |
| Budgetary capital estimate (preliminary, includes contingency) | `prelim_capital_usd` (F-064) |
| Equipment list and capital cost (C, E or P per line) | The equipment BOM upload (F-058, FB-06): a file, no extracted figures |
| Utilization before and after, capacity basis | Capacity evidence (F-059) |
| Two-step process: preform plant, blow plant, preform number, freight between plants | FB-06 (F-024), provisional |
| Units per bag, tray, case and pallet | FB-06 (F-025), provisional |
| Resin, grade, PCR %, color, additives, variants note, neck | The intake (FB-02, FB-09), shown on the Engineering tab |
| Tooling notes, technical concept, Supply Chain view | Free-text notes on the Engineering Review |

The workbook carries **no pack-out and no two-step details**. Those stay as the FB-06 fields (A-014, D-007).

## Template defects (for Kal)

1. **EPO BOM column Y** ("Redeployable" subtotal) uses a formula that points at a deleted cell (`#REF!`) on every line.
2. **EPO BOM `L11`** (the tax Y/N cell) has a drop-down list whose source is `#REF!`.
3. **"ERF #" and "CER Number".** The BOM tabs say *ERF #* and the Scope Document says *CER Number*. Both are
   labelled differently from what QuoteFlow calls them (`erf_number` is the legacy ERF reference; the CER id
   only exists after approval).

## Later: reading the CER BOM automatically (A-030, not built)

The upload is a file. If Pricing later wants the figures in QuoteFlow, the CER BOM tab is easy to read: one row
per section in `A11:G21` (id, item, lead time in weeks, Total Capital, Total Expense, Total Customer Paid,
comments), sums in `D22:F22` and the grand total in `D23`. That is a small extraction, but it needs Kal to
confirm that the tab is what Engineering uploads at quote time, and it is not an MVP item.

## Open points

Four things stay open. None blocks the MVP: the upload and the budgetary capital estimate already work.

1. **Which cells does Engineering fill at quote time?** The whole EPO BOM, or only the CER BOM one-pager
   (D-033 says the one-pager)? Paul Slomkowski or Kal Kaliszewski.
2. **What does Pricing read from it?** Total Capital, Total Expense, Total Customer Paid and lead time are the
   candidates. If Pricing reads Total Customer Paid, it feeds the customer-funded terms (FB-08). Kyle Arnold or
   Graham Parle.
3. **Scrap target % and decommission.** Are they entered at quote time, and does anyone read them? If not,
   they stay excluded.
4. **Equipment lead time (weeks).** The longest lead time drives the lead time quoted to the customer. QuoteFlow
   has no field for it today. Recommendation: add one optional number only if Pricing confirms it reads it.

**Recommendation.** No new fields for F-026 now. Every cell that drives cost has a home (cycle time, plant,
budgetary capital, the BOM upload) or is intentionally excluded. Add lead time, scrap, or the customer-paid
total only if Pricing says it uses them. Sign-off: Paul Slomkowski for Engineering and Pricing (Kyle Arnold or
Graham Parle) for what they read.

## Terminology

"CSR BOM" appears in: the Nov 6 decision records (D-033, A-030, F-058), the label on the Engineering tab's BOM
upload, UAT scripts (`engineering.md` step 15a, `pricing.md` step 34), the engineer quick-start and the
test file names. The template's tab is **CER BOM**. Changing the user-facing label is a small code and
quick-start change, so it is listed here and not made in this docs-only change.
