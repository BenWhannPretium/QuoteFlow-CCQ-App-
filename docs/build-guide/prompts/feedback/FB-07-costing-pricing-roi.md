# FB-07 · Costing, pricing and ROI structure; cost model upload and versions

**Run with:** Claude Code · **Opus 5.5 · high effort** · Wave 3, gated · one draft PR
**Tracker items:** F-032, F-031, F-074 · tests T-017, T-034 · **Gated on:** D-001 (ROI & capital session, Oleg Yarovinski, Gemma Cebolla, Stacy Slocum; Mon Nov 9), D-013 (decided: upload a template and extract a one-page summary), the standard cost-model template (Gemma Cebolla, Kyle Arnold), and the answer to the synthesis's "Decide first #2": may QuoteFlow **show** cost, price, margin and ROI figures extracted from the workbook? CLAUDE.md rule 5 says pricing figures are not *edited* in CCQ, and rule 2 says figures are visible to every reader.

**Paste into Claude Code from the repo root.**

---

## Stop check (do this first)
This step is **gated**. Before writing code:
1. Read the **Decision record** below. Ben fills it in when he starts the session.
2. If the Microsoft 365 connector is available, also read the tracker's Decision Log and Action Items rows listed under "Gated on".
3. **If any gating decision is not `Decided`, and no decision is pasted below, stop.** Reply with what is missing and who owns it. Don't build on a guess: CLAUDE.md rule 4 forbids hard-coding open business rules.
4. If a decision is only partly made, build the decided part, keep the rest as provisional config, and list the remainder in the notes.

**Decision record (Ben pastes before running):**
```
<decision ID>: <outcome in one or two sentences>, decided by <name> on <date>
<input>: <where the file is, e.g. docs/build-guide/feedback/inputs/...>
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
- **Gemma Cebolla:** "it's kind of weird to approve a price without knowing what my ROI is" (V-018).
- **Oleg Yarovinski (Nov 3):** ROI informs pricing throughout. Oleg sets the ROI and gross-margin targets, Stacy Slocum validates ROI, and Pricing applies it (Q-029).
- **Today:** G3 = the price approval (or pass-through) + the costing attestation + capital readiness. Costing stays in Excel. Attachments have no versions.
- **Recommended (D-001 option B):** Costing as its own step, then Pricing and ROI in parallel through Final Review.

## Build, by decision outcome
- **F-032 stage model** (if D-001 = B):
  - Add a **Costing** stage and gate (seeded through the configurable stage engine, `01-architecture.md` §4; provisional labels) between Engineering Review and Quoting. Owner Pricing, decider PricingLead, lead review as at G3.
  - Pricing and ROI then run as **two required parts** of the Quoting stage, each submitted and approved. G3 needs both. Model the parts after `lead-review`, not as two stages, unless D-001 says otherwise.
  - Minimum ROI fields as decided (e.g. payback months, ROI %, "not required ($0 CER)" with a reason), entered by Pricing and validated by the ROI owner named in the decision.
  - Migrate open quotes:
    - quotes in QUOTING with the costing attested go to the new parts' state
    - quotes without it start at Costing
    - write a dry-run report first
  - Update the analytics views **and their T-SQL twins** (`packages/db/sql/fabric/`, rule 10), the SF stage map, the board columns and the UAT scripts.
- **F-031 cost-model upload and one-page summary** (D-013):
  - A `cost_model` attachment kind accepted only as the standard template (validate the sheet and cell signature from the template).
  - On upload, extract the agreed cells (cost, price, contribution margin, ROI/recovery) **read-only** into `cost_model_summary` (numeric(18,4)).
  - Show a one-page summary on the Quoting tab and the Final Review screen.
  - Values are never typed into QuoteFlow. A failed extraction keeps the file and shows "summary unavailable" with the reason.
  - Unit tests use a synthetic template fixture (`*.synthetic.xlsx`; real cost models are never committed).
- **F-074 versions:**
  - One cost-model record per quote with version history. A new upload supersedes the previous one (`superseded_by`, `superseded_at`), the latest is flagged, and earlier versions stay downloadable.
  - Implement the versioning generally on attachments (kind-scoped), so other kinds can use it later.

## Acceptance
- [ ] tracker acceptance criteria for F-031, F-032 and F-074 pass (T-017, T-034)
- [ ] the stage change is config plus a migration, with a dry-run report for open quotes; analytics twins updated; Fabric guards pass
- [ ] permission-matrix tests; Playwright for Costing → Pricing + ROI → Final Review
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
