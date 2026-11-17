# FB-14 · Use Stacy's and Gemma's templates: model summary extraction, "Payback" wording, capacity helper

**Run with:** Claude Code · **Opus 5.5 · high effort** · follows FB-07 (uploads and versions) · one draft PR
**Tracker items:** A-031 (partly answered), F-031 (the one-page summary half), D-013 · T-017 (summary half). There are no F- IDs yet for the rename or the capacity helper: do not invent any, say "no tracker ID yet" and list them for Bailey to add.
**Inputs received 2026-11-11 (email "QuoteFlow: three templates still needed for costing and ROI"):**

| Asked for (Ben, Nov 10) | What arrived | Status |
|---|---|---|
| 1. The ROI template | Stacy Slocum: `DRAFT #3 Pretium Savings Calculator - Capital and CI Projects.xlsx`. She calls it a **payback calculator, "let's not call it an ROI"**. It is a draft with red notes she is still working on, but "fundamentally operational". | Received (draft) |
| 2. The costing template | Gemma Cebolla: `ERF27-019_…_Ciccarelli_10-27-2026 GC.xlsx`, a **populated, real ERF costing workbook** (3.9 MB). Gemma: "we will be changing the costing templates … this is the existing template, **prior to the makeover**." | Old template only; the new one is not here |
| 3. The one-page summary template + cell map | Nothing. | **Not received** |
| (not asked for) | Stacy: `Capacity Exhibit.xlsx`, an equipment capacity calculator ("because I like it. And it's useful.") | Received |

