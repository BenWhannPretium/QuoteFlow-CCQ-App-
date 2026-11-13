# FB-15 · Intake fixes: submit works, required fields stand out, "Other" asks, send-backs land on the field

**Run with:** Claude Code · the most capable model · **high** effort · **Wave 1** (in parallel with FB-16) · one draft PR · branch `claude/fb-15-intake-fixes`
**Walkthrough items:** W13-01 to W13-11 (`docs/build-guide/feedback/inputs/walkthrough-2026-11-13.md`) · **Tracker rows it follows:** D-006 (required fields, owner Bailey Schmitt), F-020 (value lists), F-085 (bid reference), V-055 / D-003 ("Shared" funding), D-011 / F-007 (not-yet-customer), F-076
**Deadline:** merged before Bailey's role-by-role walkthrough on **Tue 2026-11-17**. W13-01 (the submit bug) is the most important item in all of FB-15 to FB-19: every walkthrough starts at intake.

**Paste into Claude Code from the repo root.**

---

## Stop check: none
Everything here is either agreed in the walkthrough or ships as a provisional value that an Admin changes later (CLAUDE.md rule 4). If a value is genuinely missing, follow the last ground rule below.

## Ground rules for this step
- **Start from the latest `origin/main`.** Read `CLAUDE.md` (non-negotiable rules 1–11), then `docs/build-guide/01-architecture.md`, `docs/build-guide/03-build-steps.md` → "Walkthrough updates (FB-15 to FB-19)" (this step, the run order and the change-log procedure), and `docs/build-guide/04-decisions-and-risks.md` §2a. **Read `docs/build-guide/feedback/inputs/walkthrough-2026-11-13.md`**: it is the record of what was asked (the W13 IDs below), with the triage Ben agreed. Nothing else from the meeting is in the repo.
- **Verify before you build.** The "What the code does today" notes below were read from the code on 2026-11-13 (`main` at `f19bfc7`). Earlier FB steps may have merged since. Re-read every file you change. If the code differs from a note, follow the code and record the difference as a deviation. Never build on a note you have not checked.
- **Authorization on the server.** Every changed or new route declares its permission through `packages/domain/src/policy`. Add permission-matrix tests that check **allowed and denied for every role** (KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Finance, Approver, Leadership, Admin, PostAward, plus ProductionScheduler once FB-16 has merged). Keep `docs/security/route-inventory.md` current (its test fails otherwise). The UI may hide things; it is never the control.
- **No hard-coded open rules (rule 4).** Lists, labels, thresholds, messages, required-field sets and mappings go in config tables or app settings, seeded `provisional: true`. Change config in existing environments with a **data migration** that leaves a row alone when the business has approved it (`approved_at` set) or an Admin has edited it (follow `0026_fb01_workflow_integrity.sql` and `0036_fb09_value_lists_other.sql`). Editing a seed alone does not reach existing environments.
- **Audit everything** a user changes (append-only `audit_event`). Never update or delete audit rows.
- **Fabric-safe schema (rule 10).**
  - A new `jsonb` or array column gets a `<column>_json text` companion: register it in `packages/db/src/fabric.ts`, then add the column, the `zz_fabric_json` trigger argument and a backfill in the migration. Companions stay out of the Drizzle schema.
  - Every `numeric` has precision ≤ 38. No `inet`, `interval`, range, `tsvector` or geometric types; use `text`.
  - No partitioning, no `TRUNCATE`. Deprecate columns; don't drop them.
  - A new analytics view needs a T-SQL twin in `packages/db/sql/fabric/`.
  - The guard tests (`fabricCompat.test.ts`, `fabricTwins.test.ts`, `test/fabric.int.test.ts`) must pass.
