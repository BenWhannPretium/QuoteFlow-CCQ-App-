# 04: Needs Ben

Pre-release audit, 2026-11-17. These are the things the audit found and did not, or should not, settle: judgment calls, open business decisions it ran into, things that need Azure, Entra or GitHub access to verify, and risks it could not close. Each has a recommendation. Nothing here was changed in code unless the item says so.

Ranked by how much it matters in the first week.

## Before go-live

### N-01. Prod alerts notify nobody, and the app's logs are not kept anywhere queryable

- `infra/main.prod.bicepparam` has `alertEmails = []`, so the eight alert rules (seven metric alerts and the availability alert on the health test) fire into the portal only.
- The API has no Application Insights SDK. `APPLICATIONINSIGHTS_CONNECTION_STRING` is set and nothing reads it. The logs are JSON on stdout, kept in the App Service file system (35 MB, 7 days).
- Until this audit every log line read `"err":{}`, `"req":{}`, `"res":{}` (fixed, A-02), so even those files could not explain a 500.

**Recommend:** set `alertEmails` to a monitored mailbox and send a test alert. Turn on the new diagnostic setting (`sendAppLogsToLogAnalytics = true`, written in this audit, not applied) on test first, run what-if, check `AppServiceConsoleLogs` fills, then prod. The queries in `06-first-week.md` need it.

### N-02. Test and prod honour the same Entra roles today

Both parameter files set `entraRolePrefix = 'CCQ.'`, and both environments use the same app registration. The plan (runbook A8a) is `CCQ.Test.` for test, but test is still on `CCQ.` until those roles and groups exist. So every `CCQ.*` role granted to a UAT tester, including `CCQ.Admin` and `CCQ.Approver`, is honoured in prod.

**Recommend:** list the app-role assignments before go-live and remove the ones that were for testing only; then move test to `CCQ.Test.`. Not verifiable from the repo (it needs the tenant). The prod parameter file's comment claimed the separation already held; it now says it does not.

### N-03. Rollback is slow, and one migration cannot be rolled back across

- Prod runs on B1 with one instance and no staging slot. A deploy restarts the app in place and migrates before it listens.
- No build is kept. Rolling back means reverting on `main`, waiting for CI (13 to 20 minutes) and dispatching the deploy again, or deploying an older `v*` tag.
- The previous app version does not run against the schema after migration `0047` (FB-19, multi-item): engineering and capacity saves fail, drafts look empty, and the one-active-quote-per-opportunity index is gone. `0043` to `0046` and `0048` are safe to roll the app back across.

**Recommend:** treat the first build containing `0047` as the rollback floor (fix forward, or restore the database with the old build). Keep each deploy's zip as a run artifact so "redeploy the previous build" takes minutes. Adopt the expand/contract checklist in `05-release-runbook.md` for every migration from here on.

### N-04. If the demo or a pilot session runs from a Windows laptop, small spreadsheets will not be read

See `00-baseline.md`, failure 2. On Windows, the payback and costing summaries of small workbooks read "unavailable" and a small pricing-history import is refused, every time. Linux (the Azure sites) is unaffected. **Run this afternoon's demo against the Azure test site, not a local build.**

Two ways to remove the race for good, neither done here because both change a dependency's behavior the day before release:

1. `pnpm patch exceljs` so `lib/utils/iterate-stream.js` drains the stream's buffered entries when `end` arrives.
2. Stop streaming for the summary reader (the bytes are already in memory, capped by `model_summary_limits.maxBytes`) and use ExcelJS's non-streaming `xlsx.load`, keeping the streaming reader only for the large pricing export, which is not affected.

### N-05. Sessions older than 24 hours: one fix made, one decision left

A tab left open overnight could not recover: MSAL's fallback is a hidden iframe, the app's CSP forbids being framed (`frame-ancestors 'none'`), and the resulting error was rethrown instead of sending the user to sign in. The audit now treats that error as "sign in again" (A-15). **This was read from MSAL's source, not observed: it needs a real tenant and a day-old session to confirm.** Ask a tester to leave a tab open overnight on test and press Save in the morning.

Decision left to you: whether to allow the silent renewal instead (`frame-ancestors 'self'`, `frame-src 'self' https://login.microsoftonline.com`, and a redirect page MSAL can load in the iframe). It would spare users the redirect; it loosens a header. I did not change it.

