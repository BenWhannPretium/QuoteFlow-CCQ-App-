# FB-06 · Engineering roles, equipment BOM, two-step, pack-out, estimate workbook

**Run with:** Claude Code · **Sonnet 5.5 · high effort**, or **Opus 5.5 · high** if D-008 chooses several engineers per quote (that changes assignment, locks and lead review) · Wave 3, gated · one draft PR
**Tracker items:** F-058, F-062, F-024, F-025, F-026 · tests T-008, T-033 · **Gated on:** D-008 (roles), D-007 (two-step), A-003 (Kal's BOM template and component list; session Nov 6), A-014 (two-step and pack-out follow-up), the engineering estimate workbook (Paul Slomkowski; needed for F-026)

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

## What we know already (2026-11-05)
- **A-006 (Paul Slomkowski, Nov 4):** Paul is the Engineering Lead (approver). Randy Neiberger and Rafael Pasillas are the engineers, assigned by project × request type (e.g. PET × ISBM). That points to **one assignee chosen by type** (the build today), not several per quote. Confirm under D-008.
- `Engineering Projects Template - Copy.xlsx` in the Quote Flow folder is a **post-award** project and CER template (charter, EPO BOM, CER BOM). It isn't the engineering estimate workbook F-026 needs. Its EPO/CER BOM tabs may help F-058, so compare them with Kal's template.
- The build today has one `quote.assigned_engineer_id`, free-text `downstreamEquipmentNotes` and `equipmentBomNotes` (≤ 4000), and no two-step or pack-out fields.

## Build, by decision outcome
- **F-058: one required equipment BOM** (Kal Kaliszewski, Danielle Leu; V-029, V-030).
  - Merge "downstream equipment" and "equipment BOM" into one **Equipment BOM** section: rows of component (from Kal's component list, value list `equipment_component`, provisional until Kal signs off), description, quantity, and **capital cost (USD, numeric(14,2))**, plus a template upload (attachment kind `equipment_bom`).
  - Required to advance G2 with "capital required" (make it a G2 rule in config).
  - Migrate the two free-text fields into a read-only "Legacy notes" block. Deprecate those columns.
- **F-062: engineer assignment.**
  - If D-008 = one assignee by type: add **routing suggestions** (setting `engineering_assignment_rules`: process type × resin → suggested engineer, provisional). The lead still assigns.
  - If D-008 = several engineers: add `quote_engineer_assignment` (quote, user, part: `tooling` | `equipment`). Each part has its own fields, lock and submit-to-lead. The lead decides G2 once, when both parts are submitted (T-033). Update `lead-review`, `locks` (FB-01), notifications (FB-05) and the permission matrix.
  - **Capacity owner:** if D-008 names Production Planning (Faron Ipox) as the owner of capacity evidence, add the role mapping (the Supply Chain role or a new `CCQ.Capacity` app role with an Entra group, which needs the `06` runbook). Otherwise keep the EngLead sign-off.
- **F-024: two-step (preform)** (if D-007 says build it):
  - a "Two-step process" checkbox revealing **preform plant**, **blow plant** (plant list), preform number (≤ 40), freight-between-plants note (≤ 300)
  - visible to Pricing (T-008)
- **F-025: pack-out quantities** (if Engineering confirms): units per bag / tray / case and per pallet (whole numbers), entered by Engineering and shown to Pricing.
- **F-026: align to the engineering estimate workbook:**
  1. Write `docs/build-guide/feedback/engineering-estimate-mapping.md`. List each cost-driving cell in the workbook → its QuoteFlow field, or "intentionally excluded" with a reason.
  2. Add only fields that are agreed in that mapping and not already covered above.
  3. Send the excluded list to Bailey Schmitt as a question; don't build it.

## Acceptance
- [ ] each built item meets its tracker acceptance criteria; anything not decided is listed as waiting
- [ ] permission-matrix tests for new routes or roles; Playwright happy path for the engineering stage
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
