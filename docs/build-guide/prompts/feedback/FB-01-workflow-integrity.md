# FB-01 · Workflow integrity: locks, send-back paths, Final Review unblock, exception notes

**Run with:** Claude Code · **Opus 5.5 · high effort** · Wave 1 (runs alongside FB-02 and FB-03) · one draft PR
**Tracker items:** F-001, F-027, F-029, F-030, F-069 · verify F-003, F-004, F-028 · tests T-001, T-005, T-014, T-015, T-016, T-018, T-026

**Paste into Claude Code from the repo root.**

---

You are fixing the workflow gaps that stakeholders saw in the QuoteFlow walkthroughs (Pricing, Oct 30; Sales & Marketing leadership, Nov 3). These rules decide who can change a quote and where it goes when it is sent back. Correctness matters more than speed: read the code paths named below before changing them, and put every rule in `packages/domain` with unit tests.

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
- `packages/domain/src/workflow/seeds/hybrid.ts` (gates, outcomes, `requiresNote`, `notify`, targets) and `workflow/evaluate.ts` (note and reason enforcement)
- `packages/domain/src/lead-review/index.ts` (`lockedFor`, `lockedForActor`; L-9 submit-to-lead)
- `packages/domain/src/engineering/review.ts` (`canEditEngReview`), `packages/domain/src/pricing/record.ts` (`canEditQuoting`)
- `apps/api/src/services/commercial.ts` (terms and capital flag: `canEdit: open && …`), `packages/domain/src/commercial/terms.ts`
- `apps/api/src/services/intake.ts` (~670-722, KAM resubmission), `apps/api/src/services/returned-to-kam.ts`, `apps/api/src/services/gateService.ts`
- `packages/domain/src/final-review/` (`availability.ts`, `release.ts`), `apps/web/src/components/final-review/ReviewScreen.tsx`
- `packages/domain/src/workflow/seeds/reason-codes.ts`, `packages/db/seeds/config/settings.ts`

## 1. F-001: lock a section once its gate is decided (Bug, P0)
**Asked by:** Kyle Arnold and Gemma Cebolla (Pricing). **Acceptance:** "After a gate is approved, its sections are read-only for all roles except via send-back."
- **Today:**
  - The engineering review is editable only in ENG_REVIEW, and the pricing record only in QUOTING, both respecting the lead-review lock. That already locks them once the quote moves on.
  - **Terms and the capital flag stay editable until the quote closes**, including after G4 approval.
- **Build:** add `packages/domain/src/locks/` with one pure function per section:
  - `engineering`: locked after G2 is decided with an advancing outcome
  - `pricing`: locked after G3 is decided with an advancing outcome
  - `commercialTerms` and `capitalFlag`: locked after G4 Approve
  
  Each returns `{ locked, decidedBy, decidedAt, gate }`. A send-back that re-opens a stage (G3 rework → Engineering, G4 return, G5/G6 re-quote) unlocks the sections of the target stage and every later stage. Route the existing `canEdit*` checks through these functions so there is one source of truth.
- **Enforce on the server for every write route of those sections:**
  - PUT `/quotes/:qn/eng-review`, `/capacity-evidence`, `/capacity-signoff`, `/pricing-record`, `/capital-readiness`, `/terms`, `/capital-flag`
  - Return `409` problem+json, `type …/section-locked`, `code SECTION_LOCKED`, naming the gate and the decider.
  - Write an `audit_event` for refused attempts only if the existing pattern does so for other refusals; don't invent a new pattern.
- **UI:** a locked section shows read-only fields and a small lock line: "Locked after G2 · decided by <name> on <date> · reopens if the quote is sent back". Hide the edit controls; the server is the control.
- **Tests:**
  - Unit: each section × each gate outcome.
  - Integration: every role gets 409 after the decision, and a send-back re-opens the section.
  - Playwright: approve G3, then show the pricing fields as read-only (T-001).

## 2. F-029: Pricing can send back to the KAM (Change, P0)
**Asked by:** Kyle Arnold. **Acceptance:** "Pricing can send back to KAM or Engineering with a reason."
- Add a G3 outcome **`rework_kam`**, labelled "Rework (back to KAM)":
  - target INTAKE, reason from the `rework` context, **note required**, version bump as other reworks do
  - help text in `outcome-help.ts`
- Keep the existing G3 `rework` and relabel it "Rework (back to Engineering)" if it isn't already.
- It must appear in the decision dialog for the G3 decider (PricingLead, `gate.G3.submit`). It also goes through lead review the same way other G3 outcomes do: a pricer can't decide G3.
- The KAM's "Returned to me" list (`returned-to-kam.ts`) includes it, with the reason and note.
- Ship the new outcome to existing environments with a data migration that updates the workflow config row, not just the seed.