## Decisions the audit ran into

### N-06. The priority score counts days from the UTC day; intake judges the same date in US Central

`packages/domain/src/scoring/inputs.ts`, `daysUntil`, documented as "UTC calendar day". A quote needed by 2026-12-17 scores as 29 days out after 6 PM Central and 30 days out before it, which crosses the seeded 30-day band: the score, and possibly the tier, change at 6 PM with no input changing. **Recommend** switching it to the Central day, as every other business date uses. Not changed: it moves scores, and the scoring model is under calibration (D-004).

### N-07. "Hold" is offered on a quote that is already on hold, then refused

`availableActions` lists Hold for an on-hold quote; the server answers 409 "already on hold. Resume it before putting it on hold again", and nothing in the app resumes a hold except another decision. Proposed as UX-004 in `03-ux-proposals.md`.

### N-08. The hand-off record of a Closed – Won quote can still be edited back to incomplete

`planHandoff` allows edits in `AWARDED`. `PUT /quotes/:qn/handoff` with `complete: false` or `cerStatus: 'not_approved'` leaves a closed-won quote that contradicts the rule G6 enforced. The architecture says the record "stays readable", which reads as not editable. **Recommend** refusing, on `AWARDED`, any edit that un-completes the hand-off or moves the CER status off approved / not required. Not changed: the intent is yours to state.

### N-09. Narrowing a "sees everything" role by region is honoured in lists but not on the quote itself

The domain policy narrows any role by a `region` or `account_list` scope. The row-level-security function `app_sees_all_quotes()` ignores scope for Admin, Leadership, EngLead, Pricing, PricingLead, Finance, Approver and SalesLeader. So if an Admin gives a sales leader the scope "West", that user's lists hide East quotes, but opening an East quote by its number returns it in full. Nobody has such a scope in the seeds, and no test uses one. **Decide:** either these roles are never narrowed (then refuse a non-`all` scope for them in Admin, a small change), or they are (then the quote-read service needs the domain check on every per-quote route, as attachments and the offer letter already have).

### N-10. `PostAward` can read every customer's pricing history

`quote.read.commercialFields` is granted to PostAward unqualified, and the `pricing_history_record` policy admits it, so `GET /pricing/history` returns all legacy pricing to a role meant to see Awarded quotes only. PostAward is P2 and has no members yet. Rule 2 (no role hidden from data it can enter) does not require this: PostAward enters nothing there. **Decide** before anyone is added to the group.

### N-11. Two stay-in-stage outcomes can be recorded twice by two people

G2 "send back to Engineering (another platform)", G3 re-cost, G3 "another capital model" and G5 "in negotiation" keep the quote in its stage. Two leads, or one person in two tabs, can each record the same outcome; the second is not refused, so there are two decisions, two timeline entries and two notices. The dialog blocks a double click. **Recommend** refusing a second identical decision within a short window, or sending the last decision's id with the request. Not changed: it alters the gate API.

## Engineering follow-ups the audit left open

### N-12. Section saves do not take the quote lock (lost updates, saves that land after a gate)

Gate decisions lock the quote row first. The engineering, pricing, commercial-terms and hand-off saves check "is this section editable?" and then write, without that lock. In a narrow window:

- an engineer's save can land just after the lead's G2 decision, changing a section that is now locked and no longer matches the decision's evidence;
- an engineer's save and a scheduler's capacity sign-off that overlap can erase one another (both rewrite the whole row), while the audit trail shows both;
- the two orders of locking can deadlock, which was a 500 and is now a 409 "try again" (A-08).

The fix is one line per loader (`getQuoteForUpdate` first, as `lead-review.ts` does). I did not make it today: it touches every write path in three services and needs parallel tests for each. **Recommend** as the first change after the demo.

### N-13. Database transactions held across file-store calls

The offer letter renders and uploads while holding the quote's row lock; an attachment download fetches its link, and a removal deletes the file, inside a transaction. A slow or throttled SharePoint or Blob call pins a pooled connection, and for the offer letter blocks every other write to that quote. The audit bounded each Graph request (A-20); it did not restructure the transactions. Also: a file-store failure during offer-letter generation is a bare 500 (the upload path answers 503 "try again" for the same error).

