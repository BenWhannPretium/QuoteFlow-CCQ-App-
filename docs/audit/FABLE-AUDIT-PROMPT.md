# QuoteFlow pre-release audit: prompt for Fable 5.2

> How to use: open a fresh Claude Code session in `C:\Users\benwh\code\QuoteFlow` on Fable 5.2 and paste
> everything below the line. It is written to run mostly unattended: Parts A and B (code changes) need no
> approval; Part C stops and waits for Ben's approval before changing anything.

---

You are auditing **QuoteFlow**, Pretium Packaging's Commercial Capital Quoting (CCQ) web app, a pnpm/Turborepo
monorepo (`apps/api` Fastify 5, `apps/web` React 18 + Vite, `packages/{domain,db,contracts,integrations,config}`,
`infra/` Bicep, Playwright e2e, Postgres 16 with RLS). It is about to be released to a production Azure
environment (App Service Linux Node 22, Postgres Flexible Server, Key Vault, App Insights, Entra ID only).
The feature build (B-01 to B-27 and FB-01 to FB-20) is finished and merged. **This is the last quality pass
before release.**

Read `CLAUDE.md` first and treat it as binding. Then read `docs/build-guide/01-architecture.md`,
`docs/build-guide/05-path-to-mvp.md`, `docs/build-guide/04-decisions-and-risks.md` and
`docs/security/route-inventory.md`. The code is large (hundreds of source files, 47+ migrations, 100+ routes):
use subagents to fan out reading and review by area, and give each a narrow brief. Do not trust a subagent's
claim that something is a bug until you have read the code yourself and, where possible, reproduced it.

## Goals

1. **Production soundness.** Find the bugs and misconfigurations that would hurt us the first week in prod.
2. **Debug and tighten the whole codebase.** Fix real bugs, and refactor for efficiency and robustness
   **without changing how the app behaves.**
3. **Improve the experience.** Find what would make the app easier to understand and use for someone who has
   never read the manual. Propose; change only what Ben approves.

## Authority and limits

| Part | What | Authority |
|---|---|---|
| **A**, prod readiness (code, config, infra as code, pipeline) | find and fix | **Make changes without asking** |
| **B**, code debug and refactor (behavior-preserving) | find and fix | **Make changes without asking** |
| **C**, UX and simplification | analyze, then **propose** | **Do not change anything until Ben approves specific items by ID** |
| **D**, release package (runbook, rollback plan, UAT/doc accuracy, first-week watchlist) | write and correct | **Make changes without asking** (docs and scripts only; no app behavior) |

Hard limits that no part overrides:

- **Never touch real Azure resources or production.** Do not run `deploy-prod.yml`, `az deployment ... create`,
  `az webapp` writes, Key Vault writes, or anything against `rg-ccq-prod` or the test site. Read-only
  `az bicep build` / `lint` is fine. A Bicep what-if is not (it needs the subscription).
- **Never push to or merge into `main`.** Work on a new branch `claude/audit-prerelease` cut from
  `origin/main` (`git fetch` first; PRs #98 to #105 are already merged, so local `main` may be behind).
  Commit in small Conventional-Commit units (`fix(...)`, `refactor(...)`, `perf(...)`, `test(...)`, `docs(...)`),
  push the branch and open **one PR** at the end (or per part if it gets large). Ben merges.
- **Never edit an already-applied migration.** Schema fixes are new, numbered migrations, and they must keep
  the Fabric mirror rules in `CLAUDE.md` rule 10 (companions, numeric precision, no arrays or jsonb without
  `_json`, T-SQL twins, no partitioning/TRUNCATE). The guard tests must stay green.
- **Do not commit real data, secrets or tokens.** Synthetic data only. Do not read `.env` values into output.
- **Do not change locked decisions or open business decisions.** Anything in `04-decisions-and-risks.md`
  marked open or `provisional: true` stays config-driven and stays as seeded. If you think a value is wrong,
  write it up in the report; do not change it. Do not hard-code a business rule (CLAUDE.md rule 4).
- **Do not weaken** server-side authorization, RLS, audit, the AUTH_MODE/NODE_ENV production guards, the
  read-only posture toward Salesforce and pricing, or "no role is hidden from data it can enter" (rule 2).
  A change that touches any of these is allowed only if it makes the control stricter or fixes a defect, and it
  needs allowed **and** denied tests.
- **Out of scope, do not report as findings:** creating the Fabric mirror or anything on the "waiting on a
  person" list in `05-path-to-mvp.md` (IT approvals, Entra role/group creation, Salesforce field-meaning
  confirmations, SharePoint site/permissions, shared mailbox, missing templates, unmade business decisions,
  `FABRIC_*` variable values). Code that must *behave correctly when those are absent or unset* is in scope.