**Where the files are.** Ben saves them **outside the repo**, to `C:\Users\benwh\quoteflow-private\templates\` (the three `.xlsx` files; spaces in the names may appear as underscores: `Capacity_Exhibit.xlsx`, `DRAFT_3_Pretium_Savings_Calculator_-_Capital_and_CI_Projects.xlsx`, and the `ERF27-019_…_GC.xlsx` costing workbook). They hold real plant ledger data and a real customer's costing. They are inputs to read, never to commit. **If the folder or a file is missing, stop and tell Ben which one.** Do not go looking in Outlook for binaries and do not write them anywhere under the repo.

**Paste into Claude Code from the repo root.**

---

## Stop check (do this first)
1. `git fetch origin`, then start from the latest `main`. Confirm FB-07 is on it: `packages/domain/src/quoting-steps`, `apps/api/src/services/quoting-steps.ts`, migration `0031`. **If FB-07 is not on `main`, stop and say so.** FB-08 and FB-13 (plants and machine types, migration 0039) are already on `main`; this step is FB-14, so use the next free migration number above 0039.
2. Check `git tag --list "v0.9.0-uat"`. If the freeze tag exists, this PR is **post-freeze** (pilot readiness): say so in the PR title and body. Do not retag. If it does not exist, still follow the drop order in "Scope and drop order".
3. Read `CLAUDE.md` (rules 1–11), `docs/build-guide/03-build-steps.md` → FB-07 ("Built 2026-11-09", especially "Left for later"), `04-decisions-and-risks.md` §2a and the rows for D-013, D-001, A-031, and `feedback/inputs/README.md` and `capacity-formula.md`.
4. If the Microsoft 365 connector is available, read the tracker rows A-031, F-031, F-032, T-017 and D-013. If they differ from this prompt, follow the tracker and record the deviation. Read-only: **never edit `QuoteFlow Feedback Tracker.xlsx`**.

## Hard rules for these files (CLAUDE.md rules 5 and 8)
- **Nothing from the three workbooks is committed or pasted anywhere durable**: not in the repo, a test, a fixture, a doc, a commit message, the PR body, the change log or the final reply. That covers every number, plant name, customer, product, ERF number, person and ledger line. The payback calculator's "LTM P&L (Data Dump)" and "5.a. P&L Comparison" sheets are real plant financials. The ERF workbook is a real quote.
- What you **may** write down is **structure only**: sheet names, header labels, the addresses of cells, defined names, which cells are formulas. Put it in `docs/build-guide/feedback/inputs/` as `payback-calculator-structure.md`, `costing-template-structure.md` and `capacity-exhibit.md`, and add them to that folder's README table. Labels like "CAPITAL REQUEST" are fine; the value next to them is not.
- Test data is a **synthetic workbook you generate** with ExcelJS (`*.synthetic.xlsx`, built by a script in `packages/*/test/` or `scripts/`, fake round numbers, fake names). Never copy, trim or "anonymise" a real file into a fixture.
- Parse the real files read-only, in a scratch script under the session scratchpad, never inside the repo. Do not open them in Excel, recalculate or save them.
- No write-back and no editing of figures: QuoteFlow only **reads** the cells and shows them (rule 5). It never recomputes payback, never replaces the workbook's maths.
- Run the repo's secret scan (`gitleaks`, as CI does) before the PR.

## Context
- **D-013 (Oct 30):** MVP cost model = upload the standard template and extract a one-page summary. FB-07 built the uploads and versions (`cost_model`, `roi_model`, `price_table`; one current version per quote and kind) and **deliberately did not build the summary** because it needs a cell map (A-031). That is this step.
- **D-001 (Nov 9):** costing → ROI → price approved, inside Quoting. Pricing uploads the costing model; Finance (Stacy) uploads the ROI/payback model only when capital is required; the pricing lead confirms the price.
- **Stacy's draft is a savings and payback calculator for Operations projects** (capital and CI). Its sheet `0. Financial Summary` is a "decision snapshot" that already holds the headline numbers: incremental annual units, incremental net sales, incremental material margin, annual P&L savings, capital request, payback (including taxes, WACC and terminal value) and simple payback. `3.a. Incremental Sales` is the new-business volume path that matches CCQ. That summary sheet is the natural "one page". Her red notes (for example "need to make it super clear this is tied to truly incremental volume only", the direct/indirect-cost assumption, EBITDA add-backs) mean **the layout will move**. Do not hard-code cell addresses (see Build 1).
- **What the draft looks like today (structure, no figures):** sheets `Instructions`, `Definitions`, `0. Financial Summary`, `1. Overarching Asssumptions` (sic), `2. Drivers & Rates`, `3.Savings, Costs, Qualification`, `3.a. Incremental Sales`, `4. Investment`, `5. Business Case`, `Project IRR`, `5.a. P&L Comparison`, `6. Post Go-Live Tracking`, `LTM P&L (Data Dump)`. Several cells show an Excel error (`#NUM!` for IRR) and the example payback is negative, because the illustrative inputs are placeholders. **Extraction must carry errors, negatives and blanks through honestly and flag them; it must not hide or "fix" them.**
- **Capacity Exhibit** (one sheet, `Capacity`): one row per piece of equipment. Inputs: Equipment, Cavities, Cycle Time (sec), Expected OEE, Schedule (24/7 or 24/5), Avg Weight (g). Outputs: Theoretical (24/7/365 at 100%), Expected (24/7/365 at OEE) and Practical (schedule at OEE), each as daily and annual parts. Note on the sheet: "Annual Days Assumption **360**", while its footnote says 24/7 = **365** days and 24/5 ≈ **261**. That inconsistency is a question for Stacy (see Questions), not something to resolve silently. It applies OEE **once**, which matches FB-03's reading of Faron's formula (`feedback/inputs/capacity-formula.md`, A-023).
- **The ERF workbook is the retired layout.** Gemma says the costing templates are being remade because today's carries a lot of information not used for costing. So building a polished extraction for it would be throwaway work. Profile it, document it, and ship its mapping **inactive**.
- Stacy also wrote "this dovetails nicely with the AI agent build". CLAUDE.md rule 9 applies: **build nothing AI in this step.**

## Scope and drop order
Build in this order. If time is short, drop from the bottom; never drop the hard rules.
1. **Summary extraction framework + the payback mapping** (Build 1). This is the point of the step.
2. **"Payback" wording** (Build 2).
3. **Capacity helper** (Build 3).
4. **Costing mapping, inactive**, plus the structure notes and the questions (Build 4).

## Build

### 1. Config-driven summary extraction (F-031 summary half, D-013)
- **Profile first.** With ExcelJS (already in `apps/api`; do not add another spreadsheet library), read `DRAFT #3 …xlsx` read-only: sheet names, hidden sheets, **defined names**, which cells in `0. Financial Summary` are formulas and what **cached value** they carry, merged cells. Decide the cell map from what you find and write the structure note. If a headline cell has no cached value (the file was never calculated in Excel), extraction returns "not calculated" for it rather than computing it.
- **The cell map is data, not code.** One config entry per template: `template_id`, the attachment `kind` it applies to, how to **recognise** the template (a sheet name plus one or more label cells that must read as expected), and a list of fields `{key, label, unit, type (number | text | date), sheet, ref}` where `ref` is a **defined name when one exists, otherwise an A1 address**. Follow the existing config pattern in `packages/domain/src/config-admin` and the Admin console, seed it `provisional: true`, and let an Admin edit it without a deploy. Check how structured settings are stored today (Admin saves routing rules "as JSON") and follow that, including the `_json` companion rule (rule 10) if a `jsonb` column is involved.
- **Seed the payback map** with the headline fields from `0. Financial Summary` and the assumptions the reviewer needs next to them (project life, discount rate, hurdle payback years, the capital request, one-time expense, working capital from `4. Investment`; NPV and IRR from `5. Business Case`). Keep to roughly 10–14 fields. Mark each field's mapping as **proposed, to be confirmed by Stacy**. Because Stacy's layout is still moving, ask her (Questions) to add **defined names** to every headline cell, and make the map prefer them.
- **Extraction runs on the server at upload**, after the existing type sniffing and size limits, never in the browser. Read cached values only: **no formula evaluation, no macros, no external-link refresh, no network**. `.xlsm` stays rejected (see Left for later). Cap the work: a size limit and a time limit well inside the request budget (the ERF file is 3.9 MB, so test on a synthetic file of similar size). **A failed extraction never blocks the upload.** The file is stored and the quote shows "summary unavailable" with a plain reason: `template not recognised`, `field not found`, `not calculated`, `could not read the file`. Reasons name the field key, never cell contents.
- **Store** per attachment version: an extraction status, the template id, the extracted-at time and one row per field. Fabric-safe: `text`, `timestamptz`, `integer` and `numeric(18,4)` or smaller; **no `jsonb`, no arrays** (rule 10). Error values and text go in a `text` column with the number column null. Each version keeps its own summary; a superseded version's summary stays with it; removing the current version (the uploader's 24-hour window) makes the previous version's summary current again. If you add an analytics view, add its T-SQL twin in `packages/db/sql/fabric/` and let the Fabric guard tests pass. Use the next free migration number (renumber on rebase, as the FB prompts say).
- **Authorization (rule 1).** Reading the summary needs `quote.read.commercialFields`, declared on the route through `packages/domain/src/policy`. Today every role holds it (rule 2: no role is hidden from data it can enter). Add a provisional Admin setting, `model_summary_visible`, seeded **on**, so Ben or Gemma can switch the figures off without a deploy: the "may QuoteFlow show extracted figures" question is still open (`04` §2a). Add permission-matrix tests, allowed and denied for every role, and keep `docs/security/route-inventory.md` current.
- **Audit (rule 3).** Write an append-only `audit_event` for each extraction: attachment id, version, template id, status, field count. **Not the values.** Never update or delete audit rows.
- **Show it** on the Quoting tab, in the costing and payback steps (`apps/web/src/components/pricing/QuotingSteps.tsx`), and read-only at Final Review: label, value and unit, then "Read from <file> v<n>, uploaded by <name> on <date>. Figures come from the workbook and cannot be edited here." Add **advisory warnings** (never blocking): an Excel error in a headline field, a negative or zero payback, a blank headline field, a payback above the hurdle cell when that cell is mapped. Use words a KAM understands ("The workbook shows an error in IRR. Ask Finance to check it."). The G3 rules do not change.
- **Do not rebuild the calculator.** No payback, NPV or IRR maths in QuoteFlow. Only reading.

### 2. "Payback" wording (Stacy, Nov 11)
- User-facing text that says "ROI" for **Stacy's model** becomes **"Payback"** (the step name, the upload button, the Final Review row, notification and email text, empty and "not required" states, the Quoting tab help, quick-starts, `docs/uat` scripts, `print.html` and `public/help/quickstart.html` together, the release notes, `01-architecture.md`). "ROI required" becomes "Payback required".
- **Keep every internal identifier**: `roi_model`, `roi.upload`, `roi_required_when`, `quote.ready_for_roi`, `quote.roi_uploaded`, column and route names. No schema rename and no migration for the rename itself. Config labels and help text that already exist as seeded rows change by a data migration that **skips rows an Admin edited or approved** (as 0031 did). Note the deviation and that "Payback" is Stacy's request and provisional (Gemma and Oleg still say "ROI" in the decision record; D-001 is not rewritten).

### 3. Capacity helper (lowest value; drop first if time is short)
- Read `packages/domain/src/engineering/capacity.ts` and the FB-03 capacity-evidence row first. The row already has cavitation, cycle time and effectiveness %, which are the exhibit's inputs.
- Add a **pure** domain function (no I/O, with unit tests) that gives, from those fields: theoretical, expected (at effectiveness %) and practical (at the `capacity_basis` schedule and run days) capacity per day and per year, in parts, and in lbs only if intake already captures average part weight. Apply OEE **once**. Run days come from the existing provisional `capacity_basis` setting, **not** the exhibit's 360.
- Show the results **read-only** beside the existing utilization figures in Engineering Review, labelled "Capacity at a glance (calculated from the row above)". Add no new required inputs, and no change to G2 or to the utilization formula that FB-03 built.
- Tests: the exhibit's three capacity definitions against hand-computed values from your own made-up numbers; OEE-once; 24/7 vs 24/5; a missing input gives no result rather than zero.

### 4. Costing template: map it, ship it inactive
- Profile the ERF workbook the same way (read-only; for the 3.9 MB file use the streaming reader if the normal one is slow). In `costing-template-structure.md` record sheets, labels and candidate cells for: unit cost, price, contribution margin ($ and %), annual volume, capital or tooling. Say which are formulas.
- Seed a costing map for `cost_model` using the same config mechanism, **`active: false`**, `provisional: true`, with a note that it is for the pre-makeover ERF layout. The extraction framework treats an inactive or unmatched map as "summary not configured for this file" (a quiet state, not a warning).
- Prove the framework end to end with the **payback** map and a synthetic costing fixture; do not claim the costing summary works for the real file.
- **No code or doc may call any layout "the standard costing template".** The new one does not exist yet.

## Questions to put to Stacy and Gemma
Do **not** send anything. Put the draft email text (it goes to Ben to send) at the end of your final reply, plain and short, no figures from their files:
1. **Stacy:** please add defined names to the headline cells (list them) so the layout can change without breaking QuoteFlow; confirm which `0. Financial Summary` cells are "the numbers a reviewer sees"; confirm that "Payback" is the name to use; is a macro (print view) planned? If so the file becomes `.xlsm`, which QuoteFlow rejects today; when is draft → final; the Capacity Exhibit's 360 vs 365 days.
2. **Gemma:** is the ERF workbook the layout Pricing will keep using until the makeover, and when does the new costing template land; which cells hold unit cost, price and contribution margin on the new one; and is she comfortable with QuoteFlow showing the extracted figures to every role that can read the quote (CLAUDE.md rule 2), or should `model_summary_visible` go off until she decides.
3. **Both:** the one-page summary template was not in the email. Is the `0. Financial Summary` sheet that page, or is a separate one-pager coming?

## Left for later (list in the PR, do not build)
- `.xlsm` support (macros; the print-view macro is only a note in the draft).
- A "Download the current template" link inside QuoteFlow (would need the blank template stored by an Admin, never in git).
- Extraction for the new costing template; re-running extraction when an Admin changes the map; `price_table` summaries.
- Any AI reading of CERs or workbooks (Stacy's note); rule 9 and the Ranger work are separate.
- Stacy's note on EBITDA add-backs and sub-$25K projects (her model, not QuoteFlow's).

## Ground rules (same as every FB step)
- **Authorization on the server**, matrix tests for every changed or new route, allowed and denied for every role (KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Finance, Approver, Leadership, Admin).
- **No hard-coded open rules.** The cell maps, the warning thresholds, `model_summary_visible` and the capacity schedule live in config, seeded `provisional: true`.
- **Fabric-safe (rule 10).** `numeric` ≤ 38 precision, no new `jsonb` or arrays without a `_json` companion registered in `packages/db/src/fabric.ts`, no partitioning, no `TRUNCATE`; the guard tests pass.
- **Tests:** unit (reader, template recognition, errors, blanks, dates, text-that-looks-like-a-number, capacity); API integration on real Postgres (upload the synthetic file → fields stored; a junk `.xlsx` → stored with "summary unavailable"; versions; removal restoring the previous summary; Finance and PricingLead upload; every role reading); Playwright: the existing costing → payback → price approved → Final Review path now shows the summary on both screens, and a bad workbook shows the warning without blocking.
- Run `docker compose up -d db`, then **`pnpm verify`**, and fix every failure. Never skip or weaken a test. Conventional Commits (`feat(models): …`), a draft PR, the repo's PR template.
- **Docs:** `pnpm db:dictionary` if the schema changed; update `docs/uat` scripts and quick-starts for the new summary and the "Payback" wording; `docs/security/route-inventory.md`.

## Acceptance
- [ ] Uploading the synthetic payback workbook to a quote that needs one shows the summary on the Quoting tab and at Final Review, with file, version, uploader and date; a changed or missing layout shows "summary unavailable" and a reason, and never blocks the upload or G3
- [ ] The cell map is config an Admin can edit; no cell address is in code
- [ ] No real figure, name or file from the three workbooks is anywhere in the repo, PR or change log (`gitleaks` clean; you grepped the diff for the plant, customer and ERF names you saw)
- [ ] Errors, negatives and blanks from the workbook are shown honestly and flagged, not hidden
- [ ] "Payback" wording is in the UI, quick-starts, scripts and release notes, with internal identifiers unchanged
- [ ] The capacity helper matches your hand-computed cases, applies OEE once and changes no existing G2 or utilization behaviour (or is listed as dropped)
- [ ] The costing map is seeded inactive and the structure notes are in `feedback/inputs/`
- [ ] Permission-matrix tests, Playwright and `pnpm verify` pass; close-out done

## Close-out (do this last)
1. **Build docs (same PR):** in `03-build-steps.md` → "User feedback updates", add an **FB-14** entry (same shape as FB-07's) with "Built <YYYY-MM-DD>. Notes and deviations:", every provisional value you seeded and "Left for later". Update `04` §2a for the map, `model_summary_visible`, the "Payback" label and the inactive costing map; mark A-031 **partly received** (what came, what did not) in `04` and `05` §1 and §8; update the `feedback/inputs/README.md` table. Update `01-architecture.md` (data model, workflow §4) where you changed it.
2. **Repo change log (same PR):** `docs/build-guide/feedback-change-log.md`, one row per item (the summary, the rename, the capacity helper), columns as in FB-07, Type `Build change`, Status `In PR`, tracker IDs where they exist and "no tracker ID yet" where not. Rationale must say who sent what and when, what was deliberately not done, and which values await sign-off. **No figures or names from the workbooks.** Then mark earlier rows whose PRs merged as `Merged`.
3. **Tracker Change Log (after the PR is open):** the same procedure as FB-07: `sharepoint_search` for "QuoteFlow Change Log.csv", `read_resource`, append RFC 4180 rows, `sharepoint_update_file` with the full text. **Never touch `QuoteFlow Feedback Tracker.xlsx`.** If the connector is unavailable, end the reply with tab-separated rows under "Paste into the tracker's Change Log tab".
4. **Final reply:** what was built; what was dropped; the provisional values awaiting sign-off; the T- scenarios now ready (T-017); the structure-only notes you wrote; the draft email to Stacy and Gemma; anything you saw in the workbooks that Ben should know but that must not be committed (describe it, do not quote it); and the PR link.
