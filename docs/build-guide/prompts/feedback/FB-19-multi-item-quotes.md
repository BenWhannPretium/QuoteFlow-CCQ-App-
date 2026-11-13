# FB-19 · Multi-item quotes: one quote number, several items, quoted together

**Run with:** Claude Code · the most capable model · **high** effort · **Wave 3: start when FB-15, FB-16, FB-17 and FB-18 have all merged** (it touches the intake, Engineering, Quoting and Final Review files they change) · one draft PR · branch `claude/fb-19-multi-item-quotes`
**Walkthrough items:** W13-32, W13-33, W13-34 (`docs/build-guide/feedback/inputs/walkthrough-2026-11-13.md`) · **Tracker rows it follows:** **F-084** (multi-item bids as one quote with items, duplicate-and-edit; P1 → **MVP**, Bailey Schmitt, 2026-11-13), D-005 (multi-item bids, open), F-085 (bid reference), F-056 / D-017 (multi-scenario quotes: each variant is an item)

**Paste into Claude Code from the repo root.**

---

## Stop check
1. Confirm FB-15 to FB-18 have merged into `main`. If not, stop and say so.
2. **Plan first, then build.** This is the largest change to the data model since B-03. Before writing code, post a short plan as the first commit (`docs/build-guide/feedback/fb19-plan.md`): the table, which columns move, how existing quotes are migrated, how each gate reads items, and the cut line below. Then build to it. Record any change of plan as a deviation.