- Behavior preservation means: same inputs give the same outputs, same permissions, same audit trail, same API
  contract (routes, schemas, status codes, problem+json shapes), same UI behavior. A bug fix that changes behavior
  is fine in Part A/B **only when the old behavior was plainly wrong**, and it must be listed under "behavior
  changes" in the report with the reason. If it is a judgment call, it goes to Part C instead.

## Phase 0: baseline (do this before changing anything)

1. `git fetch`, branch from `origin/main`, `pnpm i`, `docker compose up -d db`.
2. Run the full gate and record the result: `pnpm lint`, `pnpm typecheck`, `pnpm test`,
   `pnpm test:integration`, `pnpm build`, and the Playwright suite (`pnpm e2e`, see `.github/workflows/ci.yml`
   for how CI seeds the e2e DB). If anything is red on a clean checkout, that is finding #1: diagnose it
   (real bug, flaky test, environment) before going on.
3. Record the baseline in `docs/audit/00-baseline.md`: command, pass/fail, counts, duration, and the bundle sizes
   of `apps/web/dist`. You will compare against it at the end.
4. Skim the test suite for quality: tests that assert nothing, are skipped (`.skip`, `.todo`), are
   order-dependent or flaky, or mock away the thing they claim to test. List them; fix the ones in your way.

## Part A: Production readiness (fix without asking)

Think like the on-call engineer on release day. For each item, read the code, find the failure mode, and either
prove it fine (note it in the report as "checked, OK, here is why") or fix it with a test. Look hardest at:

**Boot and config**
- `apps/api/src/config.ts`, `server.ts`, `azureStart.ts`: every env var the prod Bicep (`infra/`,
  `main.prod.bicepparam`) actually sets versus every var the code requires or silently defaults. A required var
  that is missing in prod must fail fast and clearly; an optional one must not change behavior silently.
  Verify the prod-only refusals (AUTH_MODE=dev, FILESTORE_MODE=local, MAIL_MODE, GRAPH_CLIENT_SECRET) cannot be
  bypassed, and that `APP_ENVIRONMENT=prod` is handled consistently everywhere (banners, dev switcher, seeds,
  synthetic-data commands, test-only routes, CORS, Swagger/OpenAPI exposure).
- Anything dev- or test-only reachable in prod: dev role switcher, fake users, seed/synthetic CLIs, debug
  routes, verbose errors, source maps, `/docs` or OpenAPI exposure, test-site secrets.
- Startup ordering: migrations, advisory lock, Key Vault reference resolution, DB reachability, graceful
  shutdown on SIGTERM (App Service slot swaps and restarts), in-flight request draining, pool close.
- Health/readiness endpoints: do they check what matters (DB, migrations current) without leaking detail, and do
  they match the App Service health-check path in the Bicep?

**Auth and security (server-side)**
- JWT validation with `jose`: issuer, audience, tenant, algorithm allowlist, expiry/clock skew, JWKS caching and
  rotation, v1 vs v2 token shapes, role/group claim handling (including the **group-overage claim** when a user is
  in more than ~200 groups), missing/empty roles, unknown roles, the ninth role (PricingLead) and the
  provisional Production Scheduler / Finance roles when their Entra role is absent.
- Walk **every** route in `apps/api/src/routes/v1` against `docs/security/route-inventory.md` and
  `routeMatrix.test.ts`: declares a permission, goes through `packages/domain/src/policy`, has a zod schema, is in
  OpenAPI, has allowed and denied tests. The inventory doc must match reality; fix whichever is wrong.
- RLS: confirm the request context (`withRequestContext`) sets the user/role/scope per transaction in a way that is
  **safe with connection pooling** (`SET LOCAL` or equivalent, never session-level leakage between requests), that
  no code path queries as a privileged role by accident, that jobs (`sfSync`, `validityExpiry`,
  `notificationDispatch`, `fabricMirrorCheck`) run with the context they need and no more, and that every table
  with user data has RLS enabled and forced where the architecture says so.
