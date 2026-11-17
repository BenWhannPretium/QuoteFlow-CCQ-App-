# 01: Production readiness (Part A)

Pre-release audit, 2026-11-17. Every area the audit was asked to look at, with its status, the evidence, and the commit that fixed each issue. Finding ids (A-01 …) are described in full in `02-code-audit.md`; items for Ben (N-01 …) are in `04-needs-ben.md`.

- **Checked-OK:** read, and where possible run; no change needed.
- **Fixed:** changed on `claude/audit-prerelease`, with a test.
- **Needs Ben:** a decision, or something only a real environment can show.
- **Not done:** asked for, and not carried out in this audit. Said plainly so nobody assumes it was.

## The short version

Two defects would have hurt in the first week and are fixed: ten simultaneous intake requests froze the API (A-01), and production error logs were empty (A-02). Six more could have (A-03, A-07, A-09, A-12, A-15 and the rate-limit pair A-06). What still stands between this build and a calm first week is not code: alerts that notify nobody and logs that are not kept (N-01), shared Entra roles between test and prod (N-02), and a slow rollback with one migration that cannot be rolled back across (N-03).

## Boot and config

| Area | Status | Evidence |
|---|---|---|
| Env vars the prod Bicep sets vs what the code requires | Checked-OK | Nothing the code requires is missing from `infra/main.bicep` `baseSettings`. `APPLICATIONINSIGHTS_CONNECTION_STRING` is set and unused (N-01). Manual prerequisites: Key Vault secrets `database-url` and `sf-client-secret` |
| A missing required var fails fast and clearly | Checked-OK | `loadConfig` lists every issue and `server.ts` exits 1 with "refusing to start". Run 1 below |
| Silent defaults that change prod behavior | **Fixed** A-10 | `NODE_ENV` defaults to development and every safeguard keys on it; `sfMode` defaults to `fake` in the Bicep. `APP_ENVIRONMENT=prod` now refuses both. `79c1919` |
| Prod-only refusals cannot be bypassed | Checked-OK, **Fixed** A-10 | `AUTH_MODE=dev`, `FILESTORE_MODE=local`, `MAIL_MODE` not graph, `GRAPH_CLIENT_SECRET`, `MAIL_ALLOWLIST` / `MAIL_REDIRECT_TO` in prod: each proven to fire on the built app (Run 1) |
| Synthetic seed in prod | **Fixed** A-11 | `azureStart.ts` honoured `SEED_SYNTHETIC_DATA=true` in any environment. Refused in prod. `86459dc` |
| Dev- or test-only surface reachable in prod | Checked-OK | The dev persona header is read only when `AUTH_MODE=dev`; Swagger and `/docs` are registered only outside production; `/files/local` only with the local store; the persona switcher is driven by the server's `/auth/config`. Faker and the synthetic fixture ship in the bundle but cannot be reached |
| Source maps | Needs Ben N-15 | Built with `sourcemap: true` and served without sign-in |
| Start-up order: migrations, lock, Key Vault, DB reachability | **Fixed** A-03, A-11 | No lock around the migrations (`4269182`). An unresolved Key Vault reference for `DATABASE_URL` is caught with a clear message. A failed preparation now names the table, column and constraint (`86459dc`) |
| Start-up time limit | **Fixed** A-19 (not applied) | The app migrates before it listens; the platform default is 230 seconds. `WEBSITES_CONTAINER_START_TIME_LIMIT=1800` added to the Bicep. `000d2d7` |
| Graceful shutdown | **Fixed** A-04; partly unverified | Jobs stop, the rescore and view audits finish, then the pool closes (`e3effe3`, unit-tested). **A real SIGTERM could not be delivered on Windows**: unverified locally |
| Health endpoint | **Fixed** A-05 | Matches the Bicep `healthCheckPath` and the availability test; public, exempt from rate limiting, returns only status, version, db and time. It could hang on a busy pool; now bounded. `8aedd3c` |

## Auth and security (server side)

