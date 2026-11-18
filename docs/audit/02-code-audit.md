# 02: Code audit (Part B)

Pre-release audit, 2026-11-17. Findings by severity, each with where it is, what was wrong, how it would fail in production, the fix and the test that proves it. Then the behavior changes, the efficiency results, and what was deliberately left alone.

Method: eight read-only reviews fanned out by area (infrastructure, database, workflow services, intake and files, routes, domain, jobs and integrations, web). No finding was acted on from a review alone: each one below was read in the code and, where it could be, reproduced first. A fix was made only when the old behavior was plainly wrong; judgment calls are in `04-needs-ben.md` or `03-ux-proposals.md`.

"Reproduced" means a test or probe failed on the unmodified code. The commit is the one on `claude/audit-prerelease`.

## Critical

### A-01. Ten simultaneous intake requests froze the whole API

- **Where:** `apps/api/src/services/intake.ts` (`openQuotes`, called from `toDto` on every draft read and autosave, and from submit); `packages/db/src/client.ts`.
- **What was wrong:** the "other active quotes on this opportunity" read (FB-19) runs in the system context, on a second connection taken from the request pool while the request's own transaction still held one. With as many draft requests in flight as the pool has connections (10), each held one and waited for another.
- **In production:** nothing finishes and nothing times out. `GET /health` queues behind them, so the probe hangs too. The instance stays frozen until it is restarted. A room of people in the intake wizard, each autosaving, is the trigger.
- **Reproduced:** `apps/api/test/pool-nesting.int.test.ts` fires 24 draft reads at once; on the old code every one timed out.
- **Fix:** `createDb` also returns `systemDb`, a separate two-connection pool (opened lazily); the nested read runs there. A holder of a system connection runs one short read and waits on nothing, so the pools cannot form a cycle. Commit `d596b6e`.
- **Test:** the same file, now green: 24 reads and 24 autosaves all answer, and `/health` stays reachable.

### A-02. Production error logs were empty

- **Where:** `apps/api/src/logger.ts`.
- **What was wrong:** the log formatter that masks sensitive keys runs before pino's serializers and rebuilt every object from its enumerable keys. An `Error`, a request, a reply and a `Date` have none, so each became `{}`.
- **In production:** every line read `"err":{}`, `"req":{}`, `"res":{}`. A 500 left no message, stack, method or path. The API has no Application Insights SDK, so these lines are its only telemetry.
- **Reproduced:** a probe that runs a real Fastify logger with the app's formatter printed exactly that.
- **Fix:** the formatter rebuilds plain objects only. An explicit `err` serializer keeps type, message, stack, code, table, column and constraint and drops the Postgres fields that can quote row data (`detail`, `where`, `query`, `parameters`). An explicit `req` serializer logs method, path without the query string, and the client address. Commit `5262040`.
- **Test:** `apps/api/src/logger.test.ts` drives a Fastify logger with the production options and reads what it writes.

## High

### A-03. Two instances starting together both ran the migrations

- **Where:** `packages/db/src/migrate.ts`.
- **What was wrong:** the API migrates at start-up. drizzle's migrator reads what is applied before it opens its transaction and takes no lock.
- **In production:** on scale-out, a restart that overlaps a deploy, or a staging slot beside production, one instance fails on duplicate DDL and exits, and a data-only migration can be applied twice.
- **Reproduced:** three concurrent `runMigrations` on an empty database; two of three rejected.
- **Fix:** `runMigrations` holds a session advisory lock across the migrations, the comment refresh and the analytics views. The waiting instance finds nothing pending. Commit `4269182`.
- **Test:** `packages/db/test/migrate-concurrent.int.test.ts`: all three succeed, every migration is recorded once, no lock is left held.

### A-07. Impossible dates and odd filters returned 500, or were stored to fail later

