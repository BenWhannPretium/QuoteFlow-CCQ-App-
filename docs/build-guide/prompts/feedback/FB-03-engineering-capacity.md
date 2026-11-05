# FB-03 · Engineering review and capacity

**Run with:** Claude Code · **Sonnet 5.5 · high effort** · Wave 1 (runs alongside FB-01 and FB-02) · one draft PR
**Tracker items:** F-057 (machine type and cavitation; the plant list waits for FB-09), F-059, F-061 (P1, bundled because it's the same code), F-064, F-023 (display) · tests T-023, T-030 · open decision D-021 (provisional handling below)

**Paste into Claude Code from the repo root.**

---

Engineering and Supply Chain (Nov 3) asked for the following:
- Drop "buffer": Faron Ipox, Danielle Leu and Paul Slomkowski each defined it differently.
- Show line utilization before and after the new business, calculated rather than typed.
- Make the evidence exportable so it can support a later CER.
- Never let a budgetary quote read as CER-ready. Paul and Kal Kaliszewski: "we've been burned way too many times".
- Fix the engineering dropdowns.

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
- `packages/contracts/src/eng-review.ts` (`EngReviewBody` ~14-31; capacity evidence ~57-78), `packages/domain/src/engineering/review.ts`
- `apps/web/src/components/engineering/EngineeringTab.tsx` (~269-290 and ~700-880 capacity UI)
- `packages/db/src/schema/workflow.ts` (eng review, capacity evidence ~806), `packages/db/seeds/config/value-lists.ts` (`machine_type`), `settings.ts`
- `packages/domain/src/pricing/record.ts` (capital readiness, CER reference), `apps/web/src/components/pricing/QuotingTab.tsx` (~672)
- `packages/domain/src/outcome/handoff.ts` (Stage 6 hand-off record)
- `packages/domain/src/policy/sensitivity.ts` and `redact.ts`: capacity numbers are listed there, but redaction strips nothing today (CLAUDE.md rule 2). Keep it that way.

## 1. F-059: replace buffer with utilization before and after (Change, P0)
**Acceptance:** "Buffer % removed; utilization before and after shown; after-utilization auto-calculates from cavitation, cycle time and volume."
- Remove `bufferPct` from the contract, API and UI. **Keep the DB column**: deprecate it with `COMMENT`, stop writing it, and keep existing values (Fabric and history).
- Each capacity evidence row gains:
  - **Utilization before %**: entered, 0–100; the line's current load. Replaces the typed "Utilization %"; migrate existing values into it.
  - **Allocated annual volume (units)**: defaults to the quote's estimated annual volume. When the business is split across lines or plants (T-030), the engineer sets each row's share. Warn, don't block, when the rows don't add up to the total.
  - **Scheduled run days per year**: defaults from the setting below; editable per row.
  - **Utilization after %**: **calculated, read-only**, stored for reporting.
- **Formula.** This is the shape of Faron Ipox's Nov 4 email (Q-035). It is recorded verbatim in `docs/build-guide/feedback/inputs/capacity-formula.md`, including the OEE-applied-twice typo, which A-023 asks him to confirm; apply OEE once. Put it in `packages/domain/src/engineering/capacity.ts` as a pure function:
  ```
  annualCapacityUnits = (86_400 / cycleTimeS) × cavitation × (effectivenessPct / 100) × scheduledRunDaysPerYear
  addedUtilizationPct = allocatedAnnualVolume / annualCapacityUnits × 100
  utilizationAfterPct = utilizationBeforePct + addedUtilizationPct
  ```
  - `effectivenessPct` is the row's existing "Assumed effectiveness %" (the OEE stand-in; it is deliberately never defaulted).
  - `cavitation` comes from the engineering review.
  - Round for display to one decimal place. Over 100 % shows red with "exceeds line capacity". Over the setting `capacity_basis.warnAbovePct` (seed 85, provisional) shows amber.
  - Use `numeric(7,2)` for the stored percentages.
- **Setting `capacity_basis`** (provisional, data migration; D-021 is open):
  ```
  { scheduledRunDaysPerYear: 350, warnAbovePct: 85, basisLabel: "Trailing 12 months actual, trending OEE (provisional, D-021)" }
  ```
  Show `basisLabel` under the capacity table.
- Unit tests: a worked example with round numbers (cycle 10 s, 4 cavities, 80 %, 350 days → 9,676,800 units/yr), zero and invalid guards (cycle time > 0), and the split-across-rows warning.

## 2. F-061: export and attach capacity evidence (New capability, P1, bundled)
- Add a **"Download CSV"** button on the capacity section, served by `GET /quotes/:qn/capacity-evidence.csv`.
  - Permission: the same read permission as the engineering review. Add a permission-matrix test.
  - Every row with the computed after-utilization, the basis label, the quote number and the generation time.
  - Write an `audit_event` for the export (rule 3).
- Add the attachment kind `capacity_analysis` ("Capacity analysis") in the contract, domain file types and DB check (migration). It is offered from the capacity section's "Attach analysis" button.
- Leave "capacity output required before Engineering advances" to the existing G2 capacity sign-off rule. Note this in the deviations.

## 3. F-064: budgetary capital, not CER-ready (Change, P0)
**Acceptance:** "Capital section labeled budgetary/preliminary; no CER reference needed to quote; ready-for-CER checkbox available after award."
- Relabel Engineering's "Preliminary capital (USD)" as **"Budgetary capital estimate (USD): preliminary, includes contingency"**, with help text: "A budgetary figure for quoting. It is refined after award, before any CER." Use the same label wherever it is displayed (Final Review screen, list columns, analytics labels).
- **Quoting tab:** remove the **CER reference** input. Keep the column and show existing values read-only as "Legacy CER reference" only when set. The capital readiness statuses keep their codes; update the labels and help text so none implies a CER is ready (e.g. `pre_approved` → "Capital pre-approved (budgetary)"). Don't change the G3 rules: the capital-readiness structure is part of D-001 (FB-07).
- **Stage 6 (Commit & Hand Off):** add a checkbox **"Ready for CER development"** to the hand-off record, with who and when (audited). It is available only after G5 Awarded and edited by those who can edit the hand-off record.

## 4. F-057: dropdowns and validation (Change, P0, part)
**Acceptance:** "Machine type list excludes EBM Wheel; plant list matches active plants; cavitation accepts whole numbers up to 99."
- Deactivate `EBM_WHEEL` in `machine_type` with a data migration. Existing quotes keep and display it; nobody can pick it.
- Cavitation becomes a whole number **1–99**: change the contract and UI, and add a DB check `NOT VALID` so existing rows over 99 aren't rejected. Report any existing rows over 99 in the PR.
- **Plant list: don't change it.** It waits for Jim Zweifel's active plant list (FB-09). Record this in the notes.

## 5. F-023: product facts in front of Engineering
Show the intake's resin (and customer-specified grade), PCR %, color and additives, and the variants note, in the Engineering review header. These come from FB-02. If FB-02 hasn't merged when you start, render only the fields that exist in the contract today and add a note in the PR. Don't add the intake columns here.

## Tests
- Unit: the formula and rounding, warnings, the cavitation bounds, the lock on the CER-ready checkbox before award.
- Integration: save evidence with two rows (T-030), CSV export content and audit, permissions, machine-type deactivation.
- Playwright: an engineer enters two lines, sees before and after, and downloads the CSV (T-023, T-030).

## Acceptance (this step's boxes in `03-build-steps.md`)
- [ ] F-059, F-061, F-064, F-057 (part) and F-023 (display) as above
- [ ] migrations apply; Fabric guard tests pass; data dictionary regenerated
- [ ] `pnpm verify` passes
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