| Area | Status | Evidence |
|---|---|---|
| JWT validation | Checked-OK | `jose` with the tenant JWKS, issuer `…/{tenant}/v2.0`, audience (App ID URI and client id), `RS256` only, 60 s tolerance, `exp` and `oid` required, the `access_as_user` scope required (so app-only tokens are refused). Tested with a local key set in `auth/entra.test.ts` |
| Roles claim, group overage | Checked-OK | Roles come from the `roles` claim (app roles), which is not subject to the groups-overage limit. Unknown roles and roles without the environment's prefix are dropped; no role is a 403 with a clear message. ProductionScheduler, PricingLead and Finance are ordinary roles: absent from the token, the user simply does not hold them |
| JWKS outage | Needs Ben (minor) | A JWKS fetch failure is reported as 401 "Token is invalid" and not logged. Rare; a 503 would be more honest. Not changed |
| Shared role prefix between test and prod | Needs Ben N-02 | Both parameter files use `CCQ.` |
| Every route declares a permission and matches the inventory | Checked-OK | 129 routes, 129 inventory rows, none undeclared; boot fails on an undeclared route and `routeMatrix.test.ts` enforces the document. Two notes in the inventory are imprecise (the `/dashboards/:role` holders; a stale comment in `pricing-history.ts`): cosmetic |
| Object-level authorization | Checked-OK, Needs Ben N-09 | Notifications, drafts, attachments, feedback and overrides are scoped to the caller. One mismatch: RLS does not narrow "sees everything" roles by a region scope, the domain does |
| RLS context with pooling | Checked-OK | `SET LOCAL ROLE` and `set_config(…, true)` inside one transaction per request; values validated; no session-level SET anywhere. `FORCE ROW LEVEL SECURITY` on every quote-data table. Jobs run as `ccq_app` in the system context |
| The runtime database login | Needs Ben N-14 | It is the admin and table owner |
| Injection and input handling | Checked-OK, **Fixed** A-07 | LIKE patterns escaped in all four repos; SOQL escaped; `sql.raw` only on static identifiers; NUL characters refused. Impossible dates and unchecked ids were 500s. `3497333` |
| Uploads | Checked-OK | Declared size checked before bytes, the stream held to it, one file per request, multipart limits enforced (413), no transaction open while bytes stream, file names sanitised |
| Workbook parsing with hostile files | Checked-OK (read), partly Not done | Cached values only, cell and time limits, failures become "unavailable". **No hostile-file corpus was run** beyond the existing tests. A file handle leaks per skipped sheet (N-15) |
| Offer letter with hostile text | Checked-OK (read) | The `docx` library escapes text and strips XML-illegal characters; money is bigint. **Not rendered with LibreOffice** in this audit |
| CSV exports | Checked-OK | `csvCell` neutralises a leading `= + - @`, tab and CR; file names are server-generated |
| CSP, headers | Checked-OK, partly Needs Ben | helmet with `default-src 'self'`, `frame-ancestors 'none'`, HSTS from helmet, `upgrade-insecure-requests` in production. Signed-in CSP behavior is unverified; `img-src` lacks `blob:` (N-05 and the table at the end of 04) |
| Cache headers, SPA fallback | **Fixed** A-14 | `0f2877c`. `/api/*` 404s stay problem+json |
| Proxy trust, client address, rate limit | **Fixed** A-06 | One hop trusted, so a caller cannot spoof `X-Forwarded-For`. The limits themselves were ineffective. `5cc6b78`. The store is per instance (fine on one instance) |
| Error handling | Checked-OK, **Fixed** A-08 | Every error is problem+json; 5xx carries no message, SQL or stack. Database collisions were 500s. `6772adb` |
| Secrets and PII in logs | **Fixed** A-02 | Logs were empty rather than leaky. Now: no headers, no bodies, no query strings, no Postgres `detail`. `5262040` |

## Data integrity and concurrency