- **Where:** `packages/contracts/src/analytics.ts`, `pipeline.ts`, `intake.ts`.
- **What was wrong:** dates were checked with a `YYYY-MM-DD` pattern only; the analytics `kam` filter took any string as a user id; the intake figures had no upper bound.
- **In production:** `GET /analytics/pipeline?to=2026-13-45` and `GET /quotes?closeDateFrom=2026-13-45` were 500s; `to=2026-11-31` answered 200 for a window JavaScript had rolled into December; `?kam=abc` was a 500; an intake draft accepted `quoteNeededBy: 2026-11-31` or a revenue of 1e15 and failed at submit.
- **Reproduced:** `apps/api/test/input-hardening.int.test.ts`, 14 of 15 failing on the old code.
- **Fix:** `z.iso.date()` (a real calendar day), uuids for `kam`, and the column bounds on money, measures and volume. Each is a 400 that names the field. Commit `3497333`.

### A-09. A gate decision could pass on a date it never sent

- **Where:** `apps/api/src/services/gateService.ts`; the facts come from `packages/db/src/repos/transitions.ts`.
- **What was wrong:** a gate's rules are judged on the quote's stored facts overlaid with what the decision sends. Two required facts share their names with stored columns that mean something else: `accepted_at` (the engineering review's "engineer accepted the work") and `review_date` (left by the previous hold).
- **In production:** once an engineer had accepted a review, G5 Awarded with no acceptance date passed and opened the hand-off record with no date. A second hold with no review date passed on the first hold's date and skipped the "today or later" check.
- **Reproduced:** two tests in `apps/api/test/outcome.int.test.ts`; both decisions answered 201.
- **Fix:** the gate service removes those two decision-supplied facts from the stored state before the rules run. Commit `2ae3400`. The fix is in the service, not in `evaluateTransition`: 190 domain unit tests supply these facts through the quote's fields as a fixture convention, and the collision exists only where real rows are loaded.
- **Test:** the same two tests, now 422 `MISSING_FIELD`; 188 tests across five gate suites still pass.

### A-12. One Admin setting could take intake and the engineering queue down

- **Where:** `packages/domain/src/config-admin/settings.ts`.
- **What was wrong:** a setting with no spec accepts any JSON. Three seeded keys had none.
- **In production:** saving `0`, `-1` or `2.5` into `intake_other_description_max_length` was accepted and audited; the intake config then failed to parse on every draft, submit and engineering-queue request: a 500 for everyone until the row was corrected by hand.
- **Fix:** specs for that key, `customer_master_data_notice` and `capacity_basis`, each reusing the schema its reader applies. Commit `de764ba`.
- **Test:** `packages/db/seeds/config/settings.specs.test.ts`: every seeded setting has a spec and every seeded value passes it. Before the fix it listed the three keys.

### A-15. The sign-in gate threw the app away on a blip, and could not recover an old session

- **Where:** `apps/web/src/auth/AuthGate.tsx`, `session.ts`.
- **What was wrong:** (1) a failed background refetch of `/me` replaced the whole app with an error page; (2) when MSAL's silent renewal failed with its iframe time-out, the error was rethrown instead of sending the user to sign in; (3) the "No QuoteFlow access yet" page had no way out.
- **In production:** returning to the tab during a deploy restart discards whatever the user had typed. A tab left open past 24 hours shows a raw MSAL message on every save, and "Can't reach QuoteFlow" after a reload, until the tab is closed.
- **Fix:** `meErrorBlocksApp` takes the page only with no identity yet or a 401, 403 or redirect; `needsInteractiveSignIn` treats the two iframe failure codes as "sign in again"; the no-role page offers Sign out. Commit `c0b7735`.
- **Test:** `apps/web/src/auth/auth.test.ts` for both helpers. (2) is read from MSAL's source and **not verified against Entra** (`04-needs-ben.md`, N-05).

## Medium

### A-04. A rescore in flight at shutdown lost its work

`apps/api/src/app.ts`. Fastify runs `onClose` hooks last-registered-first (confirmed with a probe), so the hook that waits for a scoring rescore ran after the hook that closed the database pool. A rescore started just before a restart lost its remaining batches and its audit summary. One hook now does everything in order. Commit `e3effe3`; test in `app.test.ts` (it failed before: `db.close` ran first).

### A-05. The health probe could hang

`packages/db/src/client.ts`. `ping()` ran `select 1` on the request pool with no limit; with every connection busy it waited as long as they did. It now gives up after 3 seconds and reports the database as down. Commit `8aedd3c`; test `packages/db/test/client.int.test.ts`.

### A-06. The per-address rate limits did not do their job

`apps/api/src/app.ts`, `plugins/auth.ts`, `plugins/audit.ts`. Two defects, both invisible to the existing test (it runs with no proxy and no SPA): the SPA's own files counted against one shared `ip:<office NAT>` budget, and the client address was used with whatever source port the front end reported, so each connection had its own budget and audit rows stored `address:port`. The limiter now covers `/api` only and every use of the address goes through `clientIp()`. Commit `5cc6b78`; tests in `spa.test.ts` (both failed before) and `clientIp.test.ts`. Whether the front end sends a port is not verified; the code is right either way.

### A-08. Database collisions were bare 500s

`apps/api/src/plugins/problem-json.ts`, new `services/pg-error.ts`. A unique violation (a double click, two people on one record) is now 409 `conflict`; a deadlock or serialization failure 409 `conflict_retry`; a value that does not fit its column (five named SQLSTATEs: too long, out of range, a bad date, not a uuid or number) 400 `invalid_value`. It is an allow-list: only errors with no status of their own are mapped, the response never quotes the database, and everything else, including NOT NULL, CHECK and foreign-key violations and the rest of class 22, is still a 500 (`231b3af` narrowed the first version, which was too broad). Also fixed: the override service looked for the SQLSTATE on the top-level error, where drizzle never puts it, so its own 409 could not fire. Commit `6772adb`; test `pg-error.test.ts`.

### A-10, A-11. Start-up guards for production

`apps/api/src/config.ts`, new `startup.ts`, `azureStart.ts`. `APP_ENVIRONMENT=prod` now requires `NODE_ENV=production` (every safeguard keys on it and it defaults to development) and refuses `SF_MODE=fake` (the Bicep default; its sync would write the synthetic fixture beside real customers). `SEED_SYNTHETIC_DATA=true` is refused in prod. A failed database preparation now names the table, column and constraint, still without message text. Commits `79c1919`, `86459dc`; allowed and denied cases in `config.test.ts` and `startup.test.ts`.

### A-18. Reverting an override rewrote a closed quote

`packages/domain/src/overrides/lifecycle.ts`. Request and approve both refuse a closed quote; revert did not, so a self-applied priority tier or ship-to could be reverted after the quote closed, rewriting a closed record. Revert now refuses with `QUOTE_CLOSED` and is not offered. Commit `d72f5d8`; tests in `overrides.test.ts`.

### A-20. Microsoft Graph requests had no time-out

`packages/integrations/src/graph/client.ts`. Callers hold a database connection while a Graph call runs; a connection that hung held it. Each request is now aborted after 30 seconds (120 for an upload range) and handled as a network failure. Commit `a34494d`; test `graph/client.test.ts`.

## Low

- **A-13. Request ids repeated.** Fastify's default id is a per-process counter, so the problem `traceId` and `audit_event.request_id` started again from `req-1` after every restart. Now UUIDs. Commit `d80a5cc`.
- **A-14. SPA files.** Hashed files are cached for good and `index.html` is always revalidated (they were all `max-age=0`); a missing build file is a 404, not the page shell; a tab from the previous build is told to reload instead of being offered a retry that cannot work. Commits `0f2877c`, `d4ac5cc`.
- **A-16. Stale screens after a gate decision.** The dialog now also refreshes the timeline, the Command Center, the bell and the override inbox, and says so when the quote cannot be loaded. Commit `36292d7`. No unit test (the web package has no component-test harness).
- **A-17. Two date slips.** Clearing "Approved at" threw `RangeError` (the form now marks the field instead of sending); a new capacity row took its date from the UTC day (tomorrow after 6 PM Central). Commits `ea42618`, `c23682c`.
- **CSP.** `img-src` gains `blob:` for the "Report an issue" screenshot preview, which was blocked in production. Commit `da1817f`.
- **A-19. Infrastructure.** The start-up time limit and the opt-in diagnostic setting. Commit `000d2d7`. Built and linted; not applied.

## Found by the independent re-check, in this audit's own changes

Before the go / no-go, two fresh reviewers were given only the diff and the architecture document and asked what the changes had broken. Each claim was checked in the code before it was acted on. Nine were right; all are fixed on the branch.

| What was wrong with the first fix | Fixed in |
|---|---|
| A-06: the rate-limit scope read the raw URL, and the router decodes the path, so `/%61pi/v1/…` reached an API route unlimited. Now judged on the matched route; test added | `aeaf5fc` |
| A-02: with errors visible again, a failed database statement would have logged its SQL text and bound values (drizzle puts them in the error's message). The logged error is now built by hand: statement, values and Postgres `detail` withheld at every level, a quoted value in a data-exception message replaced, nested and aggregate errors treated alike | `4902a0a`, `f305397` |
| A-08: every class-22 SQLSTATE and foreign-key violations were answered as 4xx, which would have hidden server defects from the only alert there is (5xx). Now an allow-list. The override service's "already waiting" 409 also matched any unique violation in its transaction; it now requires the override's own index | `231b3af` |
| A-09: the facts were stripped from the state the whole decision used, so a G2 decision's stored evidence lost the engineer's acceptance time. Only the copy handed to the rule evaluation is stripped now | `54046ca` |
| A-12: the customer notice's new spec refused "not set", so the notice could no longer be switched off | `c80d50f` |
| A-17: a cleared "Approved at" was sent as null, and the server stamps the current time on an approval with none. The form now marks the field and does not send | `c23682c` |
| A-15: every failing query started its own sign-in redirect (MSAL refuses a second), and nothing stopped a redirect that did not help from repeating. One redirect per page now, and none within a minute of the last. One of the two MSAL codes treated as "sign in again" is never thrown and was dropped | `da1817f` |
| A-16: "this quote could not be loaded" showed above a working form when a background refetch failed | `da1817f` |
| A-14: the "QuoteFlow was updated" screen appears mostly when it is not an update (the router already reloads once by itself). Reworded to "This page could not be loaded" | `da1817f` |

Also from the re-check and left as they are, with the reason: the migration lock waits without limit if its holder hangs (the holder is another instance mid-migration; the platform's start limit ends the wait); the config seed still runs outside that lock (it is idempotent upserts in a fixed order). A third item was left here at first and then fixed: the tightened intake schema also validated responses, so a draft stored earlier with a value it now refuses would not load. The review on the pull request rated that a defect, rightly; see the next section.

## Found by the review on the pull request

The automated review that runs on each push found seven more problems after the pull request was opened. Each was checked in the code first; all seven were real, and each fix has a test that fails without it.

| What was wrong | Fixed in |
|---|---|
| A-07: a draft saved before the stricter checks, holding a value they refuse (an impossible day, a figure beyond its column), answered 500 on every open and save, because the same schema described the response. Stored drafts are now read as stored; what a request sends is still checked | `5787079` |
| The fix above let the draft open, but the wizard sends the whole draft on every save, so the old value was refused each time whatever the KAM had edited. The server now checks strictly only the values a save changes, as it already did for list codes | `9307515` |
| A need-by date that is not a real day looked ready and failed in the database at submit; a date picker shows it as blank. It is now a blocking issue on its own field | `d3b1a5c` |
| A-02: the statement a function or trigger was running still reached the error log. The serializer withheld `internalQuery`; this driver names the field `internal_query`. Confirmed against a real driver error | `e1e6685` |
| A-06: intake audit rows still stored the caller's address with its source port; the earlier fix covered every route but this one | `29ad342` |
| A-15: a sign-in redirect that failed to start was remembered for the life of the page, so every later request replayed that failure | `e38a6f6` |
| UX-001 (two findings): a save by someone else counted as the reader's own unsaved change, and the Quoting cards could stay "unsaved" over a difference the server ignores | `2f8c77c`, `f99f1e5` |

One more thing came from CI, not from review: a new advisory on `picomatch` (build and lint tooling only, no fixed version) failed the dependency audit on every branch. It is accepted as a documented exception, BR-17 in `docs/build-guide/04-decisions-and-risks.md`, approved by Ben (`8a5cfe8`).

## Behavior changes

Every one replaces behavior that was plainly wrong. None changes a route, a schema's valid inputs, a permission or an audit record for a correct request.

| Change | Before | Now |
|---|---|---|
| A-07 | impossible dates, `kam=abc`, out-of-range figures: 500, a wrong window, or stored to fail later | 400 naming the field |
| A-08 | unmapped database collisions: 500 | 409, or 400 for a value that does not fit |
| A-09 | Awarded with no acceptance date, or a hold with no review date, could pass | 422 `MISSING_FIELD` |
| A-10, A-11 | prod could start in development mode, on the fake Salesforce reader, or with the synthetic seed | refuses to start, with the reason |
| A-12 | three settings took any JSON | malformed values refused; the three move from the JSON editor to labelled editors in Admin |
| A-18 | Revert accepted on a closed quote | refused; not offered |
| A-06 | SPA files rate-limited; address keyed with its port | API only; address without port |
| A-13 | trace ids `req-1`, `req-2`… | UUIDs |
| A-14 | all SPA files `max-age=0`; a missing asset answered the page shell | hashed files immutable; 404 for a missing asset |
| A-15 | a failed background `/me` refetch replaced the app | the app stays; 401 and 403 still take the page |
| A-02 | log lines carried `{}` for err, req, res | they carry the fields listed above; the request path is logged without its query string |

## Efficiency

- **A-14:** a page load used to revalidate every script, style and font (one conditional request each). After the first visit those files are now served from the browser cache with no request; only `index.html` is revalidated.
- **A-01:** not a speed-up but the removal of a hard stop: the capacity run in `01-prod-readiness.md` could not have been made on the old code at more than nine concurrent intake users.
- No index was added. At the expected volume (400 to 600 quotes a year, under 50 concurrent users) the database review found the queue, board, timeline and audit filters covered by existing indexes, with trigram indexes for search. The 50,000-quote `EXPLAIN` exercise was **not run** in this audit.
- Bundle size: unchanged. The largest chunk (`vendor`, 638 KB) still carries Recharts, dnd-kit and react-table for every page; splitting it is proposed in `04-needs-ben.md` rather than done the day before release.

## Deliberately not changed, and why

| Item | Why it was left |
|---|---|
| Section saves without the quote lock (lost updates, saves landing after a gate) | Real, narrow window. One line per loader, but it touches every write path in three services and needs parallel tests for each. First change after the demo. N-12 |
| Transactions held across file-store calls; the offer letter's 500 on a store failure | Needs restructuring of three flows. Bounded by A-20 for now. N-13 |
| The ExcelJS streaming race | Inside a dependency; Windows-only in practice. N-04 |
| Priority score on the UTC day | Moves scores while the model is under calibration. N-06 |
| Hold offered on an on-hold quote | A change to what the API offers; proposed as UX-004 |
| Hand-off editable on a Closed – Won quote | The intent is a business call. N-08 |
| RLS not narrowing "sees everything" roles by scope | Needs a decision on whether those roles are ever narrowed. N-09 |
| A second identical stay-in-stage decision | Changes the gate API. N-11 |
| Unsaved Engineering and Quoting edits lost when switching tabs | A real loss of typed input, but the fix (keeping both tabs mounted) changes what loads when; proposed as UX-001 |
| `TODO(M3)`-style markers, the generated route tree, already-applied migrations | Tracked on purpose, generated, or immutable |
| Mutation testing (Stryker) and property-based tests on `packages/domain` | **Not done.** Time went to reproducing and fixing the defects above |
| The 50,000-quote `EXPLAIN (ANALYZE)` pass | **Not done.** See Efficiency |

## Test gaps found and not filled

- `packages/domain/src/policy/can.test.ts` checks permission by role with no resource, so a qualified grant (own, assigned, in a stage) always reads as denied there and widening one would not fail it. There is no full snapshot of the permission matrix, and `PostAward` is skipped.
- `validateWorkflowConfig` has no test for two enabled gates on one stage, or for a configuration that reaches `AWARDED` from a gate other than G6 (only the seed is asserted).
- The Fabric guards compare view names and the existence of the `_json` trigger, not the twin's columns or the trigger's arguments.
- For 31 routes whose floor is `quote.read`, `offer.read` or `authenticated`, the route matrix can only test the allowed side; denial rests on feature tests.