- Injection and input handling: SQL built by string concatenation, `sql.raw`, LIKE patterns from user input
  (wildcards, escaping), path traversal in file/attachment names, content-type vs extension checks, upload size
  limits and the multipart limits actually enforced, zip/XLSX parsing (costing, ROI, pricing-history, BOM
  uploads) with hostile or malformed files (huge, formula-heavy, wrong sheet, missing cells, merged cells),
  and the offer-letter generator with hostile text (markup, very long strings, unicode).
- Output and headers: CSP actually compatible with MSAL redirect/popup and the SPA's real asset loading, HSTS,
  cache headers (hashed assets immutable, `index.html` never cached), SPA fallback not swallowing `/api/*` 404s,
  CORS, cookie flags if any, `trust proxy` and the real client IP for the per-user rate limit behind App Service's
  front end, rate-limit storage across instances.
- Error handling: RFC 9457 problem+json everywhere, no stack traces or SQL/driver messages in prod responses,
  no PII or tokens in logs (pino redaction paths cover Authorization, cookies, tokens, request bodies with
  customer data), correct 4xx vs 5xx.

**Data integrity and concurrency** (the most likely source of "weird" bugs in a quoting workflow)
- Two users acting on the same quote at the same time: double submit, double gate decision, lead decides while
  the assignee withdraws, section locks after G2/G3/G4 versus an in-flight save, autosave racing submit, two tabs.
  Look for missing transactions, missing `SELECT ... FOR UPDATE` or optimistic version checks, TOCTOU between a
  permission/state check and the write, and non-idempotent endpoints that a retry or double click duplicates.
- Quote number generation (`CCQ-YYYY-NNNNN`): race-free, no gaps-then-duplicates, correct at the year boundary
  (US Central vs UTC), recoverable after a rolled-back transaction.
- State machine integrity: can a quote reach a stage or status the stage/gate engine in `packages/domain` forbids
  through *any* route, import, admin action, migration backfill or job? Check hold/resume, send-back, Stop,
  Redirect, Re-cost, multi-item (FB-19) gating, and "Closed – Won only from G6".
- Money and numbers: no JS floating-point arithmetic on currency, capital, margin, volume or utilization where
  rounding matters; Postgres `numeric` precision/scale; division by zero and NaN/Infinity; negative and zero
  volumes; very large values; consistent rounding between API, domain and UI; the payback/ROI summary reader
  with blank or text cells.
- Dates and time zones: every `timestamptz` UTC; business dates (validity, need-by, quarter/year boundaries,
  DST transitions, US Central) computed in the right zone; `validityExpiry` correct and idempotent when it runs
  twice or after downtime; date-only values never shifted by a timezone conversion in the browser.
- Background jobs: do they run on **every** instance (App Service scale-out, slot swap overlap, restart during a
  run)? They need a Postgres advisory lock or equivalent so they do not double-send notifications, double-expire
  quotes or double-sync Salesforce; they must be idempotent, resumable, time-bounded, log failures, and never
  crash the process on an unhandled rejection. Check the Salesforce sync for paging, rate limits, partial
  failure, deleted/merged opportunities, null fields, and what the app does when Salesforce is unreachable.
- Notifications and email: dedup, collapse window, retry/poison-message behavior, no sends to fake addresses in
  prod, correct recipients after reassignments and role changes, failure of Graph not blocking the user action.
- Audit: every view, stage change, gate decision, override, upload and export writes an `audit_event`, in the
  **same transaction** as the change (or provably cannot be lost), append-only enforced in the database
  (no UPDATE/DELETE grant or trigger), and no audit row written for an action that was rolled back.
- Migrations: apply the whole chain to an empty DB **and** upgrade a DB loaded with the full synthetic dataset
  from the previous release (use `pnpm db:demo` / seeds, plus your own edge-case rows: nulls, legacy ERF
  references, grandfathered quotes, retired list values) to prove backfills and NOT NULL/CHECK additions do not
  fail on real-shaped data. Check each migration for long locks on big tables, missing `CONCURRENTLY` indexes
  where it matters, unsafe defaults, irreversible data loss, and idempotency of the deploy-time migrate step
  (two instances starting together). Verify the Fabric guards (`fabricCompat`, `fabricTwins`, `fabric.int`) are
  meaningful, not vacuous.

