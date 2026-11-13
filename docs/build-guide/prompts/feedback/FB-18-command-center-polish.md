# FB-18 · Command Center and screen polish: one home with analytics, on-hold at a glance, "Progress saved" beside the button, Salesforce links

**Run with:** Claude Code · a standard model · **high** effort · **Wave 2: start when FB-15 and FB-16 have merged** (it touches their Save buttons) · in parallel with FB-17, **merging after it** · one draft PR · branch `claude/fb-18-command-center`
**Walkthrough items:** W13-29, W13-30, W13-31, and the Command Center half of W13-26 (`docs/build-guide/feedback/inputs/walkthrough-2026-11-13.md`). FB-17 builds the timeline half of W13-26. **Tracker rows it follows:** F-076 (Salesforce link)

**Paste into Claude Code from the repo root.**

---

## Stop check
Confirm FB-15 and FB-16 have merged into `main`. If not, stop and say so. Don't edit `GateDecisionDialog.tsx`, `hybrid.ts` or the timeline: FB-17 owns them. FB-17 also edits `EngineeringTab.tsx`, `EngineeringExtras.tsx`, `QuotingTab.tsx`, `final-review/FinalReviewQueue.tsx`, `routes/queue/pricing.tsx` and `routes/queue/engineering.tsx` (button text, the BOM text, capital checks, filter labels) and merges first: in those files add only your Save status and links, then rebase on FB-17 before opening the PR for review.

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
- **Migrations.** The last migration on 2026-11-13 was `0043_funding_help_text.sql`. Use the next free number when you start (`ls packages/db/migrations`). Before you open the PR, `git fetch origin main`. If a new migration has landed, rebase and renumber yours: the file name, `meta/NNNN_snapshot.json`, and `idx`/`tag` in `meta/_journal.json`. Then re-run the integration tests. FB-17 and FB-18 run in parallel; FB-17 adds a migration and merges first.
- **Synthetic data only (rule 8).** No real customer, opportunity or person data in code, seeds, fixtures, screenshots or the PR. People's names that are already in the build guide may be used in docs.
- **Tests come with the feature.** Domain rules → Vitest unit tests. Routes → permission-matrix and integration tests on a real Postgres. UI → at least one Playwright happy path for each changed stage; check the changed screens at 1366 × 768 and at 390 px wide, in light and dark themes.
- **Before you open the PR, run `pnpm verify`** (lint, typecheck, unit, integration, build) with `docker compose up -d db`. If the session can't run Docker, use a local Postgres 16, or say so in the PR and let CI run the integration tests. Fix every failure. **Never skip, delete or weaken a test to get green.**
- **Git.** Conventional Commits (`feat(intake): …`), small logical commits, a **draft** PR that fills the repo's PR template. Do not put any AI model name in commits, code comments or the PR.
- **When something is genuinely missing** (a list, a name, a field from Salesforce), do not invent it. Build the mechanism, leave the value provisional, empty or switched off, list it in the PR under "Waiting on", and build the rest.

## What the code does today (read 2026-11-13; verify before relying on it)
- **Home.** `apps/web/src/routes/index.tsx` renders `LandingPage` (`?as=` picks the role). The eyebrow reads `Home · ${roleLabel}`; titles per role come from `landing/landings.ts` (~36-139, precedence ~145-157). Role dashboards: `landing/Dashboards.tsx`, contracts `packages/contracts/src/dashboards.ts`.
- **Analytics** is a separate route (`routes/analytics.tsx`, permission `analytics.read`: SalesLeader, EngLead, Pricing, PricingLead, Approver, Leadership, Admin; **not** KAM, Engineer, Finance or PostAward, `policy/matrix.ts` ~178-186). `AnalyticsPage.tsx` has lenses "Leadership report" and "Engineering" (`defaultLens` ~1291-1297); its search params are handled by `lib/analytics-search.ts` and saved views by `lib/saved-views.ts`.
- **Nav** (`apps/web/src/shell/nav.ts` ~57-96): 'Home'/'Home', …, 'Analytics'/'Analytics', ….
- **On hold on the KAM's home:** "My open quotes by stage" (`Dashboards.tsx` ~336-352) uses `StageBoard` (~214-251): quote number and days only. On-hold quotes are included (`repos/dashboards.ts` ~171-173) and `DashQuote.status` exists, but nothing shows it.
- **Save feedback.** Toasts appear bottom-right (`components/Toaster.tsx`, `lib/toast.ts`). Commit `48f5506` added an inline `<span role="status" data-testid="saved-note">Saved</span>` beside the "Save process and pack-out" button (`EngineeringExtras.tsx`, `justSaved` state) and greys the Quoting capital card's button when nothing changed. Intake shows "Draft saved HH:MM" (`routes/intake/new.tsx` ~205-214). Other Save buttons rely on the toast.
- **Salesforce link.** `SalesforceLink` (`components/outcome/CustomerDecision.tsx` ~592-620) shows "Open in Salesforce ↗", or the plain ID when `sfOpportunityUrl` is null. The URL is built from `app_setting.salesforce_instance_url` (`packages/domain/src/outcome/sf-stage.ts` ~123-129), **seeded empty**, so every environment shows only the ID until an Admin sets it. The link sits in the quote header (`$quoteNumber.tsx` ~131) and the G5 reminder. The IntakeCard (`$quoteNumber.tsx` ~342+) and the G1 queue card (`approvals.tsx` ~266-340) show the ID as text. There is no ERP customer number anywhere.