## Decisions this step builds on (provisional; record each in `04` §2a)
D-005 is open. Bailey Schmitt (product owner) asked for multi-item quotes in the MVP on 2026-11-13; these are the assumptions Ben agreed for the build:
1. **One quote, many items, one workflow.** A quote keeps one quote number, one KAM, one opportunity and one set of gates. All its items move through the gates **together** (Bailey: "all things that need to be quoted at the same time within one record").
2. **Entered once per quote (request level):** the opportunity, customer, ship-to, request class, market and sub-market, **estimated annual revenue** (pre-filled from the opportunity amount; not summed from items; `INTAKE_COMPLETE` keeps its `anyOf` volume-or-revenue), quote-needed-by, payment terms, customer funding (and FB-15's shared %), returnable dunnage, price basis and freight, the bid / RFP reference, the RFP link, the variants note, comments for Engineering, and the attachments that are not about one item (bid file).
3. **Entered per item (product level):** product family (and its Other text), components and their follow-ups (and component / decoration Other texts), resin and grade, PCR, color, additive, the neck fields, container size, dimensions and gram weight, the existing-mold fields, packaging, drawing status, **annual volume**, **product needed by** (Zac: items can have different dates), the standard description, the item's drawings, and which Salesforce product spec it came from.
4. **Engineering per item, one engineer per quote.** Each item has its own engineering solution (plant, process & machine type, cavitation, cycle time, capital, two-step, pack-out) and its own capacity rows (W13-34: a variant at another plant is another item). One engineer (and one production scheduler) is assigned to the quote; lead review and capacity sign-off are once per quote and cover every item.
5. **Pricing once per quote.** One costing model, one payback model and one price table per quote, covering every item (Pricing works in Excel; the price table lists the items). Final Review and the offer are per quote and list every item.
6. **Scoring and analytics read the quote.** The quote's annual volume is the **sum** of its items, and the capital that scoring reads is the **sum** of the items' preliminary capital; product family, resin and the other product columns on `quote` mirror **item 1** (the "primary item") so scoring, routing, lists, analytics and the Fabric views keep working unchanged.
7. **Separate quotes are still allowed (W13-33).** A KAM may put hot items in one quote and the rest in another, so the one-active-quote-per-opportunity rule becomes a setting, seeded **allowed with a warning**. Linking related quotes is not built (Bailey: "not a need").

## Ground rules for this step
- **Start from the latest `origin/main`.** Read `CLAUDE.md` (non-negotiable rules 1–11), then `docs/build-guide/01-architecture.md`, `docs/build-guide/03-build-steps.md` → "Walkthrough updates (FB-15 to FB-19)" (this step, the run order and the change-log procedure), and `docs/build-guide/04-decisions-and-risks.md` §2a. **Read `docs/build-guide/feedback/inputs/walkthrough-2026-11-13.md`**: it is the record of what was asked (the W13 IDs below), with the triage Ben agreed. Nothing else from the meeting is in the repo.
- **Verify before you build.** The "What the code does today" notes below were read from the code on 2026-11-13 (`main` at `f19bfc7`). Earlier FB steps may have merged since. Re-read every file you change. If the code differs from a note, follow the code and record the difference as a deviation. Never build on a note you have not checked.
- **Authorization on the server.** Every changed or new route declares its permission through `packages/domain/src/policy`. Add permission-matrix tests that check **allowed and denied for every role** (KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Finance, Approver, Leadership, Admin, PostAward, plus ProductionScheduler: FB-16 adds it). Keep `docs/security/route-inventory.md` current (its test fails otherwise). The UI may hide things; it is never the control.
- **No hard-coded open rules (rule 4).** Lists, labels, thresholds, messages, required-field sets and mappings go in config tables or app settings, seeded `provisional: true`. Change config in existing environments with a **data migration** that leaves a row alone when the business has approved it (`approved_at` set) or an Admin has edited it (follow `0026_fb01_workflow_integrity.sql` and `0036_fb09_value_lists_other.sql`). Editing a seed alone does not reach existing environments.
- **Audit everything** a user changes (append-only `audit_event`). Never update or delete audit rows.
- **Fabric-safe schema (rule 10).**
  - A new `jsonb` or array column gets a `<column>_json text` companion: register it in `packages/db/src/fabric.ts`, then add the column, the `zz_fabric_json` trigger argument and a backfill in the migration. Companions stay out of the Drizzle schema.
  - Every `numeric` has precision ≤ 38. No `inet`, `interval`, range, `tsvector` or geometric types; use `text`.
  - No partitioning, no `TRUNCATE`. Deprecate columns; don't drop them.
  - A new analytics view needs a T-SQL twin in `packages/db/sql/fabric/`.
  - The guard tests (`fabricCompat.test.ts`, `fabricTwins.test.ts`, `test/fabric.int.test.ts`) must pass.
- **Migrations.** The last migration on 2026-11-13 was `0043_funding_help_text.sql`. Use the next free number when you start (`ls packages/db/migrations`). Before you open the PR, `git fetch origin main`. If a new migration has landed, rebase and renumber yours: the file name, `meta/NNNN_snapshot.json`, and `idx`/`tag` in `meta/_journal.json`. Then re-run the integration tests. FB-19 runs alone in its wave, but `main` may still move while it is open.
- **Synthetic data only (rule 8).** No real customer, opportunity or person data in code, seeds, fixtures, screenshots or the PR. People's names that are already in the build guide may be used in docs.
- **Tests come with the feature.** Domain rules → Vitest unit tests. Routes → permission-matrix and integration tests on a real Postgres. UI → at least one Playwright happy path for each changed stage; check the changed screens at 1366 × 768 and at 390 px wide, in light and dark themes.
- **Before you open the PR, run `pnpm verify`** (lint, typecheck, unit, integration, build) with `docker compose up -d db`. If the session can't run Docker, use a local Postgres 16, or say so in the PR and let CI run the integration tests. Fix every failure. **Never skip, delete or weaken a test to get green.**
- **Git.** Conventional Commits (`feat(intake): …`), small logical commits, a **draft** PR that fills the repo's PR template. Do not put any AI model name in commits, code comments or the PR.
- **When something is genuinely missing** (a list, a name, a field from Salesforce), do not invent it. Build the mechanism, leave the value provisional, empty or switched off, list it in the PR under "Waiting on", and build the rest.

## What the code does today (read 2026-11-13; verify before relying on it)
- **No items exist.** Product facts are columns on `quote` (`packages/db/src/schema/workflow.ts`, `quote` ~180-882): `product_family`, `resin`, `components[]`, `est_annual_volume(_confirmed)`, `drawing_status`, the neck columns, resin detail, PCR, color, additive(s), component follow-ups, dimensions, mold fields, `packaging_type/notes`, `description`, and `structured_description` jsonb (**container size lives only in `structured_description.size`**, written at `apps/api/src/services/intake.ts` ~763-769). FB-15 added `product_family_other`, `component_other`, `decoration_type_other` and the shared %; check its PR. `quote_variants_note` is a free-text stopgap (F-075).
- **One per quote today:** `eng_review` (unique `quote_id`, ~1067-1072), `handoff_record`, `pricing_record` (one per quote version), and versioned attachments (one current per `(quote_id, kind)`). Many per quote: `capacity_evidence` (no product key; `allocationCheck` compares the rows' allocated volume with the single `est_annual_volume`, `engineering/capacity.ts` ~216-240), comments, holds, decisions.
- **One active quote per opportunity:** unique index `quote_one_active_per_opportunity_uidx` (~868-872), the 409 `active_quote_exists` (intake ~735-745, contracts `ActiveQuoteRef`), and the RLS test "one active quote per SF opportunity (B-07)" (`packages/db/test/rls.int.test.ts` ~352).
- **Drafts:** `quote_draft.data` jsonb holds the whole `IntakeDraftData` (`packages/contracts/src/intake.ts` ~44-200; `intakeValues()` ~414-479 is the single draft → domain mapping). Rework copies the last submitted draft's `data`.
- **Salesforce:** `Opportunity_Product_Specifications__c` rows come back as `SfOpportunityDetail.productSpecs[]`; the intake used only `[0]` until FB-15, which now keeps them all in the draft.
- **Gates read a flattened state** (`packages/db/src/repos/transitions.ts` ~33-100; `INTAKE_COMPLETE` and `ENG_FEASIBLE` in `hybrid.ts`); intake blocking rules in `packages/domain/src/intake/intake.ts` (`evaluateIntake`).
- **Scoring** (`packages/db/src/repos/scoring.ts` ~20-35 `loadScoringFacts`; `scoring/seeds.ts`): volume and revenue from `quote`, product fit from `product_family+resin`, capital from `eng_review.prelim_capital_usd`. Volume-band routing and the guardrail also read the single volume.
- **Analytics views** (`packages/db/sql/analytics/*.sql`, twins in `sql/fabric/`) read `market`, `sub_market`, `product_family` and `est_annual_revenue` from `quote`; none read resin, volume, neck, dimensions or capacity rows.
- **RLS for a new quote child:** copy the three policies of `0042_fb14_model_summary.sql` (~65-79): `<t>_app` (`EXISTS (SELECT 1 FROM quote q WHERE q.id = <t>.quote_id)`), `<t>_migrator`, `<t>_readonly`, with RLS enabled and forced.

## Build

### A. Data model
1. **New table `quote_item`** (quote child): `id` uuid v7, `quote_id` FK, `item_no` smallint (1…n, unique per quote, no gaps after a removal), `label` text (the KAM's short name, e.g. "16 oz bottle", ≤ 60), every product-level column from decision 3 with the **same types and checks** as on `quote` today, a real `container_size` text column, `sf_product_spec_id` text, timestamps, `created_by`. Fabric: `components` (array) and any jsonb get `_json` companions registered in `fabric.ts`; numerics ≤ 38. RLS as 0042. A setting `quote_items_max` (provisional, 20).
2. **`eng_review` per item:** add `quote_item_id` (FK, NOT NULL after backfill) and replace the unique `quote_id` with unique `quote_item_id`. **Every join of `eng_review` on the quote will then return one row per item.** Fix each caller (join item 1, aggregate, or go per item, and test with a 3-item quote): `packages/db/src/repos/quote-read.ts`, `pricing.ts`, `pipeline.ts`, `records.ts`, `transitions.ts`, `admin-config.ts`, `engineering.ts`, `scoring.ts`, `packages/db/src/fb09Report.ts`, `apps/api/src/services/analytics-engineering.ts`, and anything else `grep -rn "engReview\|eng_review" packages/db/src apps/api/src packages/db/sql` finds. Lead review, assignment and the capacity **sign-off** stay per quote: move the sign-off columns, or read them from item 1's row, whichever keeps the code simplest; say which in the plan.
3. **`capacity_evidence` per item:** add `quote_item_id` (FK, NOT NULL after backfill). `allocationCheck` compares each item's rows with **that item's** volume.
4. **Migration for existing quotes:** create item 1 for every quote from its current columns (container size from `structured_description.size`), point every `eng_review` and `capacity_evidence` row at it, and backfill each draft's `data` with `items: [ … ]` built from its flat fields (keep reading the flat shape for a draft that has no `items`). Idempotent, tested on a copy of a seeded database, a no-op on an empty one.
5. **The `quote` mirror (decision 6):** on every submit, resubmit and item edit, the server writes the item-1 product columns to `quote` and `est_annual_volume` = the sum of all items' volumes (`est_annual_volume_confirmed` true only if every item's is). Document the mirror in `01-architecture.md` §5 and in the column comments: new code reads items, old readers keep working.
6. **One active quote per opportunity becomes a setting** `opportunity_active_quotes` (`one` | `warn`, provisional, seed `warn`).
   - **The unique index is today's only cross-KAM control.** The service check `getActiveQuoteForOpportunity` (`packages/db/src/repos/intake.ts` ~69-82, used in `apps/api/src/services/intake.ts` ~736) runs under RLS, so it only sees quotes the caller can see, and two concurrent inserts would race. So: run the check in **system context** (`withSystemContext`, `packages/db/src/withRequestContext.ts`) inside a transaction holding an **advisory lock keyed on `sf_opportunity_id`** (`withAdvisoryLock`, `packages/db/src/advisoryLock.ts`), and only then drop `quote_one_active_per_opportunity_uidx` (dropping an index is allowed; no column is dropped). The system-context read returns only the quote number and its KAM's name to the caller, never other fields.
   - With `warn`, starting an intake on an opportunity that already has an active quote shows "CCQ-… is already open for this opportunity (KAM: <name>). Add these items to it instead if it is still with you, or continue to start a separate quote", and the KAM confirms. With `one`, today's 409.
   - `listActiveQuotesForOpportunities` documents "at most one per opportunity": update it and its callers (intake ~307, the opportunity picker) to handle several.
   - The B-07 test in `packages/db/test/rls.int.test.ts` (~352-376) asserts the index's unique violation (`23505`); a service setting can't be tested there. Replace it with API integration tests for `one` (409) and `warn`, a cross-KAM case and a concurrent case, and say in the PR that the control moved (this is not a weakened test).

### B. Intake
1. The wizard asks the **request** fields once, then an **Items** step listing the items (number, label, product family, size, volume, need-by, a ✓ or the count of what is missing). Actions: **Add item**, **Add from Salesforce products** (one item per spec FB-15 kept, pre-filled the way `prefillFromOpportunity` does for one), **Duplicate** (copies every product field and the drawings' links, then opens the copy: F-084's "duplicate and change only the container fields"), **Remove** (with confirm; at least one item stays), and reorder. Each item opens the existing product steps.
2. **Validation per item.** `evaluateIntake` runs the request rules once and the product rules per item. Messages name the item ("Item 2 (16 oz bottle): Neck finish is required") and FB-15's Fix links go to that item's field. The client and server use the same evaluation (FB-15). Drawing-or-minimum-spec is checked **per item**, with the item's own drawings: attachments of kind `bottle_drawing`, `spec` and `competitor_drawing` get a nullable `quote_item_id` (draft uploads carry the item too).
3. **Rework:** the KAM can edit, add, duplicate and remove items in a rework; removing an item that Engineering has worked is allowed with a warning that its engineering work is discarded (kept in the audit).
4. Every item add, change, duplicate and remove is audited.

### C. Engineering
1. The Engineering tab shows an **item switcher** (tabs or a list: "Item 1: 16 oz bottle ✓", "Item 2: 24 oz bottle · 3 to do"). Each item has its own Solution, Two-step and pack-out, and Capacity rows; the lead-review panel, assignment and capacity sign-off sit above the switcher and cover the quote.
2. **G2 per item:** the configured G2 rules (`ENG_FEASIBLE` and whatever FB-17 left on `proceed` / `proceed_with_risk`) are evaluated **for each item** against the quote-level facts plus that item's review and capacity rows; the gate passes only when every item passes, and the missing list names the item. Keep the rules as config: evaluate them per item in the state builder, not by hard-coding fields. Capital needed (FB-17) is true when any item's preliminary capital is above the threshold. Submit-to-lead uses the same per-item check.
3. The Engineering queue shows the item count, and the capacity CSV export has an item column.

### D. Scoring, Pricing, Final Review, hand-off, lists
1. **Scoring** reads the mirror (sum of volumes; item 1's family and resin; quote-level market). The quote's priority breakdown says "3 items, 2.1 M units a year in total". Live weights are not changed.
2. **Quoting** shows the items (read-only facts and each item's engineering solution) above the single costing / payback / price-table uploads; the upload copy says the workbook covers every item.
3. **Final Review** and the review summary list every item with its key facts, plant and machine, volume and need-by; the offer is one per quote.
4. **G6 hand-off, the quote page, pipeline, board, search and CSV exports** show the item count and item 1's label ("16 oz bottle + 2 more"); the CSV can include one row per item as an option.
5. Analytics views keep working through the mirror. Add a new view `analytics_quote_item` (one row per item, no customer data) with its Fabric T-SQL twin, so Fabric reports can count items.

### E. Cut line if time runs out
If everything can't land in this PR, ship **A, B and D** first with Engineering still reading item 1 only and saying so on the tab ("Engineering for items 2 and later comes in the next update"), and put C in a follow-up PR the same day. Under the cut line, **G2 Advance (and Advance with risk) is refused for a quote with more than one item** until C ships, with that message as the reason; Hold, Send back to… and Stop still work.

## Done when
- [ ] `fb19-plan.md` committed first; deviations recorded
- [ ] `quote_item` with RLS and Fabric companions; existing quotes migrated to item 1 (tested); drafts backfilled; the `quote` mirror written and documented
- [ ] the one-active-quote rule is a setting (`warn` seeded); the B-07 test covers both values
- [ ] intake: Items step with add, add from Salesforce products, duplicate, remove, reorder; per-item validation with item-named Fix links; per-item drawings
- [ ] engineering per item with the item switcher; G2 evaluated per item from config; submit-to-lead per item
- [ ] scoring, Quoting, Final Review, hand-off, lists and exports show the items; `analytics_quote_item` with its twin
- [ ] tests: domain (per-item evaluation, mirror, volume sum, G2 per item), migration (backfill, idempotent, empty database), RLS (`quote_item` child visibility, another KAM's items hidden), permission matrix for every new route × every role, Fabric guards, Playwright (a KAM builds a 3-item quote from Salesforce products and a duplicate, submits; the engineer completes 3 items; G2 refuses with one item incomplete, then advances; Final Review lists 3 items); a single-item quote still runs end to end unchanged
- [ ] `pnpm verify` passes; close-out done

## Close-out: update the build docs and the change log (do this last)
1. **Build docs (same PR):**
   - In `docs/build-guide/03-build-steps.md` → "Walkthrough updates (FB-15 to FB-19)", tick this step's boxes and change its heading status to **Built <YYYY-MM-DD> (in PR)**. Add **"Built <YYYY-MM-DD>. Notes and deviations:"** listing the migration number, anything built differently from this prompt (and why), every provisional value you seeded, and anything left for later.
   - In `docs/build-guide/feedback/inputs/walkthrough-2026-11-13.md`, add "Built in PR <link>" to the end of each W13 row this step closed.
   - Update `04-decisions-and-risks.md` §2a: add a table **"Provisional values FB-<n> seeded"** (value, seed, waits on, who signs off), as earlier steps did.
   - Update the "User feedback updates" row in `05-path-to-mvp.md` §1 with one sentence for this step.
   - Update `01-architecture.md` where you changed the workflow (§4), roles and permissions (§3.4), notifications (§4.3) or the data model (§5). Run `pnpm db:dictionary` if the schema changed.
   - UAT: update the affected scripts in `docs/uat/scripts/` and quick-starts in `docs/uat/quickstart/` so Bailey's Tue Nov 17 round-table can follow them. The in-app help page is generated: edit `docs/uat/quickstart/print.html` (the source), then run `UPDATE_QUICKSTART=1 pnpm --filter @ccq/web test` to rewrite `apps/web/public/help/quickstart.html` (`apps/web/src/landing/quickstart.test.ts` checks they match).
2. **Repo change log (same PR):** in `docs/build-guide/feedback-change-log.md`, add one row per W13 item this step addressed, with these columns:
   - **Date** (today, US Central)
   - **Type** `Build change`
   - **Step** (this FB number)
   - **Change**: what was built, in words a KAM or engineer understands
   - **Feedback IDs**: the W13 ID plus any tracker F-/T-/V-/D-/A- rows it follows (listed in this prompt)
   - **Raised by**: names and function, from the walkthrough record
   - **Rationale**: the feedback and who raised it, why it was built this way, what was deliberately not done, and any provisional value awaiting sign-off
   - **Status** `In PR`
   - **PR / commit**: the PR link once it exists
   
   Then change any earlier rows whose PRs have merged to `Merged`. Append the same rows to `docs/build-guide/feedback/QuoteFlow Change Log.csv` (header `Date,Type,Step,Change,Feedback IDs,Raised by,Rationale,Status,PR`; RFC 4180, quoting any field with a comma, quote or line break) and update the Status of merged rows there too.
3. **Tracker (after the PR is open):** the W13 items are not yet rows in `QuoteFlow Feedback Tracker.xlsx`. Do not edit the workbook. In the PR body, under the heading **"Proposed tracker rows"**, list one tab-separated Build Backlog row per W13 item (ID left as `F-___`, source "Walkthrough continuation (Nov 13)", area, title, type, detail, raised by, status `In Progress`, build note with the PR link) for Bailey to paste. If the Microsoft 365 connector is available, also append the change-log rows to `QuoteFlow Change Log.csv` in the tracker's SharePoint folder (`sharepoint_search` for "QuoteFlow Change Log.csv", `read_resource`, append RFC 4180 rows, `sharepoint_update_file`). **Never upload, replace or edit the `.xlsx`.** If the connector isn't available, end your final reply with the rows under "Paste into the tracker's Change Log tab".
4. **Final reply:** what was built, any deviations, the provisional values awaiting sign-off, what is waiting on whom, which UAT scripts changed, and the PR link.