- **Migrations.** The last migration on 2026-11-13 was `0043_funding_help_text.sql`. Use the next free number when you start (`ls packages/db/migrations`). Before you open the PR, `git fetch origin main`. If a new migration has landed, rebase and renumber yours: the file name, `meta/NNNN_snapshot.json`, and `idx`/`tag` in `meta/_journal.json`. Then re-run the integration tests. FB-15 and FB-16 run in parallel and both add migrations.
- **Synthetic data only (rule 8).** No real customer, opportunity or person data in code, seeds, fixtures, screenshots or the PR. People's names that are already in the build guide may be used in docs.
- **Tests come with the feature.** Domain rules → Vitest unit tests. Routes → permission-matrix and integration tests on a real Postgres. UI → at least one Playwright happy path for each changed stage; check the changed screens at 1366 × 768 and at 390 px wide, in light and dark themes.
- **Before you open the PR, run `pnpm verify`** (lint, typecheck, unit, integration, build) with `docker compose up -d db`. If the session can't run Docker, use a local Postgres 16, or say so in the PR and let CI run the integration tests. Fix every failure. **Never skip, delete or weaken a test to get green.**
- **Git.** Conventional Commits (`feat(intake): …`), small logical commits, a **draft** PR that fills the repo's PR template. Do not put any AI model name in commits, code comments or the PR.
- **When something is genuinely missing** (a list, a name, a field from Salesforce), do not invent it. Build the mechanism, leave the value provisional, empty or switched off, list it in the PR under "Waiting on", and build the rest.

## What the code does today (read 2026-11-13; verify before relying on it)
- **Submit.** `apps/web/src/routes/intake/new.tsx` (submit mutation ~295-319) calls `draft.flush()` then `api.submitDraft`. On a 422 it keeps only `err.message` (the problem `detail`, e.g. "The intake is missing required information") and shows it in `<Notice testId="submit-error">` (~469-482). The server's `errors` ([{path, message}]), `blocking` and `missing` (built by `incompleteError`, `apps/api/src/services/intake.ts` ~1170-1191) are **never read**. `submitError` is cleared only in `goTo` (~256-262), not when Submit is clicked again. On success only `draftsKey` is invalidated, so the quote page (`ReworkBanner`) and the dashboard can show stale data for up to 30 s.
- **Why the server can refuse what the client calls ready.** The Submit button is enabled from the client's own `evaluateDraft` (`apps/web/src/intake/model.ts` ~210-214); the server evaluates the **stored draft row** (`submitInTx`, ~692-701). Known causes:
  - (a) `useIntakeDraft.save` (`apps/web/src/intake/useIntakeDraft.ts` ~34-67) returns silently when `conflicted` is set and swallows a failed PATCH (e.g. 422 `invalidListValue` from `assertListValues`, ~279-294), so `flush()` resolves and the submit runs against an older server copy.
  - (b) `wizardConfig` (`model.ts` ~136-182) never passes `listCodes` (nor `keep`), so the client's `listValueIssues` returns nothing while the server blocks a retired or unknown code ("Pick a … from the list"). Public config is cached 5 minutes (`config/public-config.ts:16`).
  - (c) The tooling-funding `NativeSelect` (`Steps.tsx` ~810-821) has no blank or retired option, so a stored code that is not active shows as the first option while the data keeps the old code.
  - (d) Ship-to: when the Salesforce default formats to non-empty, step 2 shows the address read-only with no inputs (`Steps.tsx` ~164-167, 229-236). A partial Salesforce address (no state) still blocks "Destination state is required", and the "Fix" link (`focusIntakeField('ship_to.state')`, ~56-70) does nothing because no `intake-ship-to-state` element exists.
  - (e) Sub-market: the select filters to the chosen market (~1159-1170), so a stored sub-market of another market renders as "Choose…" yet blocks "This sub-market does not belong…".
  - (f) Rework drafts copy the last submitted data verbatim (`startRework`, ~453-496): a "Quote needed by" date that has passed fails "must be after today".
  - (g) The minimum-spec fields (needed when no drawing is attached: `intake_min_spec_fields`) block but carry no required marker.