**Infra as code and pipeline (static review only)**
- `infra/main.bicep`, `modules/*`, `main.prod.bicepparam` versus `main.test.bicepparam`: `az bicep build` and
  `az bicep lint` clean; prod-specific settings (SKU, always-on, health check, HTTPS only, TLS 1.2+, FTPS off,
  minimum TLS, managed identity, Key Vault references and purge protection, Postgres SSL required, backups and
  retention, private endpoints/network rules, geo or zone settings, alert rules and action groups that actually
  have receivers, App Insights sampling and retention, diagnostic settings, storage public access off, RBAC
  least privilege, deploy identity federated subject). Flag drift between test and prod that is not intentional.
- `.github/workflows/*.yml`: pinned action versions, minimal `permissions`, OIDC only, no secrets echoed, the
  prod guard steps (target is `rg-ccq-prod`, CI passed on the SHA, commit is on `main`) cannot be skipped,
  migration step ordering and rollback story, slot-swap and health-check behavior, `deploy.yml` and
  `deploy-prod.yml` in step as their comments demand, `package-azure.sh` includes exactly what prod needs and
  nothing it must not (no `.env`, no test fixtures, no dev dependencies that matter).
- Dependencies: `pnpm audit`, the one ignored GHSA (is the ignore still justified?), deprecated or unmaintained
  packages, version ranges that are not pinned, Node 22 compatibility, lockfile integrity.
- Build output: the production bundle starts cleanly with `NODE_ENV=production` and a production-shaped env
  (entra mode, no dev vars). **Actually boot the built API that way against the local DB** (with fake/inert
  integration modes where prod values are unavailable) and exercise health, auth rejection, SPA fallback, a
  404 under `/api`, and a graceful SIGTERM. Record what you ran.

**Adversarial pass: actively try to break it (local instance only, synthetic data)**
- Stop reading and start attacking. Against the running local app, for **each role**, script attempts to do what
  that role must *not* be able to do: read or write another user's or scope's quotes (IDOR by swapping UUIDs and
  quote numbers), call every route you are not permitted to, replay a gate decision out of order, edit a locked
  section, decide your own lead review, escalate by tampering with role/scope claims in a dev-mode token, tamper
  with request bodies (extra fields, wrong types, huge arrays, nested depth), forge `Content-Type`, send duplicate
  and out-of-order requests, hit the same endpoint 50x in parallel. Confirm the database layer (RLS) holds
  **even when the route check is deliberately bypassed in a test** (query as the app role with another user's
  context and prove zero rows).
- Fuzz the API from its own OpenAPI document (for example schemathesis, or a small generator from the zod
  schemas): no 5xx on any generated input, every failure is a clean problem+json 4xx. Every 5xx is a bug.
- Keep the good attacks as permanent tests in the integration suite so they guard future changes.

**Rollback and version overlap (the release-day trap)**
- During a deploy or slot swap, **old and new app versions run against the same database** for a while, and a
  rollback runs the old app against the *new* schema. Production starts empty, so the first deploy is a clean
  forward path, but every release after it must follow the expand/contract rule: no dropped or renamed column or
  tightened constraint that the previous app version still uses. Establish that discipline now: add a CI check or
  a documented checklist for future migrations, review the most recent migrations (FB-15 to FB-20, 0044 to 0047+)
  against it as the pattern, and document which migrations are not safely roll-back-able and what the rollback
  plan is for each (forward-fix, restore point, feature switch).
- Confirm the app tolerates its own new config rows being absent (a fresh prod DB that has had `db:migrate` and
  the **config-only** seed, **not** the synthetic seed) and that a first-ever boot of an empty prod DB reaches a
  usable state: first Admin able to sign in and assign roles, every config-driven dropdown populated, no screen
  that assumes sample data exists (empty Command Center, empty board, zero-row analytics, no pricing history yet,
  no Salesforce sync yet). Run exactly this scenario and click through it.

**Observability and capacity**
- Can someone debug a production incident from the telemetry alone? Check request/correlation IDs carried API ->
  logs -> App Insights -> the audit event, useful structured fields (quote number, user id hash, route, duration,
  gate), error logs that say what failed and for whom, job start/finish/duration/failure logs, Salesforce and Graph
  call outcomes, slow-query logging, and that alert rules in the Bicep match failure modes that can actually occur
  (and are not noisy). Add what is missing; remove what leaks PII.
