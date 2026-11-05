# FB-02 · Intake overhaul: everything the KAM enters

**Run with:** Claude Code · **Opus 5.5 · high effort** · Wave 1 (runs alongside FB-01 and FB-03) · one draft PR
**Tracker items:** F-007, F-008, F-009, F-010, F-011, F-013, F-014, F-015, F-016, F-017, F-023, F-055, F-067, F-075 · tests T-003, T-004, T-009, T-012, T-013, T-020, T-022, T-027 · decisions D-011, D-012, D-018 (decided); D-017, D-030 (open, provisional handling below)

**Paste into Claude Code from the repo root.**

---

The KAM, Engineering and Sales-leadership walkthroughs (Nov 2–3) changed what intake must capture. Engineering can't quote without the right product facts, and KAMs mustn't re-type what Salesforce already holds. This step changes the intake contract, the database, the domain validation and the wizard together, so it is one PR. Work through it in the order below and commit after each numbered section.

## Ground rules for this step
- **Start from the latest `main`.** Read `CLAUDE.md` (non-negotiable rules 1–11), `docs/build-guide/03-build-steps.md` → "User feedback updates" (this step, the readiness table and the change-log procedure), and `docs/build-guide/04-decisions-and-risks.md` §2a.
- **The Feedback Tracker is the source of what was asked.** It is `QuoteFlow Feedback Tracker.xlsx` in SharePoint: `PMO › General › Projects › FY26 - Commercial Capital Quoting › 3. Design › Quote Flow`. If the Microsoft 365 connector is available, read the Build Backlog rows for this step's F- IDs and their linked T-/V-/D- rows before you build. If a row's acceptance criteria differ from this prompt, follow the tracker and record the difference as a deviation. If the connector isn't available, this prompt carries the acceptance criteria as of 2026-11-05.
- **Authorization on the server.** Every changed or new route declares its permission through `packages/domain/src/policy`. Add permission-matrix tests that check **allowed and denied for every role** (KAM, SalesLeader, EngLead, Engineer, Pricing, PricingLead, Approver, Leadership, Admin). Keep `docs/security/route-inventory.md` current (its test fails otherwise).
- **No hard-coded open rules.** Lists, thresholds, messages, required-field sets and formula bases go in config tables or settings, seeded `provisional: true`. Change config in existing environments with a data migration, not by editing seeds alone.
- **Audit everything** a user changes (append-only `audit_event`). Never update or delete audit rows.
- **Fabric-safe schema (rule 10).**
  - New `jsonb` or array column → a `<column>_json text` companion registered in `packages/db/src/fabric.ts`, with its trigger argument and a backfill.
  - Every `numeric` has precision ≤ 38.
  - No partitioning, no `TRUNCATE`.
  - Deprecate columns; don't drop them.
- **Migrations.** Use the next free number in `packages/db/migrations/`. Before you open the PR, `git fetch origin main`. If a new migration has landed there, rebase and renumber yours: the file name, `meta/NNNN_snapshot.json`, and `idx`/`tag` in `meta/_journal.json`. Then re-run the integration tests. Other FB steps run in parallel and will also add migrations.
- **Tests come with the feature:** domain rules → Vitest unit tests; routes → permission-matrix and integration tests (real Postgres); UI → at least one Playwright happy path for the changed stage.
- **Before opening the PR, run `pnpm verify`** (lint, typecheck, unit, integration, build) with `docker compose up -d db`. If the session can't run Docker, say so in the PR body and let CI run the integration tests. Fix every failure. Never skip or weaken a test to get green.
- Conventional Commits (`feat(intake): …`), a draft PR, and the repo's PR template.

## Read first
- `packages/contracts/src/intake.ts` (`IntakeDraftData`), `packages/contracts/src/attachments.ts`
- `packages/domain/src/intake/intake.ts` (submission rules, the drawing nudge ~187), `packages/domain/src/attachments/` (`file-types.ts`, `rules.ts`)
- `packages/db/src/schema/workflow.ts` (quote ~167-560, attachment ~976-1036), `packages/db/seeds/config/value-lists.ts`, `settings.ts`
- `apps/web/src/intake/` (`Steps.tsx`, `model.ts` `prefillFromOpportunity`, `OpportunityPicker.tsx`), `apps/web/src/routes/intake/new.tsx`
- `packages/integrations/src/salesforce/fieldMap.ts`, `packages/domain/src/workflow/seeds/hybrid.ts` (INTAKE_COMPLETE ~21)
- `packages/domain/src/scoring/` (the `timing` attribute)
- The QuoteFlow Field Inventory (SharePoint, Quote Flow folder) for Jim Zweifel's neck lists, if the connector is available. The lists are also copied below.