| Area | Status | Evidence |
|---|---|---|
| Two people on one gate | Checked-OK | The decision locks the quote row first; the second caller gets 409 `already_decided`. One transaction holds the decision, history, hold, notifications, audit and rescore |
| Lead review | Checked-OK | Submit and send-back lock, then re-read; a double submit is a 409 |
| Section saves vs a gate decision | **Needs Ben N-12** | No quote lock on engineering, pricing, terms and hand-off saves: lost updates and saves landing after a gate, in a narrow window |
| Stay-in-stage outcomes recorded twice | Needs Ben N-11 | |
| Decisions passing on stale stored dates | **Fixed** A-09 | `2ae3400` |
| Intake submit | Checked-OK | The draft row and the opportunity are locked; a double submit creates one quote |
| Connection pool under parallel intake | **Fixed** A-01 | `d596b6e` |
| Quote number | Checked-OK | `INSERT … ON CONFLICT DO NOTHING` then `SELECT … FOR UPDATE`; unique with a format check; the year is US Central in SQL; a rollback reuses the number, never duplicates it |
| State machine | Checked-OK, Needs Ben N-08 | Stage, status, version and closure are written only by the transition repo; closed quotes are refused; `AWARDED` only from G6 in the seed. The hand-off of a closed-won quote can be edited back |
| Overrides on closed quotes | **Fixed** A-18 | `d72f5d8` |
| Money and numbers | Checked-OK | `numeric` with explicit precision, bigint money in the offer letter, capacity maths guards zero and NaN. No float arithmetic on money found in the services read |
| Dates and zones | Checked-OK, **Fixed** A-17, Needs Ben N-06 | `timestamptz` throughout; validity, hold dates and need-by on the Central calendar. Two UI slips fixed (`ea42618`). The priority score uses the UTC day |
| Background jobs | Checked-OK, Needs Ben N-15 | Session advisory lock on a reserved connection, one run at a time per process, every run caught, timers cleared on stop. Notes: alert repeats on every failed sync, a `partial` sync never alerts, an `integration_run` can stay `running` after a kill |
| Notifications and email | Checked-OK; dispatch is off in prod | Written in the change's transaction; outbox with `SKIP LOCKED`, three tries; digest once a day by key; the mail guard outside prod. Before switching dispatch on: N-15 |
| Audit | Checked-OK, Needs Ben N-15 | Written in the caller's transaction; `UPDATE`, `DELETE` and `TRUNCATE` blocked by trigger and revoked. Two reads are not audited (offer-letter prices, pricing history) |
| Admin config cannot brick the workflow | **Fixed** A-12; Checked-OK otherwise | No delete for stages or gates; a gate cannot lose its last advancing outcome; changes are versioned, audited and need a reason. Three settings took any JSON. `de764ba` |

## Migrations

| Area | Status | Evidence |
|---|---|---|
| The chain applies to an empty database | Checked-OK | Run many times today (49 migrations); every integration test file migrates a fresh database |
| Upgrade of a database loaded with the synthetic data set | Checked-OK (existing tests) | The `fbNN-migration.int.test.ts` files (0030s to 0048) load previous-shape rows and migrate. **No additional edge-case rows were added by this audit** |
| Two instances migrating at once | **Fixed** A-03 | `4269182` |
| Long locks, `CONCURRENTLY` | Checked-OK | No `CONCURRENTLY`, no enum DDL; tables are small at this volume |
| Fabric guards | Checked-OK with two blind spots | Every `jsonb` and array column has a `_json` companion and no `numeric` is unbounded. The twin test compares names and comments, not columns; the trigger test checks existence, not arguments |
| Rollback and version overlap | **Needs Ben N-03** | `0047` is the rollback floor. The expand/contract checklist is in `05-release-runbook.md` |

## Infrastructure as code and pipeline (static review)

