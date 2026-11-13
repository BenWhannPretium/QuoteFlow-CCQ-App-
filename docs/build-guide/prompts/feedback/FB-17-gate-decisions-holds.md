# FB-17 · Gate decisions: four plain choices, holds that make sense, Stop without a closure-owner pick, no "Capital required"

**Run with:** Claude Code · the most capable model · **high** effort · **Wave 2: start when FB-16 has merged** (both change G2 and the gate dialog) · in parallel with FB-18 · one draft PR · branch `claude/fb-17-gate-decisions`
**Walkthrough items:** W13-22 to W13-25, W13-27, W13-28, and the timeline half of W13-26 (`docs/build-guide/feedback/inputs/walkthrough-2026-11-13.md`). FB-18 builds the Command Center half of W13-26. **Tracker rows it follows:** F-027 (notes on exception decisions), F-029 / F-030 (send-back paths), F-058 / D-033 (equipment BOM), D-001 (ROI / payback when capital is needed)

**Paste into Claude Code from the repo root.**

---

## Stop check
Confirm FB-16 has merged into `main` (the Production Scheduler role, "Decide feasibility" with the capacity checkbox). If it hasn't, stop and say so.

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
- **Migrations.** The last migration on 2026-11-13 was `0043_funding_help_text.sql`. Use the next free number when you start (`ls packages/db/migrations`). Before you open the PR, `git fetch origin main`. If a new migration has landed, rebase and renumber yours: the file name, `meta/NNNN_snapshot.json`, and `idx`/`tag` in `meta/_journal.json`. Then re-run the integration tests. FB-17 and FB-18 run in parallel; FB-17 adds a migration.
- **Synthetic data only (rule 8).** No real customer, opportunity or person data in code, seeds, fixtures, screenshots or the PR. People's names that are already in the build guide may be used in docs.
- **Tests come with the feature.** Domain rules → Vitest unit tests. Routes → permission-matrix and integration tests on a real Postgres. UI → at least one Playwright happy path for each changed stage; check the changed screens at 1366 × 768 and at 390 px wide, in light and dark themes.
- **Before you open the PR, run `pnpm verify`** (lint, typecheck, unit, integration, build) with `docker compose up -d db`. If the session can't run Docker, use a local Postgres 16, or say so in the PR and let CI run the integration tests. Fix every failure. **Never skip, delete or weaken a test to get green.**
- **Git.** Conventional Commits (`feat(intake): …`), small logical commits, a **draft** PR that fills the repo's PR template. Do not put any AI model name in commits, code comments or the PR.
- **When something is genuinely missing** (a list, a name, a field from Salesforce), do not invent it. Build the mechanism, leave the value provisional, empty or switched off, list it in the PR under "Waiting on", and build the rest.