## 1. Salesforce front door: F-007, F-008, F-009, F-017
- **F-007: remove the new-customer form** (D-011: new accounts start in Salesforce; no ERP setup until the business is won).
  - The customer is always the Salesforce Account on the selected opportunity.
  - Remove the typed name, location and contact fields from the wizard and the contract. Leave the columns in the DB: deprecated, not written, with existing rows untouched.
  - Keep **`customer.status`** (CLAUDE.md rule 7, DEC-27) as one checkbox: **"Not yet a Pretium customer (no ERP account)"**. It still drives the `new_customer` Legal trigger.
  - T-004: a prospect created in Salesforce appears in the opportunity picker once synced.
- **F-008: no double entry.**
  - Everything already pulled from the opportunity, account and spec object pre-fills read-only, with a "from Salesforce" tag: amount, close date, resin, neck, volume, container size, ship-to.
  - The KAM may override **only** fields that already allow it (revenue, ship-to with a reason).
  - **T-009, snapshot vs live:** show the Salesforce **close date read-only from the latest synced snapshot**, labelled "Salesforce close date (updates with Salesforce)". Store no separate close date. Deprecate `expected_close_date`: stop writing it and keep existing values for history and analytics.
- **F-009:** add two **required** dates:
  - **Quote needed by**, which must be after today
  - **Product needed by**, labelled "best estimate of launch need", which must be on or after Quote needed by
  
  Feed **Quote needed by** into the scoring engine's `timing` attribute. It replaces whatever `timing` reads today; keep the `timing` bands in the scoring model config, without changing weights (D-004 is open). Add both dates to INTAKE_COMPLETE and the `intake_required_fields` setting (data migration).
- **F-017: ship/fill destination** (D-012: Engineering decides the plant with KAM input).
  - Rename the ship-to block to **"Ship / fill destination"**, with city and state required.
  - Pre-fill from Salesforce: the Account shipping address today. Add `Ship_to_Locations__c` only if `fieldMap.ts` already resolves it; otherwise leave the `TODO(D-18)`.
  - Show city and state on the Engineering queue and the review header.

## 2. Request class: F-067
- Only **CCQ** can be submitted. Add the setting `intake_allowed_request_classes`, seeded `["CCQ"]` and provisional.
- Choosing any other class shows a configurable message (`intake_redirect_message`, seeded *"Stock, stock-plus, price inquiries and pack-out evaluations stay in the pricing application for now. Submit them there."*, provisional; D-030 may change where pack-out changes go) and **disables Submit**.
- The server rejects a submit with a disallowed class (`422 REQUEST_CLASS_NOT_ALLOWED`). T-027.

## 3. Product facts: F-010, F-011, F-055, F-023, F-075
- **F-010: neck as three pick-lists** (Jim Zweifel, Nov 5, V-073; A-001). Add value lists `neck_diameter`, `neck_finish_type` and `neck_special_feature`, all provisional. **Rename "Other" to "Custom"**: choosing it reveals a required short description (≤ 120). The values (from the Field Inventory, sent by Jim):
  - **Neck diameter (mm):** 13, 15, 18, 20, 22, 24, 28, 30, 33, 35, 38, 40, 53, 58, 60, 63, 66, 70, 75, 83, 89, 100, 110, 120, 135, 155, 409 (120 mm snap), 605D (155 mm snap), Custom
  - **Neck finish:** 400, 410, 415, 485, CRC, BeriCap, DBJ, Deep Skirt, J-Cap, Jigger, Kerr, Pano, PCO-1810, PCO-1881 (Super Shorty), Ratchet, ROPP, Snap, Custom
  - **Special feature (optional):** CT (continuous thread), Multi Lead, Tamper Evident, Vented, Custom
  
  The tracker's F-010 text says two fields (diameter/finish + type). Jim's later list has three. Build three and record it as a deviation in the notes.
  
  **Migrate existing data:**
  - Split `28-410`, `38-400`, `89-400` and `110-400` into diameter + finish.
  - `120 DC` → diameter 120 + finish Custom ("DC").
  - Other → Custom, keeping the free text.
  
  Deactivate the old `neck_finish` list; don't delete it. Map Salesforce `Neck_Finish__c` pre-fill by the same rules, and leave it blank when it can't be parsed.