## 3. F-030: a KAM's fix goes straight back to Pricing (Change, P0)
**Asked by:** Kyle Arnold. **Acceptance:** "Quote returned from Pricing to KAM goes back directly to Pricing unless scope change is flagged."
- **Today:** a resubmission always re-enters INTAKE, waits at G1 (if enabled) and then goes to Engineering.
- **Build:**
  - Store the origin of a rework on the quote when it is sent back: the stage it came from. It is a nullable column, set on rework and cleared on resubmit.
  - Add an outcome property **`resumeAt: 'origin' | 'intake'`**: `origin` for G3 `rework_kam`, `intake` (the current behaviour) for every other rework.
  - On resubmit, when `resumeAt = origin`, the KAM sees a required yes/no: **"Did the scope change?"** (help: product, volume, resin, drawing or plant changed).
    - **No:** the quote goes straight back to QUOTING. The assigned pricer and the PricingLead stay as they were, and the pricing record is unlocked for the pricer.
    - **Yes:** the quote routes as a new submission (G1 if `g1_enabled`, then Engineering).
  - Record the answer on the timeline and in the audit (`quote.resubmitted`, with `scopeChanged` and `resumedAt`).
- G1 and G2 reworks behave exactly as today.
- **Tests:**
  - Unit: the routing table.
  - Integration: both answers.
  - Playwright: Pricing → KAM → "No" → back in Quoting (T-005).

## 4. F-069: the Final Review approver isn't blocked by other roles' fields (Bug, P0)
**Seen in the Nov 3 demo.** **Acceptance:** "Approver can complete final review without fields owned by other roles; legal review is optional."
- **Today:** G4 Approve requires `terms_checked_at` and, when `legal_review_required`, `legal_reviewed_on` (`OFFER_READY` in `hybrid.ts`). Only the KAM, SalesLeader, Pricing and PricingLead can set those, and the Final Review screen doesn't show them.
- **Build:**
  - Make those two conditions **configurable**: a setting `g4_required_checks` (array of `terms_checked` | `legal_review`), seeded `[]` and provisional, with a data migration. The decision on who finalizes terms is still open (tracker D-003, built in FB-08), so the default must not block the approver.
  - When a check is not required, but the terms are unchecked or a Legal trigger fired without a review date, show it on the Final Review screen as a **warning** with a link to the quote's Commercial panel. The approver can still approve.
  - Record in the G4 decision payload that the approver saw the warnings (`acknowledgedWarnings: string[]`).
  - Add a read-only **Terms and Legal** section to `ReviewScreen.tsx`:
    - funding model, MOQ, payment terms, non-standard flag
    - Legal triggers and the review status
- **Tests:**
  - Unit: availability with the setting on and off.
  - Integration: an approver approves with unchecked terms when the setting is `[]`, and is blocked when it is `['terms_checked']`.
  - Playwright on a 390 px viewport: approve with warnings (T-026).

## 5. F-027: notes required on exception decisions (Change, P0)
**Asked by:** Graham Parle (Pricing) and Bailey Schmitt (PMO). Decision D-015 says notes are for exceptions only. **Acceptance:** "Advance with risk, capital required, hold, rework, redirect and stop all require a note."
- Set `requiresNote: true` in the outcome config for every outcome of these kinds at every gate where it exists:
  - G2 `proceed_with_risk` (already true; keep it)
  - G2 `capital_required`
  - `hold` (G1–G6, including G5 `on_hold`)
  - `rework` / `rework_kam` / `return` / `requote` / `recost`
  - `redirect`
  - `stop`
- Leave plain Advance, Approve and Awarded without a required note.
- Use a data migration so test and prod pick it up. `evaluate.ts` already enforces `requiresNote`; add unit tests per gate.
- The dialog marks the note as required, with the help text "Required for exception decisions".

## 6. Verify the "in progress" items (F-003, F-004, F-028)
The code shows them built under L-9 and B-26 A6:
- `submitToLead` notifies EngLead / PricingLead with `quote.submitted_to_lead`.
- `POST /quotes/:qn/pricing-assignment` notifies the pricer with `quote.pricing_assigned`.
- `/quoting/submit` and `/quoting/send-back` exist.

**Don't rebuild them.** Add any missing integration tests for T-014, T-015 and T-016:
- An engineer submits → every EngLead gets an in-app row and an email outbox row.
- The PricingLead assigns → the pricer is notified and sees the quote in their assignments.
- A pricer submits → the PricingLead approves (G3) or sends it back with a note.

If a test fails, fix the defect. Note in the PR whether each one was already working.

## Acceptance (this step's boxes in `03-build-steps.md`)
- [ ] F-001, F-029, F-030, F-069 and F-027 behave as above, with server enforcement and tests
- [ ] F-003, F-004 and F-028 covered by passing integration tests
- [ ] permission-matrix tests for every changed route (allowed and denied per role); route inventory current
- [ ] data migration updates the workflow config and settings in existing environments; Fabric guard tests pass
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