## What the code does today (read 2026-11-13; verify before relying on it)
- **Outcomes** (`packages/domain/src/workflow/seeds/hybrid.ts`; all provisional). The send-backs: G1 `rework` and G2 `rework` → INTAKE; G3 `recost` (stays in Quoting, clears the costing attestation, `gateService.ts` ~474), G3 `rework` → ENG_REVIEW, G3 `rework_kam` → INTAKE (`resumeAt: origin`); G4 `return` (the decider picks QUOTING or ENG_REVIEW; note required but **no reason code**); G5 `requote` and G6 `requote` → QUOTING or ENG_REVIEW. The redirects: G1 `redirect` "Redirect (not CCQ work)" is **terminal** (closes to REDIRECTED, `closeAs: 'redirected'`); G2 `redirect` "Redirect (alternative platform / site)" and G3 `redirect` "Redirect (alternative capital model)" **stay in their stage, active**. Holds: `hold` at G1, G2, G3, G4, G6 and `on_hold` at G5 (`HOLD_FIELDS`: `review_date`, `hold_owner_id`). Stops: `stop` (G1, G2, G3), `decline` (G4), `stop` (G6, not authorized).
- **Outcome keys are hard-coded in places**, so do not rename keys: `repos/analytics.ts` ~350 and the SQL views `50_intake_first_pass` (`'rework'` at G1/G2), `40_quote_cycle` (G4 `'approve'`), `95_quoting_step` (G3 `'submit'`), `80_assignment` (G2 `<> 'hold'`), each with a Fabric twin; `GateDecisionDialog.tsx` ~622, 691; `ReviewScreen.tsx` ~193, 760-762; `queue/engineering.tsx` ~745; `decision-label.ts`; `QuotingTab.tsx` ~643; `pricing/queue.ts` (`recost`), `lead-review/index.ts`.
- **Admin** can edit an outcome's label, help text, requiresNote, requiresReasonCode and required fields (`routes/admin/workflow.tsx`, `UpdateOutcomeBody`), but **cannot add, remove or switch off an outcome**: `gate_outcome_definition` has no `active` column (`packages/db/src/schema/config.ts` ~134-186); `transition_rule` references it with ON DELETE RESTRICT; `gate_decision.outcome_key` has no FK. `validate-config.ts` checks outcome/transition pairs, reason codes and closing rules.
- **The dialog** (`apps/web/src/components/GateDecisionDialog.tsx`) lists the server's `availableActions` as one flat radio list in config order (~377-422). The work tabs pre-filter it ("Hold, send back or stop", `EngineeringTab.tsx` ~113-121, `QuotingTab.tsx` ~108-116, via `forwardReadiness` in `lib/decision-label.ts`).
- **Closure owner** picker (~162-165, 372, 582-600): shown when the outcome closes the quote and has a default; options "The KAM (name)" / "Me (the decider)".
- **Hold owner** (~116-117, 168, 725-797): defaults to the decider ("Me"), with "The KAM (name)" and a user search. The server requires it (`HOLD_FIELDS`) and checks the user is active (`gateService.ts` ~252-263). Notifications (`notifications/recipients.ts` ~320-345): the hold owner and the KAM get `quote.on_hold`; **the decider is always removed**, so a "Me" owner is never notified.
- **Timeline** (`QuoteTimeline.tsx` ~84-87) shows "Put on hold" / "Hold ended" with no owner, reason or review date.
- **G2 `capital_required`** ("Advance – capital required"; rules `prelim_capital_usd` present, `CAPACITY_SIGNED_OFF`, `EQUIPMENT_BOM_ON_FILE`, `CAPACITY_CALCULATED`). Everything keyed to it: `app_setting.capital_readiness_on_outcome` `{"G2:capital_required":"pending"}` applied in `gateService.ts` ~551-565 to `pricing_record.capital_readiness`; `ROI_REQUIRED_WHEN_SEED.g2Outcomes` (`quoting-steps/index.ts` ~47-51; the setting `roi_required_when` also fires on `capital_likely` or CUSTOMER_FUNDED / ZERO_CER funding); `pricing/record.ts` ~405; `pricing/queue.ts` `FLAGGED_G2_OUTCOMES` (used in `services/pricing.ts` ~214); `final-review/queue.ts` `FINAL_REVIEW_FLAGGED_G2` and `final-review/warnings.ts` `G2_CAPITAL_REQUIRED`; `engineering-view.ts` ~146-157 (`requiredForCapital`, falls back to true if the outcome is missing); `EngineeringExtras.tsx` ~176-178 ("Upload this before you advance the quote as “Capital required”"); `QuotingTab.tsx` ~643, 719, 738; `decision-label.ts` `FORWARD_OUTCOMES.G2`; filter labels "Capital required / with risk" (`FinalReviewQueue.tsx` ~162, `queue/pricing.tsx` ~152; `?g2=` in `contracts/pricing-queue.ts`). No engineering yes/no "capital required" field exists; there is `eng_review.prelim_capital_usd` and the quote's `capital_likely` flag (`PUT /quotes/:qn/capital-flag`, G3 already checks readiness when it is true, `hybrid.ts` ~146-155).
- **Rules DSL** (`packages/domain/src/workflow/rules.ts`): leaves `present`, `minItems`, `equals`, `oneOf`, `gte`, combined with `anyOf` / `allOf`. Server-derived facts are already used in rules (e.g. `CAPACITY_CALCULATED`).
- **"Why?" score popover:** `PriorityBadge` (`apps/web/src/components/Priority.tsx` ~123-173), a Radix Popover with `<PopoverContent className="w-[min(28rem,calc(100vw-2rem))]" align="start">`, no `side`, no max height; the wrapper `components/ui/popover.tsx` sets `collisionPadding={16}`. Used in the G1 queue card (`approvals.tsx`) and the quote header.

## Build

