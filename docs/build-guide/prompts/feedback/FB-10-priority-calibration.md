# FB-10 · Priority calibration

**Run with:** Claude Code · **Sonnet 5.5 · medium effort** · Wave 3, gated · one draft PR
**Tracker items:** F-005 (weights), F-073 (points), F-066 (P1: guardrail warnings) · tests T-011, T-025, T-036 · **Gated on:** D-004 (bands, weights, 9-box points by market, volume bands and minimums from the machine platform guide). Owners: Matthew Graden, Jennifer Wulf, Tania Nazario, Melanie Rasche; inputs A-009 (9-box) and A-010 (platform guide, MOQs).

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
- **The engine:** `packages/domain/src/scoring/`.
  - Weights and tiers are in the `scoring_model` table: v1 weights are revenue .20, volume .15, strategic_fit .15, capital_exposure .15, customer_risk .10, product_fit .15, timing .10; tiers Critical ≥80, High ≥60, Standard ≥40.
  - There is a preview in `config-admin/scoring-preview.ts`.
- **FB-04** fixed any calculation defect, added the golden tests, and showed strategic-fit points by market.
- **FB-02** made "Quote needed by" drive `timing` (Danielle Leu: Engineering wants timing weighted).
- **The debate (synthesis conflict 7):**
  - Matthew Graden: keep it simple, rank by revenue.
  - Jennifer Wulf: revenue isn't always the driver.
  - Melanie Rasche: strategic fit by segment.
  - Tania Nazario: the score shouldn't lead for strategic bids. The override (FB-04) covers this.

## Build
- Create a **new scoring-model version** with the decided weights, bands and market → strategic-fit points (data migration; `provisional = false` only if D-004 names the approver). Keep the previous version for history. Existing quotes keep their score until re-scored; re-score open quotes only if D-004 says so, and audit each change.
- **Volume bands and qualification routing (T-011):** apply the decided bands from the platform guide. Quotes above and below the bands route to the SalesLeader at G1; in-band quotes follow the decided path.
- **F-066 guardrails (P1, T-025):**
  - Setting `intake_guardrails`: per process / platform, a minimum annual volume (and size, if decided).
  - Intake shows a **non-blocking** warning when the quote is below the minimum ("Below the platform minimum for <platform>: <n> units/yr. You can still submit."), and the warning is recorded on the quote for G1.
- Use the admin preview to show Ben the before and after tiers for the current open quotes. Include the table in the PR.

## Acceptance
- [ ] T-011, T-025 and T-036 pass; the golden tests are updated to the new version with the working shown
- [ ] the previous model version is kept; re-scoring (if any) is audited
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