- Capacity: the interim prod plan is a small SKU (see `main.prod.bicepparam`). Run the k6 load and a **soak** (30+
  minutes, steady load) locally against a production build with a memory cap similar to that SKU, watch RSS and
  event-loop lag for leaks, check DB pool saturation, and report the number of concurrent users it comfortably
  carries versus the expected UAT/pilot population. Say plainly if the SKU is too small.

## Part B: Code debug and behavior-preserving refactor (fix without asking)

Method: go package by package, **domain first** (pure logic, cheapest to prove), then `db`, `contracts`,
`integrations`, `api`, `web`. For each area, read for defects first, efficiency second, tidiness third.

**Rules of engagement for every change**
1. Before refactoring anything non-trivial, make sure a test pins its current behavior. If none exists, write a
   characterization test first (it must pass on the unmodified code), then refactor, then prove it still passes.
2. One concern per commit. Never mix a bug fix with a refactor.
3. Every bug fix gets a regression test that fails before the fix and passes after. Say so in the commit body.
4. Do not "improve" generated files (`routeTree.gen.ts`) by hand; regenerate them properly.
5. If a refactor would change a public contract (API schema, DTO, DB column, route path), stop and put it in
   Part C instead.
6. Prefer deleting code over adding it. Confirm dead code is dead (no dynamic use, no reference from config,
   migrations, seeds or docs) before removing it.

**What to hunt**
- **Correctness:** off-by-one, wrong comparison/operator, inverted conditions, unhandled `null`/`undefined`,
  `||` where `??` is meant, truthiness bugs on `0`/`''`, missing `await`, unhandled promise rejections,
  `forEach(async ...)`, swallowed errors (`catch {}`), mutation of shared/frozen objects, stale closures and
  missing hook dependencies in React, effects that run twice (React 18 StrictMode), state derived in effects,
  uncontrolled/controlled input flips, key props on lists, race conditions between autosave, submit and
  navigation, optimistic updates that are never rolled back, cache invalidation gaps in TanStack Query
  (a mutation that leaves a list or detail view stale), wrong or colliding query keys.
- **Type soundness:** `any`, `as` casts and non-null `!` that hide real nullability, `@ts-ignore`/`@ts-expect-error`,
  zod schemas that drift from DB columns or from the DTOs the web expects, `z.coerce` surprises, enums duplicated
  in three places, values the DB allows but the schema rejects (or the reverse), JSON columns read without
  validation. Tighten without changing runtime behavior where legitimate.
- **Domain engine** (`packages/domain`): stage/gate transitions, scoring and tiers, overrides, permission policy
  matrix, lead-review rules, locks, capacity/utilization math, offer letter, quote-number logic. Property-style or
  exhaustive tests for the transition table (every stage × decision × role), and for policy (every permission ×
  role, so adding a role later cannot silently open access). Look for rules duplicated between domain, API and
  web that can disagree. The domain package must stay free of I/O.
- **Database:** N+1 queries in route handlers and repos, missing indexes for the real filters/sorts/joins (check
  with `EXPLAIN (ANALYZE, BUFFERS)` against a large synthetic dataset, for example 50k quotes, and add indexes in
  a new migration where a seq scan is hit on a hot path: the Command Center lists, board, search, analytics,
  audit/timeline reads), over-fetching (`select *` of wide rows or jsonb for list views), unbounded queries
  without pagination or a hard cap, loops issuing queries, transactions held open across network calls
  (Salesforce, Graph, file store), pool size versus Postgres connection limits and per-instance count, missing
  statement/idle-in-transaction timeouts, RLS policies that defeat index use (non-sargable predicates, per-row
  function calls that should be `STABLE`/initplan-wrapped). Re-run `tests/load` (`pnpm load:smoke`, k6 if
  available) before and after and report p95.
- **API layer:** handlers doing business logic that belongs in `domain`, duplicated validation, inconsistent
  pagination/sort/filter conventions, inconsistent error codes for the same condition, endpoints returning more than
  the caller needs, large JSON responses without compression, missing `ETag`/conditional where cheap.
- **Integrations:** timeouts, retries with backoff and jitter on idempotent reads only, circuit-breaking or at
  least bounded concurrency, behavior on 401/403/429/5xx, token refresh, pagination exhaustion, fake
  implementations that diverge from the real interface (a fake that cannot fail hides bugs; make fakes able to
  simulate failures and add tests that use that).