### N-14. The runtime database login is the server admin and table owner

One `DATABASE_URL` serves both the migrations and the app. Row-level security holds because every request runs `SET LOCAL ROLE ccq_app`; a future query written outside that wrapper would see every row, and the same login could disable the audit triggers. **Recommend** a separate login that can only become `ccq_app` for the server, keeping the admin URL for start-up migrations.

### N-15. Smaller items

- **Start-up rewrites.** Every boot drops and recreates the analytics views (`drop … cascade`: it also drops anything D&A builds on them) and rewrites every untouched provisional config row (churn into the Fabric mirror). Harmless on one instance; worth a hash check before scaling out.
- **Salesforce brown-out.** The interactive paths (intake's opportunity check, opportunity detail) use the sync's retry policy: four tries of 20 seconds. A request can hang for over a minute before falling back to the snapshot.
- **Live Salesforce lookups before the visibility check.** Any role that can read quotes can make `GET /salesforce/opportunities/:id` call Salesforce twice per request, for ids it will then be told do not exist. It spends API quota.
- **Salesforce sync.** One record Postgres refuses drops its whole page on every run; the run ends `partial`, which never alerts.
- **When email is switched on.** A 401/403 from Graph uses up a message's three tries and fails it for good; rows queued since launch will be worked through at 50 a minute before new mail. Clear the backlog and soften the 403 handling before enabling dispatch.
- **Staging slot.** When the plan moves to P1v3 with a slot, the slot gets the same settings and will run all four background jobs against prod. Give the slot sticky settings that zero the job intervals.
- **The entry bundle carries the charts.** `apps/web/vite.config.ts` puts every third-party module that has no named chunk into `vendor` (638 KB), so Recharts, dnd-kit and react-table load on every page, not only on Analytics and the board. Giving Recharts its own chunk is a small build change; not made the day before release.
- **Nothing compresses responses.** The API registers no compression plugin, and the production-mode boot served a script uncompressed. Unless the App Service front end compresses (not verified), the 2.1 MB of JavaScript and every JSON response go out as they are. `@fastify/compress` is a small addition; not made the day before release.
- **A draft stored with a value the tightened schema refuses will not load.** The intake request schema now refuses impossible dates and absurd figures, and the same schema is used to send a draft back. Run the query in `05-release-runbook.md` (pre-flight 10a) before the first deploy of this branch.
- **Source maps are public.** `apps/web` builds with `sourcemap: true` and the API serves the `.map` files without sign-in (9 MB). They expose the SPA's source, not secrets.
- **Audit gaps against rule 3.** Reading the offer letter's prices (`GET …/offer-letter`) and the pricing-history routes write no audit row.
- **Geo-redundant backup is off** and can only be chosen when the server is created.
- **Actions are pinned to major tags** (`@v7`), not commit hashes, in jobs that hold `id-token: write`. A tag ruleset limiting who can create `v*` tags would also close the path where a tag on an unmerged commit reaches the approval prompt.
- **Dependencies (moderate advisories that run in production):** `nodemailer` below 10.1.4 (three), `fast-uri` through Fastify's schema compiler, `glob` through `@fastify/static`, `uuid` through ExcelJS. None is high; bump after the demo.
- **Model-summary reader** leaves a file handle and a temp file per skipped worksheet until the process restarts.
- **Intake submit** trusts the editable `intake_required_fields` setting for the Salesforce link (rule 6 is locked); an Admin who emptied it would turn a missing link into a 500.

## Not verified: needs a real environment

| What | Why it matters |
|---|---|
| Whether the App Service front end appends `address:port` to `X-Forwarded-For` | The code is now right either way (A-06); one production log line settles it |
| The 24-hour session path (N-05) | Read from MSAL's source only |
| The new diagnostic setting and the start-up time limit | Built and linted; never run through what-if |
| CSP in a signed-in production session | The smoke test covers signed-out pages only. `blob:` was added to `img-src` for the "Report an issue" screenshot preview; it has not been seen working in a production session |
| Bicep what-if, Key Vault reference resolution, the federated credential, GitHub environment variables | No subscription access by design |
| The Fabric T-SQL twins of the analytics views | Untested until a mirror exists; the guard test compares names only |
