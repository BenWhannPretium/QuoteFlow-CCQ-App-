# FB-09 · Data standards and value lists

**Run with:** Claude Code · **Sonnet 5.5 · medium effort** · Wave 3, gated (can run in pieces as lists arrive) · one draft PR per batch of lists
**Tracker items:** F-012, F-019, F-020, F-057 (plant list) · plus the D-006 mandatory list · **Gated on:** D-016 (packaging standards, free-text caps, where "Other" is allowed), D-006 (mandatory fields), and the lists themselves:
- active plants (~29) and machine types: Jim Zweifel
- resin, market and product family: Danielle Leu
- plant pack-out standards: A-028
- PCR levels confirmed: Engineering and Supply Chain

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
- Value lists live in the `value_list` config table (seeded from `packages/db/seeds/config/value-lists.ts`) and are editable in Admin → Lists. Every config row has `provisional`, `approved_by` and `approved_at`.
- **Much of this step may be done by an Admin in the console instead of in code.** Use code (a data migration) when:
  - (a) a list must be identical in test and prod and reviewed in a PR, or
  - (b) the validation itself changes (caps, required rules).

## Build
- **F-020 lists:**
  - For each list a named owner has signed off: load the values with a data migration, deactivate (don't delete) retired values, and set `provisional = false`, `approved_by = <owner name in the decision record>`, `approved_at`.
  - Lists without sign-off keep `provisional = true`.
  - Add a test that every list referenced by a form has at least one active value.
- **F-057 plants:**
  - Replace `PLANT_01` to `PLANT_03` with the active plants and deactivate the placeholders.
  - Report any existing quotes or capacity rows that used a placeholder, so test data can be remapped. Map them only in synthetic seeds, never by guessing on real quotes.
- **F-012 packaging (D-016):**
  - Apply the decided list. If "Plant specified" is kept, it is allowed only where Engineering has published that plant's standard configuration (setting `plant_packaging_standards`, plant → configuration text). Otherwise the option is hidden.
  - "Other" is reserved for customer-dictated specs, needs a capped note, and prompts the KAM to attach the customer's packaging document.
- **F-019 free text (D-015 decided, caps from D-016):**
  - Apply the agreed caps (default ~500) to the free-text fields D-016 lists. Prefer a value list where D-016 names one.
  - Existing longer texts stay readable. Only new edits are capped, so the UI warns when an old value exceeds the cap.
- **D-006 mandatory list:**
  - Update `intake_required_fields` and INTAKE_COMPLETE to the decided set by data migration, keeping FB-02's drawing-or-minimum-spec rule.
  - Follow Kal Kaliszewski's warning (V-029): forced fields yield "N/A". Required fields get no "N/A" option unless D-006 adds one explicitly.

## Acceptance
- [ ] lists signed off by an owner are loaded and marked approved; the others stay provisional and are listed in the notes
- [ ] F-012, F-019 and F-057 (plants) meet the tracker acceptance criteria
- [ ] `pnpm verify` passes; close-out done (one change-log row per list, naming the approving owner)

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
