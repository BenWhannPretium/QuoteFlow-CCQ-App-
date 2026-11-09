# Engineering estimate workbook: mapping to QuoteFlow (F-026)

**Status: waiting for the workbook. No fields were added for F-026.**

F-026 (Bailey Schmitt, PMO): "Every cost-driving field in the engineering estimate workbook has a home in
QuoteFlow or is intentionally excluded." That needs the workbook. It is not in
[`inputs/`](inputs/README.md) (the expected file is `engineering-estimate-fields.md`, from Paul
Slomkowski), and a search of the PMO SharePoint on 2026-11-09 did not find it. The only workbooks found are
the Engineering Program Office's *Pretium Project Workbook Template.xlsx* (a post-award project workbook
that carries the CSR BOM, which is F-058, not this) and the *Engineering Projects Template* in the Quote
Flow folder (a post-award project and CER template).

So this step wrote the list of questions below, to send to Bailey, and built nothing for F-026.

## When the workbook arrives

Put a masked or synthetic copy in `docs/build-guide/feedback/inputs/` (never a real customer's data) or
paste the cell list into `inputs/engineering-estimate-fields.md`. Then fill in this table, one row per
cost-driving cell, and add only the fields agreed here that the build does not already cover.

| Workbook tab / cell | What it holds | QuoteFlow field | Decision |
|---|---|---|---|
| _(none yet)_ | | | |

"QuoteFlow field" is an existing field, one of the FB-06 fields below, a new field to build, or
**intentionally excluded** with the reason (for example "costing stays in Excel", CLAUDE.md rule 5).

## What QuoteFlow already covers (so the mapping can point at it)

| Engineering input | Where it lives today |
|---|---|
| Process, machine, plant, cavitation, cycle time | Engineering Review solution fields |
| Budgetary capital estimate (preliminary, includes contingency) | `prelim_capital_usd` (F-064) |
| Equipment list and capital cost (C / P per line) | The equipment BOM upload (F-058, FB-06): a file, no extracted figures |
| Utilization before and after, capacity basis | Capacity evidence (F-059) |
| Two-step process: preform plant, blow plant, preform number, freight between plants | FB-06 (F-024), provisional |
| Units per bag, tray, case and pallet | FB-06 (F-025), provisional |
| Resin, grade, PCR %, colour, additives, variants note, neck | The intake (FB-02), shown on the Engineering tab |
| Tooling notes, technical concept, Supply Chain view | Free-text notes on the Engineering Review |

## Questions for Bailey Schmitt (to send to Paul Slomkowski through Bailey)

1. **Where is the engineering estimate workbook**, and who owns it? Can Paul send a masked copy (customer
   name, part numbers and prices removed) for `inputs/`?
2. **Which cells drive cost?** For each tab, which cells does Engineering type, and which are formulas or
   lookups? We only need the typed, cost-driving ones.
3. **Which of those does Pricing actually take into the costing workbook?** A cell Pricing never reads has
   no reason to be a QuoteFlow field.
4. **Which can stay in Excel?** Costing stays in Excel and the pricing app (CLAUDE.md rule 5), so figures
   that are only calculated there are candidates for "intentionally excluded". Please say which.
5. **The equipment BOM.** The estimate workbook probably has an equipment list too. Is it the same list as
   the Engineering Program Office's one-page CSR BOM (D-033), or a different one? If different, which one
   do we ask Engineering to upload at quote time?
6. **Pack-out (A-014).** Is "units per bag / tray / case / pallet" the right set, and is Engineering the
   one who enters it? Is anything else needed for the cost (layers per pallet, cases per layer, dunnage)?
7. **Two-step (D-007).** Does a two-step part always have a preform plant and a blow plant, and may they be
   the same plant? Is anything else in the workbook specific to two-step (preform cost, preform freight)?
8. **Tax.** The project workbook has a tax column that is not automated and there is no plant tax table
   (A-034). Does the estimate workbook carry a tax input Engineering enters?
9. **Anything the workbook asks that QuoteFlow's Engineering tab does not**, for example tooling life,
   expected scrap, labour or line speed assumptions? Which of these are cost drivers?
10. **Who signs off the mapping?** Paul Slomkowski for Engineering, and Pricing (Kyle Arnold or Graham
    Parle) for what they read?

Once Bailey answers, this file becomes the F-026 mapping and the "excluded" list is kept here with the
reasons. Nothing excluded is built.