| Area | Status | Evidence |
|---|---|---|
| `az bicep build` / `lint` | Checked-OK | Clean before and after the audit's two additions |
| App Service | Checked-OK | HTTPS only, TLS 1.2, FTPS off, always on, system identity, health check path |
| Key Vault, storage, Postgres | Checked-OK | RBAC mode, soft delete, purge protection in prod; no public blob access; `require_secure_transport`, 35-day backups. Geo-redundant backup is off (N-15) |
| Alerts | **Needs Ben N-01** | Rules are valid platform-metric alerts; no receivers in prod |
| Logs and telemetry | **Needs Ben N-01**; opt-in route written A-19 | |
| Test vs prod drift | Checked-OK | The remaining differences are intentional, except the shared role prefix (N-02) |
| Workflows | Checked-OK, Needs Ben N-15 | OIDC only, minimal `permissions`, no secrets echoed, no `continue-on-error`. The prod guards (target is `rg-ccq-prod`, CI passed on the SHA, commit on `main`) fail closed. Actions pinned to major tags; a `v*` tag on an unmerged commit runs that commit's copy of the workflow up to the approval prompt |
| `deploy.yml` vs `deploy-prod.yml` | Needs Ben (minor) | Drift from the "keep in step" comment: test lacks `--track-status false` and waits 10 minutes where prod waits 15 |
| The package | Checked-OK (read) | API bundle, migrations and journal, analytics and Fabric SQL, the brand logo, web build, production `node_modules`; no `.env`, no tests. **`package-azure.sh` was not executed** (Git Bash is unstable on this machine) |
| Dependencies | Checked-OK | `pnpm audit --audit-level=high` exits 0; the one ignored advisory is still justified. Moderate ones in N-15 |

## Build output, attacks, capacity

### The gate, before and after

Run locally on Windows under Node 22. "After" is the audit branch; the baseline is in `00-baseline.md`.

| Step | Baseline (`06c02c5`) | Audit branch |
|---|---|---|
| Lint | fail (Prettier scanned local worktrees) | **pass** |
| Typecheck | pass | pass |
| Unit tests | contracts 20, domain 2273, web 253, db 66, api 194, integrations 152 pass + 2 fail | contracts 20, domain 2275, web 269, db 71, api 247, integrations 155 pass + 2 fail |
| Integration tests | db 224; api 2322 pass + 1 fail | db 229; api 2341 pass + 1 fail |
| Build | pass | pass |
| Playwright | 156 pass, 3 fail, 1 skipped (run alone) | 155 pass, 4 fail, 1 skipped (run while other audit work used the CPU) |

- **Every remaining failure in unit and integration is the Windows-only ExcelJS defect** (`00-baseline.md`, failure 2): `exportReader.test.ts` and `pricing-history.int.test.ts`. The count of failing `exportReader` tests varies from run to run (1 to 4) because the race is timing-dependent.
- **Playwright:** two of the four failures are the same Windows defect (`admin-integrations.spec.ts`, `pricing.spec.ts`). The other two (`g1.spec.ts`, `intake.spec.ts`) timed out under load, as they had in the discarded first baseline run; re-run alone on a fresh database after a rebuild, both spec files passed (9 of 9). The `fb19` hang seen in the baseline did not recur.
- **Test counts went up, never down:** 2 domain, 16 web, 5 db unit, 53 api unit, 3 integrations unit, 5 db integration and 19 api integration tests were added. The unit counts are from a final run on the finished branch; the integration and Playwright counts are from the full gate run made before the last eight fix commits (the ones from the independent re-check), whose own tests were run individually.
- **The authoritative run is CI on Linux** for pull request #107, where the Windows defect does not occur. Its result is in the pull request, not here.
- Bundle size is unchanged (no web dependency or chunking change). Not re-measured to the kilobyte.

### Build output: the production refusals (Run 1)

The built API (`apps/api/dist/server.js`, and `azureStart.js` for the last row) was started with a clean environment for each case. Each exited 1 with its reason:

| Case | Message |
|---|---|
| `AUTH_MODE=dev`, production mode | AUTH_MODE=dev is forbidden when NODE_ENV=production |
| `FILESTORE_MODE=local`, production mode | FILESTORE_MODE=local is forbidden when NODE_ENV=production |
| `MAIL_MODE=fake`, and `smtp` | MAIL_MODE=… is forbidden when NODE_ENV=production. Use graph |
| `GRAPH_CLIENT_SECRET`, production mode | GRAPH_CLIENT_SECRET is for the test site only |
| `MAIL_ALLOWLIST`, and `MAIL_REDIRECT_TO`, with `APP_ENVIRONMENT=prod` | … is for test only and is forbidden when APP_ENVIRONMENT=prod |
| `APP_ENVIRONMENT=prod` with `NODE_ENV=development` (new) | NODE_ENV=development is forbidden when APP_ENVIRONMENT=prod |
| `APP_ENVIRONMENT=prod` with `SF_MODE=fake` (new) | SF_MODE=fake is forbidden when APP_ENVIRONMENT=prod |
| Entra mode with no tenant id | ENTRA_TENANT_ID is required when AUTH_MODE=entra |
| `DATABASE_URL` holding an unresolved Key Vault reference | refused (`azureStart.js` gives the clearer Key Vault message first in Azure) |
| `azureStart.js` with `SEED_SYNTHETIC_DATA=true` in prod (new) | SEED_SYNTHETIC_DATA=true is forbidden when APP_ENVIRONMENT=prod |

One limit, stated plainly: the three new prod refusals depend on `APP_ENVIRONMENT=prod` being set. The Bicep always sets it; a prod app whose setting was removed by hand would be treated as "not prod" (banner shown, mail guarded) and those three checks would not apply.

### Build output: an inert production-mode boot (Run 2)

`NODE_ENV=production`, `APP_ENVIRONMENT=test`, Entra mode with placeholder ids, `SF_MODE=fake`, a blob store at an address nothing listens on, Graph mail with no credentials and dispatch off, the localhost database migrated and config-seeded with no synthetic data. Nothing real could be reached; no token was sent anywhere.

| Check | Result |
|---|---|
| `GET /api/v1/health` | 200, `status: ok`, `db: up`, the build's version |
| `/api/v1/me` with no token | 401 problem+json, `WWW-Authenticate: Bearer … error="invalid_request"`, a UUID `traceId` |
| `/api/v1/me` with a malformed token | 401, `error="invalid_token"` |
| `/api/v1/me` with the dev persona header | 401: the header is ignored outside dev mode |
| `GET /` and a client route | 200 HTML, `Cache-Control: no-cache` |
| A hashed asset | 200, `public, max-age=31536000, immutable` |
| A build file that does not exist | 404 problem+json |
| `GET` and `POST /api/v1/nope` | 404 problem+json |
| `/docs`, `/docs/json` | the SPA shell: no Swagger, no OpenAPI document |
| `/api/v1/files/local/…` | 404: the local-store route is not registered |
| CSP | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' https://login.microsoftonline.com; frame-src https://login.microsoftonline.com; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests` |
| Other headers | HSTS one year with subdomains, `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer` |
| Rate limit of 6 per minute, one address on nine source ports | 200 ×6, then 429 ×3 |
| Three other addresses | 200 each |
| The percent-encoded path `/%61pi/v1/auth/config`, nine times | 200 ×6, then 429 ×3 |
| Nine rejected sign-ins from one address on nine ports | 401 ×6, then 429 ×3 |
| Twelve page loads, twelve health probes | all 200: neither is rate-limited |
| Log lines | JSON; request ids are UUIDs; no `"err":{}`, `"req":{}` or `"res":{}`; the warning "SF_MODE=fake in production" is logged |

**Not verified here:** a source map is served without sign-in (200; N-15). No response was compressed, and the API registers no compression plugin: unless the App Service front end compresses, the 2.1 MB of JavaScript goes out as it is. **Graceful SIGTERM could not be tested** (Windows cannot deliver the signal; the process was killed). MSAL sign-in, a signed-in CSP session and Key Vault resolution need the real environment.

### Adversarial pass

