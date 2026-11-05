# FB-04 · Qualification, funding wording and the Salesforce link

**Run with:** Claude Code · **Sonnet 5.5 · medium effort** · Wave 2 (start after FB-01 merges; can run alongside FB-05) · one draft PR
**Tracker items:** F-065, F-005 (calculation check), F-073 (mechanism and display), F-022, F-076; V-055 ("Shared") · tests T-024, T-035, T-036 · decisions D-023, D-028 (decided); D-004, D-003 (open, provisional handling below)

**Paste into Claude Code from the repo root.**

---

These are small, well-defined changes from the Sales & Marketing leadership session and the Sponsor 1:1 (Nov 3), plus the Salesforce stopgap Pricing and Sales asked for. Most are config and copy. Keep the diff tight.

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
- `packages/domain/src/overrides/config.ts` (~84-115, `overridable_fields`), `overrides/lifecycle.ts`, `apps/api/src/services/overrideService.ts`
- `packages/domain/src/scoring/` (`score.ts`, `model.ts`, `inputs.ts`, `seeds.ts` `SCORING_MODEL_V1`), `packages/domain/src/config-admin/scoring-preview.ts`
- `packages/db/seeds/config/value-lists.ts` (`tooling_funding_model`), `settings.ts`
- `apps/web/src/routes/quotes/$quoteNumber.tsx` (~310-317, the SF id shown as text), `apps/web/src/components/outcome/CustomerDecision.tsx`

## 1. F-065: only sales leaders override priority (D-028, decided Nov 3)
**Acceptance:** "KAM role has no override option; sales leader can override with required justification visible to Engineering."
- In the `overridable_fields` setting, make `priority_tier` **self-applied by SalesLeader only**:
  - justification of at least 15 characters (keep the existing minimum)
  - KAM, EngLead and Pricing removed from requesters
  - Change it with a data migration (the setting is config).
- Leave `queue_position` (EngLead) and `ship_to` unchanged.
- **Pending requests** from roles that lose the right: leave them for the SalesLeader to decide. Don't auto-reject them; note this in the PR.
- The override's justification and tier appear on the Engineering queue row (tooltip or chip) and on the quote's priority panel (T-024).
- The UI no longer offers "Request override" to KAMs. The KAM's path is the existing escalation (`POST /quotes/:qn/escalations`). Show a one-line hint: "Need a different priority? Escalate to your sales leader."
- Permission-matrix and integration tests: a KAM is denied; a SalesLeader is allowed with a justification and denied without one; EngLead and Pricing are denied.

## 2. F-005: is the score calculating correctly? (Bug; weights wait for D-004)
**Acceptance:** "Priority score matches the agreed weights for a set of test quotes."
- Build 5 representative quotes as test fixtures (strong / weak on revenue, volume, timing, capital).
- Compute the expected score **by hand** from `SCORING_MODEL_V1` (weights revenue .20, volume .15, strategic_fit .15, capital_exposure .15, customer_risk .10, product_fit .15, timing .10; tiers ≥80 / ≥60 / ≥40), with the working shown in the test file.
- Assert the engine matches. If it doesn't, find and fix the defect (rounding, missing-input defaults, normalization, band edges) and explain it in the PR.
- **Don't change weights or bands**: they are D-004 (FB-10).
- Check that FB-02's "Quote needed by" now drives `timing`, if FB-02 has merged.

## 3. F-073: strategic fit by market (mechanism and display now; points wait for D-004)

- Today `strategic_fit` maps by `market` with an **empty map** (every quote scores 50).
- Read `docs/build-guide/feedback/inputs/9-box.md`. It holds the Where-to-Play tiers and segments, but the placement of segments in cells is unconfirmed, no points are defined, and the grid is **by segment** while QuoteFlow's `market` list is coarse. So **seed no strategic-fit values in this step.** Record in the notes and in `04` §2a that the points wait for D-004 (segment vs market, and points per cell).
- Build what doesn't depend on the values:
  - The **"Why this priority" panel** shows the market and the strategic-fit points it contributed (T-036), and labels them "provisional" while the map is empty.
  - The scoring config accepts an optional **segment-level map** (`strategic_fit.bySegment`) next to `byMarket`, so FB-10 can load the 9-box as data if D-004 chooses segments. The domain prefers segment over market over the default. Unit tests use a non-empty test map and prove two markets (and two segments) score differently.

## 4. F-022 and V-055: funding options (D-023 decided; "Shared" provisional under D-003)
- Relabel the `tooling_funding_model` value **ZERO_CER** as **"$0 CER (customer-reimbursed capital)"**, with help text (Oleg Yarovinski, Nov 3, D-023): "Follows the standard quoting process. The capital is reimbursed by the customer as a lump sum or through amortization, and is approved after award like company-funded capital. At purchasing, the customer invoice or contract goes with the mold PO." Show it as an ⓘ next to the option. No separate workflow path.
- Add **SHARED** ("Shared (company and customer)"), provisional, with help text "Split agreed with the customer; record the split in the terms notes until the terms structure is decided (D-003)."
- Use a data migration for both.

## 5. F-076: Salesforce link and update reminder (stopgap until write-back, F-035)
**Acceptance:** "Quote shows a link to its Salesforce opportunity; recording the outcome shows a reminder to update the opportunity."
- Add the setting `salesforce_instance_url` (e.g. `https://pretium.lightning.force.com`), not a secret. Seed it empty. If the Salesforce integration config already knows the instance URL, default to that and say so.
- The quote header shows **"Open in Salesforce ↗"** linking to `${instance}/lightning/r/Opportunity/${sfOpportunityId}/view` when the setting is set, and the plain id otherwise. `rel="noopener noreferrer"`, new tab.
- After a G5 outcome is saved (Awarded, Lost, Expired, In negotiation, Re-quote), show a dismissible reminder: **"Update the Salesforce opportunity to match: <stage>."** Include the link. Map our outcome to the SF stage name using the existing SF stage map (`packages/domain/src/outcome/sf-stage.ts`).
  - Dismissing it writes nothing.
  - The mismatch flag that already exists keeps working.
- Playwright: record Awarded and see the reminder with the link (T-035).

## Acceptance (this step's boxes in `03-build-steps.md`)
- [ ] F-065, F-005, F-073 (mechanism and display), F-022, V-055 and F-076 as above
- [ ] data migrations for settings, the value list and (if seeded) the scoring model; Fabric guards pass
- [ ] `pnpm verify` passes
- [ ] close-out done (rows for F-065, F-005, F-073, F-022, F-076; V-055 inside F-022's row)

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
