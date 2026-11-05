# FB-05 · Notifications for hand-offs, returns and comments

**Run with:** Claude Code · **Sonnet 5.5 · high effort** · Wave 2 (**start after FB-01 has merged**: it adds the G3 → KAM rework and the resume-at-origin routing) · one draft PR
**Tracker items:** F-079, F-034 · re-check F-003 · tests T-010, T-014, T-037 · related: V-015, V-078, V-084, D-010 (interaction model, open: informs the design, doesn't block)

**Paste into Claude Code from the repo root.**

---

Three functions asked for this:
- John Kraus (KAM): "once submitted, we don't know where it stands."
- Jim Zweifel (Engineering): "automated notification to all parties when a task is complete and ready for handoff."
- Jennifer Wulf (Sales leadership): "a notification and due date for the process." (Due dates are F-072, P1, waiting on D-020. Don't build them.)

The notification framework exists: catalogue, in-app rows, email outbox, Graph mail, per-user preferences. The gap is that **outcome `notify` targets are only logged**, and comments notify @mentions only.

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
- `packages/domain/src/notifications/events.ts` (catalogue, email mode per type), `apps/api/src/services/notificationService.ts` (`persistNotifications` ~185), `apps/api/src/jobs/notificationDispatch.ts`, `apps/api/src/emails/`, `apps/api/src/services/emailContent.ts`
- `apps/api/src/app.ts` (~357-363: the after-commit hook that only logs `notify` targets)
- `apps/api/src/services/gateService.ts` (~443-467: `onReturnedToKam`, `onEngQueueArrival`, `onPricingArrival`, `onFinalReviewArrival`), `apps/api/src/services/final-review.ts` (`onFinalReviewDecided` ~360-415), `apps/api/src/services/lead-review.ts`
- `packages/domain/src/workflow/seeds/hybrid.ts` (`notify` on each outcome), `apps/api/src/services/timeline.ts` (`comment` ~189-262)
- `01-architecture.md` §4.3 (notification rules), `docs/build-guide/prompts/B-18-notifications.md`

## 1. F-079: notify the next owner and the KAM on every hand-off or return
**Acceptance:** "When a gate decision or return is saved, the next owner and the KAM receive an in-app notification and an email with a link."
- **Replace the logging hook with delivery.**
  - After a gate decision commits, resolve the outcome's declared `notify` targets plus two standard recipients:
    - **the next owner:** the assigned engineer or pricer if the target stage keeps an assignee, otherwise the role that works or decides the target stage (EngLead for ENG_REVIEW arrival, PricingLead for QUOTING, Approver for FINAL_REVIEW, the KAM for INTAKE, CUSTOMER_DECISION and COMMIT_HANDOFF)
    - **the quote's KAM**
  - Resolve recipients in the domain (`packages/domain/src/notifications/recipients.ts`, pure, unit-tested) from the gate, outcome, target stage and quote. The API only loads users.
- **Avoid duplicates.** The existing helpers (`onReturnedToKam`, `onEngQueueArrival`, `onPricingArrival`, `onFinalReviewArrival`, `onFinalReviewDecided`, `submitToLead`, `quote.pricing_assigned`) already notify some of these people. Either fold them into the new resolver or have the resolver skip recipients a helper already covers. **One person gets one notification per event**, even if they hold several roles. Write a test for that.
- **Cover these events.** Add catalogue types only where none fits; reuse `quote.reworked`, `quote.ready_for_*` and so on.
  - Advances at G1–G3: ready for the next stage.
  - Every rework or return: G1, G2, **G3 → KAM** (FB-01), G3 → Engineering, G4 return, G5/G6 re-quote. Wording says **"returned to you"**, with the reason and note. A G3 rework arriving in Engineering says "returned from Pricing", not "new".
  - **KAM resubmission** after a G3 rework that resumes at Quoting: notify the assigned pricer and the PricingLead ("back from the KAM, no scope change").
  - **Holds:** the hold owner and the KAM, with the review date.
  - **Closures** (Stop, Redirect, Decline, Lost, Expired, Not authorized, Won): the KAM (the `quote.closed` declared today is not delivered).
  - Lead review: keep `submitted_to_lead` and `returned_by_lead`, and add the KAM as an **in-app only** recipient of "submitted to lead" so they can see progress.
- **Email:** immediate for returns and ready-for-you, digest for closures if the catalogue has a digest mode. The subject carries the quote number and the action. The body links to the quote, and never includes note text or commercial figures (follow the existing comment rule). Respect `email.<type>` preferences and `email_notifications_enabled`.
- Never notify the actor about their own action, except where the existing `notifyActorViaRole` rule applies.

## 2. F-034: notify on comments
**Acceptance:** "Comment or request on a quote triggers in-app notification and email with link."
- When a comment is posted, notify:
  - the quote's **KAM**
  - the **current assignee** (engineer or pricer, if any)
  - the **current stage's lead** (EngLead in ENG_REVIEW, PricingLead in QUOTING)
  - **everyone who has commented before**
  
  Don't notify the author. Keep `comment.mention` for @mentions: a mentioned user gets the mention, not both.
- New type `comment.posted` (in-app and immediate email, user-mutable). The email never contains the comment text; it has a link and "N new comments on CCQ-…". If the existing outbox supports it, collapse several comments within 10 minutes into one email.

## 3. Tests
- Unit: the recipient resolver for each gate × outcome × target, dedupe across roles, actor exclusion.
- Integration:
  - T-010: a KAM comments while the quote is in Engineering → the assigned engineer gets in-app and email.
  - T-037: an engineer submits → the lead decides G2 Advance → the PricingLead and the KAM are notified. A pricer submits → the lead sends it back → the pricer and the KAM are notified.
  - The G3 → KAM → resubmit loop notifies the pricer.
  - Re-check F-003 (T-014).
- Playwright: a KAM sees "Returned to you" in the notification bell after a G3 rework.

## Acceptance (this step's boxes in `03-build-steps.md`)
- [ ] declared `notify` targets are delivered; every hand-off, return, hold and closure reaches the next owner and the KAM exactly once
- [ ] comments notify the KAM, assignee, stage lead and earlier commenters; mentions unchanged; no comment text in email
- [ ] `01-architecture.md` §4.3 updated with the new rules and types
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