- **Fuzz from the app's own OpenAPI document** (`/docs/json`, development mode): 129 operations, as Admin, KAM and Engineer; path values included other quote numbers, unknown ids, traversal and SQL-like strings and 300-character values; bodies included wrong types, 5,000-element arrays, deep nesting, `__proto__`, NUL characters, impossible dates, and malformed JSON, form and XML content types. **16,434 requests: no 5xx, and every refusal was problem+json** (400: 4,809; 403: 7,511; 404: 1,024; 414: 1,587; 415: 727; 409: 9; 422: 11; 200/201: 756).
- **Every route as every role** is the existing `routeMatrix` and `permissions` suites (allowed and denied for 129 routes), which pass. This audit did not add to them.
- **Parallel attacks kept as permanent tests:** 24 simultaneous draft reads and autosaves (`pool-nesting.int.test.ts`), three simultaneous migrations (`migrate-concurrent.int.test.ts`), the rate limit against changing ports and an encoded path (`spa.test.ts`), impossible input (`input-hardening.int.test.ts`), decisions without their own dates (`outcome.int.test.ts`).
- **RLS with the route check bypassed** is the existing `packages/db/test/rls.int.test.ts` and `opportunity-rls.int.test.ts` (queries as `ccq_app` with another user's context), which pass.
- **Not done:** a scripted IDOR sweep per role beyond what those suites and the fuzz cover; replaying decisions out of order across two live sessions; the Admin "try to brick it" exercise by hand (the settings validators are now guarded by a test, A-12; outcome and gate changes are re-validated by existing code that was read, not attacked).

### First boot of an empty production-shaped database

A fresh database, `db:migrate` then the config-only seed: 49 migrations, 68 settings, no users, no quotes. The production-mode boot above ran against it and came up healthy. **Not done:** signing in as the first Admin and clicking through the empty screens (Entra mode cannot be signed into locally, and dev mode needs the persona users that only the synthetic seed creates). The existing Playwright suite runs against a config-only database in CI and passes, which covers empty lists, the empty board and zero-row analytics for the dev personas.

### Capacity

**What was run.** k6 is not installed on this machine, so the repo's `tests/load/read-paths.js` was not run. A small Node stand-in drove the same screens (dashboard, quote list, quote detail and timeline, the role's queue, the board, the notification bell) as thirteen synthetic personas against the **production build** in development mode (dev sign-in is needed to act as each role), with the heap capped at 1,024 MB, pretty logging on, the synthetic data set (150 quotes) and Postgres in Docker on the same laptop as the load generator. Read these as conservative and as a laptop, not as a B1.

**50 virtual users, 12 minutes, each making a request roughly every 1.5 seconds** (far busier than a person):

| Screen | Requests | p50 | p95 | p99 | Slowest |
|---|---|---|---|---|---|
| Dashboard | 3,627 | 403 ms | 705 ms | 870 ms | 1,067 ms |
| Quote list | 3,627 | 566 ms | 850 ms | 1,007 ms | 1,187 ms |
| Quote detail | 3,627 | 744 ms | 1,036 ms | 1,205 ms | 1,466 ms |
| Timeline | 3,627 | 531 ms | 820 ms | 952 ms | 1,165 ms |
| Queue | 1,841 | 581 ms | 859 ms | 1,011 ms | 1,157 ms |
| Board | 3,627 | 618 ms | 890 ms | 1,061 ms | 1,234 ms |
| Bell | 3,627 | 431 ms | 704 ms | 848 ms | 1,023 ms |

- 23,693 requests at 32.5 a second. **No 5xx, no 429, no time-out.** Latency was flat from the first minute to the last (window p95 between 790 and 1,080 ms throughout): no drift.
- The health probe took 170 to 720 ms during the run and 2 to 5 ms the moment it ended: the single Node process was saturated. **About 30 requests a second is this build's ceiling on one core**, and at that ceiling it is slow, not failing. The 400 ms p95 target is **not** met at this load.
- Then the path that used to freeze: 30 intake draft reads at once, three times. All 90 answered in about 160 ms per round.

