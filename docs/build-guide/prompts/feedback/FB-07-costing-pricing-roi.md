# FB-07 · Costing, ROI and price confirmation in sequence; model uploads and versions; Finance role

**Run with:** Claude Code · **Opus 5.5 · high effort** · Wave 3, **ready (unblocked 2026-11-09)** · one draft PR
**Tracker items:** F-031, F-032, F-074, F-081, F-083 · tests T-017, T-034 · **Unblocked by:** D-001 and D-031 (decided Nov 9, ROI & capital session: Bailey Schmitt, Gemma Cebolla, Stacy Slocum, Oleg Yarovinski), D-013 (decided: upload a template and extract a one-page summary). **Not needed to start:** the standard templates (A-031); the one-page extraction waits for them. **Open, build as config:** whether QuoteFlow may *show* cost, price, margin and ROI figures extracted from the workbook (CLAUDE.md rule 5: figures are not *edited* in CCQ; rule 2: visible to every reader). Show only extracted values, never typed ones.

**Paste into Claude Code from the repo root.**

---

## Stop check (do this first)
The gating decision is made. Before writing code:
1. Read the **Decision record** below. It is pre-filled; Ben changes it only if the decisions change.
2. If the Microsoft 365 connector is available, read the tracker's Decision Log rows D-001, D-013 and D-031 and confirm their Status is `Decided`. **If D-001 is not `Decided`, stop and say so**: Bailey was to confirm it with Oleg in writing (A-036). If the tracker is out of date but the record below is pasted, continue and note it.
3. The Finance role needs an Entra app role and group (A-032, IT lead time). Build the role in code, the matrix, personas and tests now; the Entra step is IT's, so say in the PR that it is outstanding.

**Decision record:**
```
D-001: costing, then ROI, then price confirmation, as steps inside Quoting. Pricing uploads the costing model (costs and the initial price assumptions). Stacy Slocum (Finance) builds the ROI from it and uploads it, only when capital is required ($0 CER included); she is an input, not an approver. The pricing lead confirms the price (an updated price table is optional), then Final Review. Not a separate gate, not in parallel. Decided by Bailey Schmitt, Gemma Cebolla and Stacy Slocum with Oleg Yarovinski present, on 2026-11-09. Oleg to confirm in writing (A-036).
D-031: the gate is renamed "Price approved"; capital readiness stays a separate field. Decided 2026-11-09.
Transcript: Teams "Costing, Pricing & ROI Alignment - CCQ", 2026-11-09 (Ben has it).
```

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

## Context
- **Gemma Cebolla:** "it's kind of weird to approve a price without knowing what my ROI is" (V-018). Nov 9: "price confirmed means we've locked our numbers down, that give us the return that we want."
- **Stacy Slocum (Finance, new; owns ROI):** she uses a financial-model template (the board-review template) and takes pricing and costing assumptions from Pricing, not from email: "I can just go right to this system and get my assumptions." Today ROI was never a formal step: costing was done, then price confirmation, and the payback came later (cost divided by margin). She only needs to be involved when capital is required.
- **Oleg Yarovinski:** ROI and gross-margin targets are his; the payback calculation was simple; everything here is **before** the CER.
- **Today:** G3 = the price approval (or pass-through) + the costing attestation + capital readiness. Costing stays in Excel. Attachments have no versions. The gate is called "Price approved & capital ready".
- **Scope:** everything in QuoteFlow is capital quoting; stock and existing capital stay in Salesforce.

## Build
- **Sequence inside Quoting (F-032, D-001).** Model the steps like `lead-review` parts, not as new stages.
  1. **Costing:** Pricing uploads the `cost_model` (one file holds costs and the initial pricing assumptions). The existing "costing completed" attestation stays and now also requires a current `cost_model`.
  2. **ROI:** the Finance role uploads the `roi_model`. Required when `roi_required_when` says so (setting, provisional): the G2 outcome is "capital required", or the capital-likely flag is set, or the funding model is customer-funded or $0 CER. When not required, the step shows "not required" and why.
  3. **Price approved:** the pricing lead confirms (G3). The G3 rules require the current `cost_model` and, when ROI is required, the current `roi_model`. The pricing lead may upload an updated price table (optional, kind `price_table`) when the price changed; if not, confirming means the price in the models stands.
  Each step records who and when, shows on the timeline, notifies the next person through FB-05's resolver (Finance when costing is uploaded and ROI is required; the pricing lead when ROI is uploaded), and locks per FB-01's rules once G3 is decided. Sending the quote back reopens the steps.
- **F-083 Finance role.** Add a `Finance` role (app role `CCQ.Finance`, group `SG-CCQ-Finance`, provisional name) with `quote.read`, `quote.read.commercialFields`, `roi.upload` and nothing else. Add it to the matrix, a dev persona, the matrix and route tests, the quick-starts and `06-azure-entra-setup.md`. Pricing and the pricing lead can also see the ROI; only Finance and Admin upload it (and the PricingLead when Finance is not yet assigned: decide in the matrix and record it).
- **F-081 rename.** Change the G3 gate label, button help, notification text, outcome help, `release-notes`, `01-architecture.md`, the UAT scripts and quick-starts to **"Price approved"**. Capital readiness remains its own field and panel. This is config (outcome and gate labels) plus a data migration for existing environments (skip rows an admin changed, as in earlier migrations).
- **F-031 / F-074 uploads and versions** (D-013).
  - Attachment kinds `cost_model`, `roi_model`, `price_table`. One current record per kind per quote, with version history: a new upload supersedes the previous one (`superseded_by`, `superseded_at`), the latest is flagged, earlier versions stay downloadable. Implement versioning generally on attachments (kind-scoped).
  - **One-page summary:** build it only when the standard templates and their cell map are in `docs/build-guide/feedback/inputs/` (A-031). Until then show file name, version, uploader and date. When extraction is built, read the agreed cells read-only into `cost_model_summary` (numeric(18,4)); a failed extraction keeps the file and shows "summary unavailable" with the reason. Tests use a synthetic template fixture (`*.synthetic.xlsx`; real models are never committed).
- **Open quotes migration.** Quotes in QUOTING with the costing attested and no `cost_model` upload keep working: mark the new requirement `grandfathered` for them and show "no model on file" instead of blocking. Write a dry-run report first. Update the analytics views **and their T-SQL twins** (`packages/db/sql/fabric/`, rule 10).

## Acceptance
- [ ] tracker acceptance criteria for F-031, F-032, F-074, F-081 and F-083 pass (T-017, T-034)
- [ ] the change is config plus a migration, with a dry-run report for open quotes; analytics twins updated; Fabric guards pass
- [ ] permission-matrix tests for every new permission and the Finance role (allowed and denied for every role); Playwright for costing → ROI → price approved → Final Review (and the "ROI not required" path)
- [ ] `pnpm verify` passes; close-out done

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