- **Web performance and robustness:** route-level code splitting and bundle weight (look at the largest chunks:
  Recharts, dnd-kit, MSAL, zod; lazy-load analytics and admin), duplicate dependencies in the bundle,
  re-render hot spots on the board, the Command Center, long forms (intake wizard, engineering review, quoting),
  memoization only where measured, large lists (virtualize or paginate), query `staleTime`/`gcTime`/refetch-on-focus
  settings that cause request storms or stale screens, request waterfalls on page load that could be parallel,
  images/fonts, error boundaries on every route (a thrown render error must not white-screen the app),
  loading/empty/error states for every query, offline/expired-token behavior (silent MSAL token refresh failure
  must send the user to sign in, not leave a broken page), unsaved-changes protection on long forms.
- **Redundancy:** duplicated components, helpers, constants, zod schemas, SQL fragments, test fixtures, copy-pasted
  stage-specific code that the data-driven engine should own. Consolidate where it reduces risk; leave it where
  consolidation would couple unrelated things.
- **Hygiene:** unused exports/files/dependencies (`knip` or equivalent, verified by hand), stale TODOs
  (`TODO(M3)` etc. are tracked on purpose: leave those, list the rest), `console.log` left in source, commented-out
  code, inconsistent naming against the glossary (ERF not ERS; Stage 6 is Commit & Hand Off), lint rules that are
  silently disabled.
- **Admin-config robustness** (the engine is data-driven, so a bad config row must not be able to brick the
  workflow). Try, as an Admin, to: deactivate or delete a stage, gate owner, reason code, value-list entry or role
  mapping that open quotes use; set a threshold/weight/validity to zero, negative, blank or absurd; make a gate
  have no eligible decider; create a cycle or dead end in transitions; activate a scoring model with missing
  weights; empty a required list. Each must be refused with a clear message or handled safely (retired values
  stay readable on old quotes), validated server-side, and audited. Add the missing validation.
- **Test strength, not just test count:** run mutation testing (for example Stryker) on `packages/domain`
  (workflow engine, scoring, policy, lead-review, locks) and fix the surviving mutants that matter by adding
  assertions. Add property-based tests (fast-check) for scoring monotonicity/bounds, transition-table closure, and
  capacity math. Add genuine **parallel-request integration tests** for the concurrency cases in Part A. Check
  the project's own rule is met: every stage has at least one Playwright happy path, every route has allowed
  **and** denied tests; list any gap and fill it.
- **Requirements traceability:** take the feedback tracker (`docs/build-guide/feedback/`, the F-/T-/V-/W13-
  items), `docs/gate/traceability.md` and the PRD-derived build steps, and for each item built in FB-01 to FB-20
  find the code **and** the test that proves it. Report items that are claimed done but have no test, have a
  test that does not actually assert the requirement, are only partly implemented, or were silently altered by
  a later FB (regressions between features, for example FB-15's submit rules versus FB-19's multi-item, FB-16's
  capacity step versus FB-17's decision dialog, FB-18's Command Center versus FB-08/FB-11 fields). Fix
  regressions and missing tests; list real gaps for Ben.
- **Generated documents and files:** the offer letter (.docx) and any export (capacity export, CSV/XLSX) must
  open cleanly: validate the docx package structure (zip, content types, relationships) programmatically and
  render it with LibreOffice if available; test long customer names, many items, special characters, non-ASCII,
  empty optional fields, and a costing workbook with blanks or odd formats. CSV/XLSX exports must guard against
  formula injection (cells starting `=`, `+`, `-`, `@`) and be correct in locale-sensitive cells.
- **Docs/code agreement:** `docs/build-guide/03-build-steps.md` acceptance boxes, `docs/data-dictionary.md`
  (`pnpm db:dictionary`), `docs/security/route-inventory.md`, OpenAPI output, `README.md` quickstart. Whatever
  you change, keep them true. Do not rewrite history in the docs; add dated notes.

## Part C: Experience and simplification (PROPOSE ONLY)

Goal: someone who has never seen the app and never read a manual should be able to finish their job in it
without help. Do this as real user research, not armchair opinion:

1. Run the app locally (`AUTH_MODE=dev`, synthetic data, `pnpm dev`) and drive it with the browser tools and
   Playwright, **once per role** (KAM, Sales leader, Engineering, EngLead, Production Scheduler, Pricing,
   PricingLead, Final Review approver, Finance, Admin, read-only/leadership). For each role, write down its top
   three jobs (from the PRD/build guide and `docs/uat/scripts`) and attempt them **cold**, using only what is
   on screen. Record every moment of hesitation: where you did not know what to do next, what a label meant,
   why a button was disabled, why a quote is where it is, what "provisional" or a gate name meant, where you
   had to leave the screen to find information.
2. Also review: first run and empty states, the Command Center ("My work" and "Analytics"), navigation and
   naming consistency (the same thing called two names; "Payback" vs "ROI"; gate vs stage vs step), the intake
   wizard (field order, required markers, error messages and the "Fix" links, what happens on a refused submit),
   multi-item flow, engineering/capacity, quoting steps, Final Review and the decision dialog (Advance / Send back
   / Hold / Stop wording), hold and send-back visibility, notifications (what the user is told, to do what, by
   when), the timeline and audit views, the Admin console, the "Report an issue" flow, error and permission-denied
   pages (do they say *why* and *who can*?), mobile at 390 px, keyboard-only use, screen-reader labels, color
   contrast and focus order (a full WCAG 2.2 AA pass beyond the existing axe checks: focus not obscured, target
  size, dialogs trap and return focus, status messages announced, no information by color alone, forms with
  labelled errors, 200% zoom and reflow, reduced motion), loading states and perceived speed, long-running
   actions with no feedback, destructive actions without confirmation or undo, and anything a user can do that
   silently does nothing.
3. Look for **redundancy and friction**: fields asked twice, data the app already has (Salesforce opportunity,
   customer, prior quotes, pricing history) that the user retypes, steps that could be merged or skipped for the
   common case, screens that show the same data three ways, settings nobody needs yet, jargon that needs a
   tooltip, defaults that could be smarter, places where "what happens next / who has the ball" is not shown.
   Check what is **missing**: a visible "next step" and owner on every quote, inline help at the point of need,
   a short role-aware first-run orientation, consistent status language, saved filters, bulk actions, search
   that finds a quote by any number a user knows (CCQ number, ERF, opportunity, customer, part).
4. Write `docs/audit/03-ux-proposals.md`. Each proposal is one block with a stable ID (`UX-001`, ...):
   **Problem** (what a first-time user hits, with the role, screen and a screenshot path under
   `docs/audit/screens/`), **Evidence** (what you did and saw), **Proposal**, **Impact** (H/M/L, how many roles),
   **Effort** (S/M/L), **Risk** (what could break or what rule it brushes against), **Changes behavior?**
   (copy/layout only vs workflow/data/permission), **Needs a business decision?** (if yes, which D-xxx), and an
   `Approve: [ ]` checkbox. Sort by impact over effort. Open with a one-page summary and a short "if you only
   do five" list. Keep proposals consistent with the locked decisions and `CLAUDE.md` (for example, a proposal
   may not hide a figure from a role, add local accounts, write back to Salesforce, or hard-code an open rule).
5. **Stop after writing the proposals and tell Ben they are ready.** Do not implement any UX proposal on your
   own. When Ben replies with the approved IDs (and any edits), implement **only those**, in their own commits
   (`feat(ux): UX-004 ...`), each with tests (a Playwright happy path where a flow changed) and an updated
   screenshot, and update the docs. If an approved item turns out to need a decision or a contract change,
   stop and ask about that item only.

## Part D: Release package (write and correct without asking; docs and scripts only)

The app being right is not enough: the people releasing and testing it need material that is right too.

1. **UAT and walkthrough accuracy.** `docs/uat/` (8 role scripts, quick-starts), `docs/walkthrough/`,
   `docs/gate/runbook.md`, `docs/gate/release-notes.md`, `docs/gate/test-results.md` were written before
   FB-15 to FB-20 reshaped intake, engineering, decisions, the Command Center, multi-item quotes and the offer
   letter. Walk each script step by step against the **current** UI (browser tools, dev auth) and correct every
   step, label, button name, screenshot and expected result that no longer matches. Add steps for features that
   have none (multi-item, offer letter, hold/send-back/Stop choices, Production Scheduler, Finance). Report any
   script step that cannot be completed because the app is wrong: that is a bug, fix it under Part A/B.