**Files FB-18 also edits (it runs in parallel and merges after you):** `EngineeringTab.tsx`, `EngineeringExtras.tsx`, `QuotingTab.tsx`, `final-review/FinalReviewQueue.tsx`, `routes/queue/pricing.tsx`, `routes/queue/engineering.tsx`. Keep your changes there to the lines this prompt names (button text, the BOM text, the capital checks and filter labels); don't reformat or move code, so FB-18 rebases cleanly.

### A. Outcomes can be switched off (needed by B and C)
- Add `gate_outcome_definition.active boolean NOT NULL DEFAULT true` (Fabric-safe) to the schema, config types, seed and Admin. An inactive outcome is not offered (`availableActions`), is refused if posted (422), and **keeps resolving its label** for history: the timeline, analytics, exports, the review screen and old decisions read the same as before. Admin → Workflow can switch an outcome on or off (audited); `validate-config` refuses switching off a gate's last active outcome in the `advance` group (C.1), or, before groups exist in a config, its last active outcome whose transition goes to another non-terminal stage; its other checks keep applying to active outcomes. Tests for each.

### B. No "Advance – capital required" (W13-22)
1. Switch off G2 `capital_required` by migration (only while `approved_at` is null). Existing quotes decided with it keep it.
2. **What replaces the capital signal (provisional; record it):** capital is needed when the engineering review's **preliminary capital is above a threshold** (new setting `capital_needed_above_usd`, seed `0`). Expose it to the rules as a server-derived fact (e.g. `eng_capital_needed`).
   - **A blank figure must not mean "no capital"** (an engineer could then skip the BOM). Add `present('prelim_capital_usd')` to G2 `proceed` and `proceed_with_risk` (enter $0 when no capital is needed; update the field's hint to say so), by migration only while the rules still equal the seed. Provisional.
   - G2 `proceed` and `proceed_with_risk` get `anyOf([eng_capital_needed equals false, EQUIPMENT_BOM_ON_FILE])`, so the BOM is required exactly when capital is needed. Migrate the rule only while it still equals the seed.
   - On a G2 advance with capital needed, set `quote.capital_likely = true` (audited, on the timeline as "Capital needed: preliminary capital $X") and `pricing_record.capital_readiness = 'pending'`. Replace the `capital_readiness_on_outcome` lookup with the new trigger, but keep reading `G2:capital_required` so a historical decision still behaves as before.
   - Everywhere listed above that keyed on the outcome (`FLAGGED_G2_OUTCOMES`, `FINAL_REVIEW_FLAGGED_G2`, `G2_CAPITAL_REQUIRED`, `pricing/record.ts`, `QuotingTab.tsx`, the queue filters and their labels, `requiredForCapital`, the BOM upload text) now reads **"capital needed"**: `capital_likely`, or the derived fact, or a historical `capital_required` decision. Rename the filter label "Capital needed / with risk". The BOM text becomes "Required to advance when preliminary capital is above $0".
   - `roi_required_when` keeps working (it already fires on `capital_likely`); leave `capital_required` in its `g2Outcomes` for history.
3. Update every test and fixture that used the outcome, without weakening an assertion: a test that proved "capital required needs the BOM" now proves "capital needed needs the BOM".

### C. Four plain choices: Advance, Send back to…, Hold, Stop (W13-23, W13-24, W13-27)
Keep every outcome key and transition (analytics and SQL read them). Change what the decider sees:
1. The dialog groups the gate's active outcomes into **Advance**, **Send back to…**, **Hold** and **Stop**, from a new config column `gate_outcome_definition.outcome_group` (text: `advance` | `send_back` | `hold` | `stop` | `customer_outcome`; don't name it `group`, a reserved word in Postgres and T-SQL), seeded, provisional, shown in Admin, never inferred from key names in the UI. **G5 keeps its flat list:** Awarded, In negotiation, Lost, Expired and Re-quote are the customer's answer, not the four verbs, so they are `customer_outcome` (G5's `on_hold` is `hold`); the dialog shows a gate whose outcomes are all `customer_outcome` or `hold` exactly as today.
2. **Send back to…** shows one choice, then a required **"Send to"** select whose options are the send-back outcomes, labelled by where the quote goes (relabel by migration, only while untouched):
   - G1: "The KAM (fix the intake)" (`rework`)
   - G2: "The KAM (fix the intake)" (`rework`); "Engineering (try another platform or site)" (`redirect`)
   - G3: "Pricing (re-cost)" (`recost`); "Pricing (another capital model)" (`redirect`); "Engineering" (`rework`); "The KAM" (`rework_kam`)
   - G4: "Quoting" / "Engineering" (`return`'s existing target pick, shown in the same select)
   - G5 / G6: "Quoting" / "Engineering" (`requote`'s targets)
   
   Every send-back needs a **reason code and a note**. G4 `return` already has `reasonContext: 'rework'`; set `requiresReasonCode: true`. G2 `redirect` and G3 `redirect` have **no** reason context, and `validate-config.ts` (~34-41) refuses `requiresReasonCode` without one; the `redirect` context holds G1's not-CCQ codes, which are wrong here. Give them `reasonContext: 'rework'` and `requiresReasonCode: true`. All by migration, only while each row is untouched. The F-030 scope-changed question and the G3 resume behaviour are unchanged.
3. **Stop** holds `stop`, `decline` and G6 `stop`, plus G1 `redirect`, relabelled **"Stop: not CCQ work (send elsewhere)"**. It still closes as `redirected` with its own `redirect` reason codes, so analytics don't change.
4. **Hold:** help text on every hold outcome (setting/seed, provisional): "Pause the quote, for example when the customer asks to revisit it in 6 months. To get something fixed, use Send back to… instead." A send-back is never offered as a Hold.
5. **Stop without a closure-owner pick (W13-27):** hide the closure-owner picker when the transition's `closureOwnerDefault` is `decider` (Stop, Decline, G1 not-CCQ, G6 Stop): the closure owner is the decider, with no question asked. **Keep the picker unchanged for the `kam`-default customer outcomes** (G5 Lost and Expired, G6 Advance): the same dialog decides G5 and G6, and that picker is how a sales leader holding `outcome.assignOwner` names the closure owner (B-13, CR-39). The API is unchanged.
6. The work tabs' secondary button reads "Send back, hold or stop" and opens the grouped dialog. Placeholders and hints keyed on outcome keys (~622, 688-697) follow the group instead.

### D. The hold owner is the person who will clear it (W13-25)
- The hold-owner picker offers, in order: **the current stage's assignee(s)** ("The assigned engineer (name)", "The production scheduler (name)", "The assigned pricer (name)", whichever exist), "Me", "The KAM (name)", and the search. The default is the stage's assignee when there is exactly one, otherwise "Me". Provisional.
- The owner is always told, unless the owner is the decider. The KAM's message names the owner, reason and review date.

### E. Holds on the timeline (W13-26, timeline half)
- The timeline's hold entries show who placed it, the owner, the reason, the note and the review date ("On hold: Awaiting internal input. Owner: <name>. Review by <date>."), and "Hold ended" says by whom and how (a decision, or the review date passing if that ends it today). The quote header already shows the hold; check it reads the same.

### F. The "Why?" score popover fits on a laptop (W13-28)
- In `PriorityBadge`, cap the content at the available height and scroll inside it (`max-h-[var(--radix-popover-content-available-height)] overflow-y-auto`), keep collision handling on, and let it open upward when there is more room above. Test at 1366 × 768 and 1366 × 657 (a laptop with a taskbar) and at 390 px.

## Done when
- [ ] G2 needs a preliminary capital figure ($0 allowed)
- [ ] outcomes have `active`; inactive ones aren't offered or accepted and keep their labels in history; Admin toggles them; validation tested
- [ ] "Capital required" is off; capital needed is derived from preliminary capital; BOM, readiness, flags, filters, warnings and texts follow it; historical decisions behave as before
- [ ] the dialog shows Advance / Send back to… / Hold / Stop; send-back targets labelled by destination; every send-back has a reason code and a note; G1 not-CCQ sits under Stop; G5 unchanged; no closure-owner picker on decider-owned closures (kept for G5 Lost / Expired and G6 Advance)
- [ ] hold owner defaults to the stage's assignee and is notified; hold help text; holds readable on the timeline
- [ ] the "Why?" popover never runs off-screen
- [ ] no outcome key renamed; analytics and Fabric twins unchanged (or changed together, with `fabricTwins` green)
- [ ] permission-matrix tests for changed routes (Admin outcome toggle: allowed and denied for every role); Playwright: G2 send-back to the KAM with a reason, G3 send-back to Engineering, a hold with the engineer as owner, a G1 Stop not-CCQ; `pnpm verify` passes; close-out done

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