## Build

### A. Command Center (W13-29)
1. Rename **Home → "Command Center"** in the nav (short label "Command"), the page eyebrow (`Command Center · <role>`), the document title, the help and quick-starts.
2. Merge analytics into it. The Command Center has two views (tabs or a segmented control, keyboard-accessible, remembered per user in `localStorage` with try/catch): **"My work"** (today's landing for the role) and **"Analytics"** (the role's analytics lens, the same component and filters as today). The Analytics view is shown only to users with `analytics.read`; the server still enforces the permission on every analytics route. **Do not grant `analytics.read` to more roles** (that would be a new business decision).
3. Remove the Analytics nav item. `/analytics` (with any search params, including saved views) redirects to the Command Center's Analytics view, so bookmarks and links in emails and docs keep working. Update in-app links that pointed at `/analytics`.
4. On a phone (390 px) the two views stack and nothing scrolls sideways.

### B. On hold at a glance (W13-26, Command Center half)
- In `StageBoard` and every Command Center list of quotes, an on-hold quote shows an **orange "On hold" chip** with the owner and review date on hover and focus ("On hold until 12 Dec · owner Jane Doe"), and is listed first within its stage. Use the same chip in the KAM's "Returned to me" if an on-hold quote can appear there. Add the fields the dashboard contract needs (owner name, review date) through the existing dashboard repo; respect RLS.

### C. "Progress saved" beside the button (W13-30)
- Turn the `48f5506` pattern into one shared component (e.g. `SaveStatus` in `components/forms.tsx`): "Saving…", then **"Progress saved"** (the words Ben and Bailey asked for; role `status`) beside the button until the form changes, or "Not saved: <reason>" (role `alert`) on failure. Use it on **every explicit Save button**: Engineering (solution, two-step and pack-out, capacity rows), Quoting (capital card and any other save), the commercial panel, Final Review's terms, Admin settings and lists. Keep the toast too. Reuse FB-15's required-marker component wherever these forms mark required fields.

### D. Salesforce links everywhere the ID shows (W13-31)
- Use `SalesforceLink` wherever the opportunity ID is shown: the IntakeCard's opportunity row, the G1 queue card, the Engineering and Pricing queue rows, Final Review. It opens in a new tab with `rel="noopener noreferrer"`; Lightning URLs also open in the Salesforce mobile app.
- When `salesforce_instance_url` is empty, show the ID and, **to Admins only**, a small "Set the Salesforce URL in Admin → Settings" link. Put the Pretium Lightning URL in the PR description as an action for Ben (an Admin sets it in each environment; it is not a secret and not code).
- The ERP customer number is **not** built: there is no source yet (W13-W1). Leave a one-line note in the PR.

## Done when
- [ ] "Command Center" with "My work" and "Analytics"; no Analytics nav item; `/analytics` redirects with its params; permissions unchanged and enforced on the server
- [ ] orange "On hold" chip with owner and review date on the Command Center lists
- [ ] `SaveStatus` ("Progress saved") beside every explicit Save button, toast kept
- [ ] the Salesforce link wherever the ID shows; Admin hint when the URL is unset
- [ ] tests: component tests for `SaveStatus` and the chip, the redirect, permission tests for any changed route, Playwright (KAM sees an on-hold chip; SalesLeader opens Analytics from the Command Center; a Save shows "Progress saved" beside the button); checked at 1366 × 768 and 390 px in both themes
- [ ] `pnpm verify` passes; close-out done

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