- **F-011: customer-specified resin.** Add a checkbox **"Customer-specified resin"** that reveals a required **"Supplier / grade"** (≤ 120, e.g. "LyondellBasell Pro-fax 6331"). Show it to Engineering and Pricing (T-013).
- **F-055: PCR %.** Add a value list `pcr_level` (0, 25, 50, 100; provisional; Engineering and Supply Chain agreed it as a starting point), shown in the resin section. Keep the existing PCR-HDPE / PCR-PET resin codes; don't migrate them.
- **F-023: color and additives** (Kyle Arnold, Tania Nazario).
  - **Color:** a value list `color_type` (Natural, Custom color; provisional). Custom reveals a required description (≤ 120).
  - **Additives:** an optional short note (≤ 200).
  
  Both are visible to Engineering and Pricing. FB-03 shows them in the Engineering header.
- **F-075: quote variants note** (the interim answer to D-017, option B). An optional **"Quote variants requested"** note (≤ 300, limit in a provisional setting), e.g. "price at 0/25/50% PCR; near-site vs ideal-site". It is visible to Engineering and Pricing and has no data-model branching. Structured scenarios are F-056 (P1).

## 4. Components: F-013
- Add **Decoration** to the `component` value list (provisional).
- Follow-up fields appear only when the component is selected, are required when shown, and are cleared when it is deselected:
  - **Liner:** liner spec (≤ 120)
  - **Label:** "Labels purchased by" (Customer / Pretium; value list)
  - **Decoration:** decoration type (value list: Silk screen, Hot stamp, Shrink sleeve, Other; provisional) and number of print colors (whole number 1–12)
- Bailey noted that Pretium's component list isn't final (V-090). Every list here is provisional.

## 5. Drawings, files and mold changes: F-014, F-015, F-016, T-003
- **F-014:**
  - Add attachment kinds **Bid file** (`bid_file`), **Project brief** (`project_brief`) and **Competitor / incumbent drawing** (`competitor_drawing`). Update the contract, the domain file types and the DB check constraint (migration).
  - Add an optional **"Customer RFP / portal link"** (https URL only, ≤ 500), shown to every role that reads the quote.
- **T-003: file names.** Prove with a test that a file named `P&G, bottle 1/2 rev.pdf` uploads, is stored under a safe key, keeps its display name, and downloads for Engineering. Fix the code if the test fails.
- **F-015: modify an existing mold** (in scope when capital or engineering review is needed; Bailey). Add a checkbox **"Modify an existing mold"**, which reveals:
  - **Existing mold / part number** (≤ 60, required)
  - **What changes** (≤ 500, required, e.g. "finish change 28-410 → 28-400")
  - a prompt to attach the reference drawing or part photo
  
  Show it on the Engineering queue as a "Mold modification" chip (T-012).
- **F-016: a drawing or the minimum spec set to advance** (D-018 decided: Paul Slomkowski, Jim Zweifel, Matthew Graden, Tania Nazario).
  - Add product dimensions: **Height**, **Width or diameter**, **Depth** (mm, numeric(10,2)) and **Gram weight** (g, numeric(10,2)), with units shown.
  - Add the setting `intake_min_spec_fields`, seeded provisionally `["height","widthOrDiameter","depth","gramWeight","neck","resin","color"]`. A-024 may add `layerStructure` and a container photo; leave a commented placeholder, not a field.
  - **Rule (domain, enforced by the API and the wizard):** a quote can be submitted only if it has a `bottle_drawing` (or `competitor_drawing`) attachment, **or** every field in `intake_min_spec_fields` is filled. "Neck" means diameter and finish.
  - The wizard shows which path is satisfied and what is missing. A drawing status of Coming / Sample only / None no longer submits on its own.
  - Error `422 DRAWING_OR_MIN_SPEC_REQUIRED` listing the missing fields (T-022). Unit-test every branch.