- **Required marker.** `apps/web/src/intake/ui.tsx` ~32-37 renders `(required)` in small muted text after the label. `requiredFields` (`model.ts` ~119-120, 183-187) comes only from `intake_required_fields`. Sub-market and Market are optional (`packages/domain/src/intake/intake.ts` ~129-132).
- **"Other" with no follow-up:** `product_family` OTHER (plain Select, `Steps.tsx` ~1114-1122), `component` OTHER (no `followUps` meta), `decoration_type` OTHER (~681-692). `freight_type` OTHER only shows a hint (~873-877). Lists with meta `freeText` already open a required text field (resin, PCR, additive, color CUSTOM, the three neck lists, packaging, payment terms).
- **Salesforce pre-fill.** `prefillFromOpportunity` (`model.ts` ~292-346) uses only `detail.productSpecs[0]` from `Opportunity_Product_Specifications__c` (`packages/integrations/src/salesforce/fieldMap.ts` ~22, 77-88). `OpportunityLineItem` and `Product2` are not read. Market and sub-market are not read from Salesforce at all. `productSpecs` is empty when the live read fails or the object has no rows, and nothing tells the KAM. Commit 9fc458a made the pre-filled fields editable; a stale comment remains at `Steps.tsx` ~1047.
- **Send-back notification.** `quote.reworked` links to `/quotes/$quoteNumber` with no tab (`apps/web/src/lib/notification-target.ts` ~4-19, `NotificationRow.tsx`; email `apps/api/src/services/emailContent.ts` ~59-77). The intake route accepts only `?draft=`. In-page focus exists (`focusIntakeField`, `goTo(n, field)`).
- **Fields.** The bid reference is `bid_reference` / `bidReference` ("Bid / program reference (optional)", `BidReferenceField`, `Steps.tsx` ~722-739; help in `intake_field_help`). `color_type` = NATURAL, CUSTOM (freeText). `additive` = NONE, UV, BARRIER, ANTISTAT, IMPACT_MODIFIER, OTHER. `tooling_funding_model` SHARED has no split field (help "Record the agreed split in the terms notes"). `customer.status` (`not_yet_established`) is shown on the IntakeCard and the review step, not at hand-off or close.
- **Last migration:** 0043. A new value-list **key** needs `VALUE_LIST_KEYS` (`packages/db/src/schema/enums.ts`), the check constraint (`schema/config.ts`) and the constraint replaced in the migration (see 0036). New codes on an existing key do not.

## Build

### 1. W13-01: submit works, and says exactly what is missing (do this first)
1. **Reproduce before fixing.** Write a failing integration test (and, if practical, a Playwright spec) for each cause (a) to (g) that applies: the client says ready, the server refuses. Keep the tests.
2. **One evaluation, both sides.** The client evaluation must use the same inputs as the server: pass the active list codes (from public config) and the kept values into `evaluateDraft`, so a retired or unknown code shows in the review list with a Fix link before Submit. If public config can be stale, refetch it when the review step opens.
3. **Never submit a stale draft.** `flush()` must reject when the save fails or the draft is in conflict. Submit then shows the save error ("Your last change was not saved: …") instead of calling the server.
4. **Show the server's list.** On a 422, render every entry of `errors` / `blocking` as a list under the notice: the field's label (from `FIELD_META`, never the raw path) and the message, each with a **Fix** link that goes to the step and focuses the field. Normalise the paths (the server sends snake_case except `subMarket`). Keep the `drawing_or_min_spec` case's `missing` list. Clear the old error when Submit is clicked again.
5. **Fix each cause.** (c) A select whose stored code is not active shows it as "<label> (no longer offered)" or "Choose…", never as the first active option. (d) When the Salesforce ship-to lacks city or state, show inputs for the missing parts (the override reason is not needed for filling a blank); make every Fix target a real element id. (e) A sub-market that doesn't belong to the chosen market is cleared with a visible note ("Sub-market cleared: it belongs to another market"). (f) In a rework draft whose need-by dates have passed, the review list names them and Fix lands on them.
6. **No stale screens.** After a successful submit or resubmit, invalidate the quote, the dashboards and the notification queries, so Bailey's leftover warning on a resubmitted quote cannot recur. Find and remove any other place the "missing" warning can come from stale data.

