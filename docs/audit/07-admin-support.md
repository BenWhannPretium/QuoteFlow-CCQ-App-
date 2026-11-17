# 07: Admin and support guide

How a QuoteFlow Admin (role `CCQ.Admin`) does the eight jobs that come up in support: add a user, set a data scope, change configuration, read the audit trail, unstick a quote, import pricing history, fix a Salesforce sync, and triage a user report. It is for Admins and the first-response person. Written 2026-11-17 during the pre-release audit, from the routes and services on branch `claude/audit-prerelease` (`apps/api/src/routes/v1/admin*.ts`, `apps/api/src/services/adminConfig.ts`, `apps/api/src/auth/directory.ts`). Entra and Azure steps are not verified from the repo.

The Admin console is `/admin`. Leadership can open the read-only pages; only Admin can save.

## 1. Add a user and give them a role

Roles are **not** set in QuoteFlow. They come from Entra.

1. Add the person as a **direct** member of the group `SG-CCQ-<Role>` (for example `SG-CCQ-KAM`). Nested groups do not carry the role. IT does this, or the owner of the QuoteFlow-API enterprise application.
2. The person signs out and in. A role reaches the app only in a new sign-in token.

What the app does on the first request with that token (`apps/api/src/auth/directory.ts`):

- Creates or updates the `app_user` row from the token: Entra object id, sign-in name, display name, email, last seen.
- Makes `user_role` match the token's roles exactly. The token is the source of truth; a role removed in Entra disappears here on the next token.
- Loads the person's data scope. With none set, they get the default from the setting `default_scope_type` (`all` unless it is set to `owner`).
- Writes one `sign_in` audit row per person per 8 hours.

Things to know:

- A person appears in **Admin → Users and scope** only after their first sign-in.
- No `CCQ.*` role in the token means a 403 "no CCQ role" page. Check the group membership and that the group is assigned to the app role.
- **Test and prod honour the same roles today** (`ENTRA_ROLE_PREFIX` is `CCQ.` in both). Adding someone to a group for testing gives them that role in production.
- Removing someone: take them out of the group. Their current token keeps working until it expires. QuoteFlow has no screen to deactivate a user; `app_user.active` exists but no route sets it.
- `CCQ.ProductionScheduler` was not yet created in Entra when `06-azure-entra-setup.md` (A4c) was last updated.

## 2. Set a data scope

**Admin → Users and scope** (`/admin/users`) → the person → scope. Types: `all`, `owner` (their own quotes), `region` (list the regions), `account_list` (list the Salesforce account ids). `region` and `account_list` need at least one value; the other two take none. A change reason of at least 5 characters is required. The change is audited and applies on the person's next request.

**Only narrow a KAM, an Engineer or a Production Scheduler.** For Admin, Leadership, SalesLeader, EngLead, Pricing, PricingLead, Finance and Approver the database rule ignores the scope: a `region` scope hides quotes from their lists, but the quote still opens by its number (`04-needs-ben.md` N-09). Do not rely on a scope to restrict those roles.

## 3. Change configuration safely

Where: **Value lists**, **Reason codes**, **Workflow labels and rules** (stage, gate and outcome labels, help text, required-field rules), **App settings**, **Scoring model**.

Every save:

- names the version of the row you loaded. If someone changed it meanwhile you get 409 `stale_version`: reload and redo the edit.
- needs a change reason (5 to 2000 characters). It becomes the entry in **Admin → Decision log**. Write it for the person who reads it in a year.
- is validated on the server. A bad value is refused with 422 `invalid_config` and a list of what is wrong.
- is written to `audit_event` (`config_change`, with before and after) in the same transaction.
- takes effect at once. A new scoring version re-scores open quotes in the background.

Extra confirmations: deactivating a value that open quotes use (`value_in_use`), and turning `g1_enabled` off while quotes wait at G1 (`confirmation_required`).

Rules of thumb:

- Change one thing, then open the screen it affects and check it.
- A seeded value marked provisional stays provisional until its owner approves it. Approving is a separate, deliberate tick.
- **Do not empty `intake_required_fields`** or remove the Salesforce opportunity from it. Intake then fails with a server error instead of a clear message (`04-needs-ben.md` N-15).
- **Check field names in a gate's required-field rules twice.** The rule language is validated, but the audit found that a field name that does not exist is accepted, and it then blocks that gate for everyone.
- `g1_enabled` also switches the G1 and SUBMIT gates. Treat it as a process change, not a setting.
- `email_notifications_enabled = false` stops new email rows and drops queued ones. In-app notices continue.
- You cannot change here: who may decide a gate (that is code, `packages/domain/src/policy/matrix.ts`, and a deploy), the list of stages (a migration), or a person's roles (Entra).

Three settings accepted any JSON until this audit (commit `de764ba`): `intake_other_description_max_length`, `customer_master_data_notice` and `capacity_basis`. A zero, negative or fractional `intake_other_description_max_length` broke every intake screen and the engineering queue for all users. They are now validated like the rest. If an environment is running a build older than that commit, do not touch these three.

## 4. Read the audit trail

| Question | Where |
|---|---|
| Who looked at or changed this quote? | **Admin → Audit log** (`/admin/audit`): filter by quote number (`CCQ-YYYY-NNNNN`), user, action and dates. Dates are US Central days. |
| What did a decision change? | The same row: before and after, the acting user's roles at the time, address, and request id |
| Who changed a setting, and why? | **Admin → Decision log** (`/admin/decision-log`) |
| Who overrode a priority or ship-to? | **Admin → Override log** (`/admin/override-log`) |
| Who is using the app? | **Admin → Usage report** (`/admin/reports/usage`): last 30 days by default |
| I need it in Excel | **Export CSV** on the audit page or the decision log. Capped at 10,000 rows; the export is itself audited. |

The request id on an audit row is the `traceId` a user sees in an error message and the `reqId` in the server log. Give it to whoever reads the logs.

Limits: quote views are recorded best-effort and debounced, so not every page load is a row. Reading the offer letter and the pricing-history pages writes no audit row today (`04-needs-ben.md` N-15). Audit rows can never be edited or deleted, by anyone.

## 5. A stuck quote

First find out why. Open the quote: the timeline shows the last decision, and the decision dialog lists what a gate still requires. Then **Admin → Audit log** for that quote number.

| Cause | What an Admin can do in the app |
|---|---|
| Nobody is assigned, or the assignee is away | Reassign the engineer or scheduler (engineering queue) or the pricer (pricing queue) |
| A gate demands a field that cannot be filled | Fix the gate's required-field rule (**Admin → Workflow labels and rules**) with a reason |
| The reason code or list value needed is switched off | Re-activate it (**Reason codes**, **Value lists**) |
| An override is waiting | Approve, reject or revert it (override inbox). A revert is refused on a closed quote. |
| A wrong or duplicate file blocks a step | Remove any attachment (Admin only). The file moves to the removed folder; nothing is hard-deleted. |
| The hand-off record needs correcting | Edit it (Admin holds `handoff.edit`) |
| The decider is unavailable | Raise an escalation on the quote, and ask a second holder of that role |

What an Admin **cannot** do, by design:

- Decide a gate. G1 is the Sales Leader's, G2 the Engineering Lead's, G3 the Pricing Lead's, G4 the Approver's, G5 and G6 the KAM's (own quotes) or a Sales Leader's. If you also hold one of those roles you decide as that role, and the segregation rules still apply to you.
- Move a quote to another stage directly, end a hold (only the gate's next decision does), reopen a closed quote, delete a quote, or edit engineering or pricing content.

**SQL is the last resort, and it has a cost.** A direct update leaves no `audit_event` row (rule 3), no timeline entry and no notification, and it bypasses the stage engine: `stage_history`, `quote_hold`, `gate_decision` and the closure columns must agree with each other or screens and analytics go wrong. If it is truly unavoidable: two people, one transaction, a hand-written `audit_event` row (insert only; `action = 'update'`, `entity = 'quote'`, `before`, `after`, `change_reason`), a comment on the quote saying what was done and why, and a note to the sponsor. Never update or delete audit rows; the database refuses it. Prefer a code fix and a deploy.

## 6. Import pricing history

There is no live link to the old pricing application. An Admin uploads its export.

1. **Admin → Integrations** (`/admin/integrations`) → Pricing history. Choose the `.xlsx` with the sheets "ERF Export", "BPR Export" and "SPR Export".
2. **Check file.** Nothing is written. Read the report per sheet: rows, valid, skipped, missing columns, new against existing, fiscal-year range, duplicate request numbers. Stop if a sheet has missing columns or far fewer valid rows than you expect.
3. **Import.** Rows are added or updated by kind and request id, in one transaction; nothing is deleted. Re-importing the same file changes nothing. It records one `integration_run` (source `pricing`) and one audit row.

A file that is not the export is refused with 422. A failed import rolls back and shows as a failed run on the same page. Do not import during a deploy. Never put the file in the repo or attach it to a ticket: it is commercial data. How long the full file (about 47,000 records) takes on the prod plan is not verified.

## 7. A Salesforce sync problem

Symptoms: an in-app "Salesforce sync failed" notice (Admins only), `salesforce` not `ok` on **Admin → Integrations**, or KAMs seeing "showing the last synced copy". Quotes and intake keep working from the stored copy meanwhile.

1. **Admin → Integrations.** Read the connector row: mode (must be `live` in prod), last run, last success, failures in 24 hours, last error code. `degraded` means a partial run or a failure in the last day; `down` means the last run failed.
2. Read the recent runs below it (table `integration_run`). `partial` means some records could not be saved; the count is in the run. A row stuck on `running` after a restart is stale, not live.
3. Press **Sync Salesforce now.** It answers with the result, or "running" if it takes more than 25 seconds; then refresh the page. `skipped` means a run was already in progress.
4. Still failing: the usual causes are the consumer secret (rotated or expired in Salesforce, or the Key Vault reference on `SF_CLIENT_SECRET` not resolved), the External Client App or its integration user disabled, or Salesforce's API limit. The first is ours (update the Key Vault secret `sf-client-secret`, restart the app); the others go to the Salesforce admin.
5. **Full re-sync** re-reads and rewrites every opportunity. Use it only after a field-mapping change. It takes about a minute for roughly 32,000 records and skips the deleted-record check.

## 8. Triage a "Report an issue" ticket

Users raise reports from the user menu or the page footer. Each one records the page, the quote number in view, the build (commit), the browser and an optional screenshot.

1. **Admin → Feedback** (`/admin/feedback`). Newest first.
2. Open the report. The screenshot can show commercial figures and is visible to Admins only: do not forward it.
3. Set the **severity** (1 blocks a core flow, 2 wrong data or permission, 3 usability, 4 cosmetic), the **status** (`new` → `triaged` → `fixing` → `fixed`, or `wont_fix`), an **owner**, a **GitHub issue link** (github.com only) and a **triage note**. Each change is audited.
4. To investigate, use the report's time, page and quote number in **Admin → Audit log**, and the build to know which code the user was on. If the user quoted a `traceId`, search the server log for that `reqId` (`06-first-week.md` 2.3).
5. Severity 1 or 2: tell the first-response person the same day.

`pnpm uat:defects` renders every report into `docs/uat/defect-log.md` for the daily review. It reads the database named by `DATABASE_URL`, so against prod it needs a database session (`05-release-runbook.md` section 5). The file is git-ignored because report text can name customers: share it on SharePoint, never commit it.