## 6. Wizard UX
- Keep four steps. Put the new fields in the existing sections:
  - Request: class, mold modification
  - Product: neck, resin, PCR, color, additives, components and follow-ups, dimensions
  - Packaging: unchanged (packaging waits on D-016, FB-09)
  - Volume and timing: volume, revenue, SF close date read-only, the two need-by dates, variants note
  - Drawing and files: drawing, attachments, RFP link
- Conditional fields animate in using the existing design system, and are keyboard and screen-reader accessible (the axe test must pass).
- At 390 px every field is reachable. The Review step summarizes everything, including the drawing-or-spec status.

## Tests
- Unit: the min-spec rule, conditional requirements (resin grade, Custom neck, components, mold modification, color), the neck migration mapping, the request-class block.
- Integration: submit allowed and blocked cases; Salesforce pre-fill; attachment kinds; the RFP link validation; permission tests for any changed route.
- Playwright:
  - happy path: a KAM picks an opportunity, fills the product facts with no drawing but the full spec, and submits
  - negative: no drawing and a missing gram weight → blocked with the field named

## Acceptance (this step's boxes in `03-build-steps.md`)
- [ ] every item in sections 1–5 behaves as described; the tracker acceptance criteria for F-007…F-075 are met or the deviation is recorded
- [ ] migrations (schema + data) apply on a copy of test data; Fabric guard tests pass; data dictionary regenerated
- [ ] `pnpm verify` passes; Playwright intake specs updated for the new fields
- [ ] close-out done

## Close-out: update the build docs and the change log (do this last)
1. **Build docs (same PR):**
   - In `docs/build-guide/03-build-steps.md` → "User feedback updates", tick this step's boxes. Add **"Built <YYYY-MM-DD>. Notes and deviations:"** listing anything built differently from this prompt or the tracker, every provisional value you seeded, and anything left for later.
   - Update `04-decisions-and-risks.md` §2a if you relied on a decision or seeded a provisional value for an open one.
   - Update the "User feedback updates" row in `05-path-to-mvp.md` §1.
   - Update `01-architecture.md` (workflow §4, permissions §3.4, notifications §4.3, data model §5) where you changed them.
   - Run `pnpm db:dictionary` if the schema changed.
2. **Repo change log (same PR):** in `docs/build-guide/feedback-change-log.md`, add one row per tracker item this step addressed, with these columns:
   - **Date** (today, US Central)
   - **Type** `Build change`
   - **Step** (this FB number)
   - **Change**: what was built, in words a KAM or engineer understands
   - **Feedback IDs**: the F- item plus the T-/V-/D-/Q- rows it closes or follows
   - **Raised by**: names and function, from the tracker
   - **Rationale**: the full reason for the change. Cover the feedback and who raised it, the decision it follows, why it was built this way, what was deliberately not done, and any provisional value awaiting sign-off.
   - **Status** `In PR`
   - **PR / commit**: the PR link once it exists
   
   Then change any earlier rows whose PRs have merged to `Merged`.
3. **Tracker Change Log (after the PR is open):** append the same rows to `QuoteFlow Change Log.csv` in the same SharePoint folder as the Feedback Tracker. Use the Microsoft 365 connector:
   1. `sharepoint_search` with query "QuoteFlow Change Log.csv".
   2. `read_resource` to read it.
   3. Append your rows as RFC 4180 CSV, quoting any field with a comma, quote or line break.
   4. `sharepoint_update_file` with the full text.
   
   Also update the Status of earlier rows that have merged. If the file is missing, create it with `sharepoint_upload_file` in the Quote Flow folder (the parent of the tracker), with the header `Date,Type,Step,Change,Feedback IDs,Raised by,Rationale,Status,PR`. **Never upload, replace or edit `QuoteFlow Feedback Tracker.xlsx` itself.** If the connector isn't available or the write fails, end your final reply with the rows as tab-separated lines under the heading "Paste into the tracker's Change Log tab".
4. **Final reply:** what was built, any deviations, the provisional values awaiting sign-off, which T- scenarios are now ready to test, and the PR link.