### 2. W13-02: required fields stand out
- Replace the grey "(required)" with a **red asterisk before the label** (`<span aria-hidden="true" class="text-destructive">*</span>` plus visually hidden "required" for screen readers; check the contrast in light and dark). Put a one-line key at the top of each step: "* Required to submit".
- Mark every field the server would block on: `intake_required_fields`, the conditional follow-ups (already forced), and the **minimum-spec fields while no drawing is attached** (their marker goes away once a drawing is attached; say so in the field help).
- **Market and Sub-market become required** (Bailey Schmitt, owner of D-006, 2026-11-13). Add `market` and `sub_market` to `intake_required_fields` with a data migration that changes the setting only if it still equals the current seed (as 0028 did). Sub-market is required only when the chosen market has sub-markets. Provisional. A quote already submitted is not re-checked.
- Build the marker as one shared component (e.g. in `apps/web/src/components/forms.tsx`) so FB-16 and FB-18 can reuse it on the Engineering and other forms. FB-15 changes only the intake.

### 3. W13-03: "Other" always asks what it is
- Give `product_family` OTHER, `component` OTHER and `decoration_type` OTHER meta `freeText` and a required description field each ("Describe the product family", "Describe the other component", "Describe the decoration"), up to 200 characters (setting, provisional). New nullable `text` columns on `quote` (e.g. `product_family_other`, `component_other`, `decoration_type_other`), the draft contract, `intakeValues`, `CUSTOM_DESCRIPTION_FIELDS` or the follow-up mechanism (whichever fits), the review step, the quote's IntakeCard, the Engineering tab and Final Review.
- `freight_type` OTHER makes "Special freight arrangements" required while Other is picked.
- Unpicking Other clears and hides the description (as FB-09 does for resin).
- **Note for FB-19:** these new columns are product facts. List them in the PR so FB-19 moves them into `quote_item`.

### 4. W13-04: Salesforce product pre-fill (the part that needs no new field names)
- Find out why Zac's opportunity pre-filled nothing: an empty or failed `productSpecs` read, an unmatched code, or a value lost on save. Add a test for what you find.
- When Salesforce sent no product details, say so on the product step: "Salesforce has no product details for this opportunity. Fill these in from the customer's request." When the live read failed, say that instead.
- Keep **every** product spec in the draft (e.g. `sfProductSpecs` on `IntakeDraftData`, request-level), not only `[0]`, so FB-19 can turn each into an item. The pre-fill still uses the first one for now.
- **Do not guess Salesforce API names.** Reading the opportunity product record (`OpportunityLineItem` / `Product2`) and its parent market and end-use market waits for the field names from Zachary Cairns (W13-W10). Add a commented placeholder in `fieldMap.ts` saying so, and list it in the PR under "Waiting on".
- Remove the stale comment at `Steps.tsx` ~1047.

### 5. W13-05: a send-back opens the intake at the field to fix
- The `quote.reworked` notification (in-app and email) for the KAM links to a new route or param (e.g. `/quotes/$quoteNumber?rework=open`) that starts or reuses the rework draft (`startRework`) and opens it **at the review step**, with the sender's reason and note pinned at the top ("Sent back by <name>: <reason>. <note>") and the first blocking field focused. If nothing is blocking, it opens the step the note names, or step 1.
- Only the quote's KAM (and roles allowed to rework today) can start the rework: the server checks, as today.