**15 virtual users, 5 minutes, the same pattern** (14 requests a second, which is already above what the pilot should produce):

| Screen | p50 | p95 | Slowest |
|---|---|---|---|
| Dashboard | 23 ms | 46 ms | 73 ms |
| Quote list | 75 ms | 107 ms | 149 ms |
| Quote detail | 109 ms | 149 ms | 188 ms |
| Timeline | 32 ms | 49 ms | 67 ms |
| Queue | 69 ms | 98 ms | 118 ms |
| Board | 101 ms | 130 ms | 175 ms |
| Bell | 6 ms | 10 ms | 18 ms |

4,317 requests, no errors, the health probe at 2 to 4 ms throughout. **Every screen is well inside the 400 ms p95 target at this load.** The knee is somewhere between 14 and 32 requests a second on one core.

**Memory.** The sampler written for these runs did not work (it recorded zeros), so there is no memory series. Two readings taken by hand early in the 50-user run were 252 MB and 283 MB resident. **A leak was not ruled out by measurement;** the only evidence is that latency did not drift over 12 minutes.

**Reading it against the pilot.** The architecture expects about 60 users and fewer than 50 at once. People do not make a request every 1.5 seconds: a page view is five or six requests and then a pause of many seconds, so 50 people at work is nearer 5 to 10 requests a second, a third or less of the ceiling measured here. **B1 (one core, 1.75 GB) is enough for the pilot, with little headroom for a second workload**, and it has two real limits that are not about speed: one instance (a deploy or a crash is an outage for everyone) and no staging slot. Move to the planned P1v3 before the wider rollout, not because the pilot will saturate B1 but because of those two.

**Not done:** the 30-minute soak that was asked for (12 minutes was run); the k6 script itself; any run on Azure hardware.

## Observability

| Question | Answer |
|---|---|
| Can an incident be debugged from telemetry alone? | **Not today.** After A-02 and A-13 deploy, a log line carries a unique request id (the same value as the problem `traceId` and `audit_event.request_id`), method, path, status, duration and the error. Without the diagnostic setting (N-01) those lines live for 7 days in 35 MB on the instance |
| Job logs | Start, finish and counts are logged with a `component` field. Failures of the validity, dispatch and Fabric jobs log only `code: 'unknown'` for a non-database error: thin, not fixed |
| Alerts match real failure modes | Yes for availability, 5xx, CPU, Postgres. Nothing alerts on a start-up failure or on a frozen-but-listening instance other than the availability test |

## Pre-mortem: ten ways the first week goes wrong

Written as if each had already happened, with what this audit shows.

| # | What happened | Evidence in this audit |
|---|---|---|
| 1 | The app froze during a training session with a room of KAMs in intake | **Ruled out by A-01**, reproduced and fixed, regression test in CI |
| 2 | A 500 was reported with a trace id and nobody could find out why | **Ruled out in code** by A-02 and A-13; **still open operationally** until logs are kept (N-01) |
| 3 | The site was down for an hour before anyone knew | **Open.** Alerts have no receivers (N-01) |
| 4 | A deploy went wrong and rolling back took most of an hour, or broke engineering saves | **Open.** N-03 |
| 5 | A UAT tester turned out to be an Admin in prod | **Open** until the role assignments are reviewed (N-02) |
| 6 | Users returning on Tuesday morning could not use the tab they had left open | **Probably ruled out** by A-15; not verified against Entra (N-05) |
| 7 | An Admin changed a setting and intake stopped working | **Ruled out** for the three unvalidated settings (A-12); every seeded setting now has a validator, guarded by a test |
| 8 | A quote was marked Awarded with no acceptance date, or held with no review date | **Ruled out by A-09** |
| 9 | Two people saved the same section and one person's work vanished | **Open, narrow.** N-12 |
| 10 | The demo ran from a laptop and the payback summary said "unavailable" | **Open on Windows only.** N-04: run the demo on the Azure test site |