2. **Production release runbook** (`docs/audit/05-release-runbook.md`): pre-flight checklist (variables, Entra
   roles/groups present, Key Vault secrets, DB created, first Admin), the deploy steps in order with the
   expected output of each, post-deploy smoke checks (a concrete short list a human can do in 10 minutes), how to
   verify migrations applied, how to roll back (per Part A), who to call, and what *not* to do. Base it on the real
   workflows and Bicep, not on memory, and flag any step the pipeline cannot actually perform.
3. **First-week watchlist** (`docs/audit/06-first-week.md`): the specific logs, App Insights queries (write the
   KQL), alerts, DB queries (stuck quotes, jobs that did not run, failed notifications, audit gaps, slow
   endpoints, error rates by route) and business sanity checks someone should look at daily after go-live, with
   thresholds that mean "act".
4. **Admin and support guide** (`docs/audit/07-admin-support.md`, short): how an Admin adds a user/role, edits
   config safely, reads the audit trail, handles a stuck quote, imports pricing history, resolves a Salesforce
   sync problem, and triages a "Report an issue" ticket (`pnpm uat:defects`).
5. **Threat model** (`docs/audit/08-threat-model.md`, one to two pages): assets, trust boundaries, STRIDE per
   boundary, the control that answers each threat, and residual risk, drawn from what you verified in Part A.
6. Keep `README.md`, `docs/data-dictionary.md`, the route inventory and `03-build-steps.md` true to the code.

## Verification and finish

- Run the whole gate again (`pnpm verify`, plus `pnpm e2e`). It must be green. Compare with `00-baseline.md`:
  test counts must not go down (only up), bundle size and load-test p95 must not regress, and the migration
  chain must still apply cleanly from empty and from the previous release's data.
- Re-check the diff for accidental behavior changes: skim every non-test file you touched. If a refactor touched
  a rule engine, permission or RLS file, review it a second time with fresh eyes, then run the route × role
  matrix and the policy tests explicitly.
- Write the reports under `docs/audit/`:
  - `01-prod-readiness.md` (Part A): every area above with **Checked-OK / Fixed / Needs Ben**, evidence, and the
    commit that fixed each issue.
  - `02-code-audit.md` (Part B): findings by severity (Critical / High / Medium / Low), each with file:line, what
    was wrong, how it could fail in production, the fix and its test; a "behavior changes" list (should be short);
    efficiency results with before/after numbers; what you deliberately did **not** change and why.
  - `03-ux-proposals.md` (Part C) as above, updated with what was approved and implemented.
  - Part D documents `05` to `08` as listed there.
  - `04-needs-ben.md`: anything you could not or should not decide: judgment calls, open business decisions you
    tripped over, things that need Azure/Entra/Fabric access to verify, and risks you could not close.
- **Pre-mortem and independent re-check.** Before writing the go/no-go, write down the ten most likely reasons the
  production release fails or embarrasses us in its first week (write it as if it already happened), and for each
  say what evidence in this audit rules it in or out. Then run a **fresh review**: give new subagents only the
  diff and the architecture doc (not your conclusions) and ask them to find what you broke or missed, focused on
  the riskiest changes (anything in policy, RLS, the gate engine, migrations, jobs). Verify their claims yourself
  before acting on them.
- Open the PR (`claude/audit-prerelease` into `main`) with a summary that ends with a go / no-go statement for
  production: **what would still stop you from releasing today**, ranked, and what you would watch in the first
  week (alerts, logs, metrics to check).
- Be honest in every report. If something was not verified, say so. If a test is red, show the output. Do not
  claim a thing is fixed because the code looks right: show the test that proves it.

## Working style

- Plan the audit as a task list and keep it current. Work in the order: Phase 0, A, B, D, then C (C last because it ends by waiting for Ben; everything else is
  finished and committed by then, so he can review while he decides). Commit as you go so
  nothing is lost if the session ends; keep `docs/audit/` updated incrementally rather than at the end.
- Be skeptical of your own findings. Reproduce before fixing. Prefer a small, surgical fix with a test over a
  clever rewrite. When two fixes are possible, choose the one with the smaller blast radius.
- Rank by **likelihood x impact on day one in production**. A one-line fix for a crash on a common path beats ten
  tidy-ups. Spend the effort accordingly.
- If you hit a decision that is genuinely Ben's and cannot be defaulted (for example, a fix that changes
  a business rule), do not stall: record it in `04-needs-ben.md`, choose the safe default, and move on.