### 6. W13-06 to W13-11: small field changes (all provisional)
- **W13-06 bid reference:** keep the field (Pricing asked for it, F-085). Relabel it "Customer bid / RFP reference (if the customer gave one)" and update its help: "Most customers don't send one. Leave it blank if not." It stays optional. Labels live in `FIELD_META` and `intake_field_help`; change the setting by migration only if untouched.
- **W13-07 stock colors:** add `STOCK_WHITE` "Stock white" and `STOCK_BLACK` "Stock black" to `color_type`, provisional, with `meta.resins: ['HDPE','PP']`. When a resin is picked, the color list shows a stock color only for its resins. PET stock colors wait for Seamus's list (W13-W5). Add help: "A stock color is the colorant Pretium uses for its stock items at that plant."
- **W13-08 fluorination:** add `FLUORINATION` "Fluorination" to `additive`, provisional; Engineering confirms (W13-W7).
- **W13-09 shared split:** when funding is SHARED, show an optional "Customer share %" (0–100, whole number or one decimal; new column `numeric(5,2)`), with the help "Pretium covers the rest". Show it wherever funding is shown (Quoting tab "From intake", Final Review, the quote's commercial panel). Out of range is refused on the server.
- **W13-10 not yet a customer:** when `customer.status` is `not_yet_established`, show a notice on the G6 hand-off view and on the closed-won quote: "This customer has no ERP account yet. Request master-data setup (help-desk ticket) as part of commercial activation." The text is an app setting (provisional).
- **W13-11 FAQ:** in `apps/web/public/help/quickstart.html` (KAM list) and the `sub_market` help in `intake_field_help`, add: "Beverage › Spirits & Mixers covers alcoholic drinks (Midas calls it Alcoholic)." Keep `print.html` in step.

## Done when
- [ ] W13-01: every cause found has a test that failed before and passes now; a 422 lists each missing field with its label and a working Fix link; a failed autosave stops the submit with a clear message; after a resubmit no stale warning remains (Playwright: KAM fills everything, submits, lands on the quote; KAM resubmits a rework, the warning is gone)
- [ ] W13-02: red asterisk on every field the server requires, including min-spec fields without a drawing and Market / Sub-market (migration, provisional)
- [ ] W13-03: Other on product family, component and decoration asks for a description, required at submit, shown downstream; freight Other requires the arrangements text
- [ ] W13-04: the cause is found and tested; the "no product details" notice shows; all specs are kept; Salesforce field names left for W13-W10
- [ ] W13-05: the send-back notification opens the rework at the review step with the note and the first field focused
- [ ] W13-06 to W13-11 built as written, provisional values recorded
- [ ] permission-matrix tests for any new or changed route; Playwright happy path for intake; `pnpm verify` passes; close-out done

## Close-out: update the build docs and the change log (do this last)
1. **Build docs (same PR):**
   - In `docs/build-guide/03-build-steps.md` → "Walkthrough updates (FB-15 to FB-19)", tick this step's boxes and change its heading status to **Built <YYYY-MM-DD> (in PR)**. Add **"Built <YYYY-MM-DD>. Notes and deviations:"** listing the migration number, anything built differently from this prompt (and why), every provisional value you seeded, and anything left for later.
   - In `docs/build-guide/feedback/inputs/walkthrough-2026-11-13.md`, add "Built in PR <link>" to the end of each W13 row this step closed.
   - Update `04-decisions-and-risks.md` §2a: add a table **"Provisional values FB-<n> seeded"** (value, seed, waits on, who signs off), as earlier steps did.
   - Update the "User feedback updates" row in `05-path-to-mvp.md` §1 with one sentence for this step.
   - Update `01-architecture.md` where you changed the workflow (§4), roles and permissions (§3.4), notifications (§4.3) or the data model (§5). Run `pnpm db:dictionary` if the schema changed.
   - UAT: update the affected scripts in `docs/uat/scripts/` and quick-starts in `docs/uat/quickstart/` (and `apps/web/public/help/quickstart.html` with `print.html` if they name a changed label) so Bailey's Tue Nov 17 round-table can follow them.
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
