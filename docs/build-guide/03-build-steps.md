# 03: Ordered Build Steps

Each step lists:
- **why** it's at this point in the order
- **who** you need, and the meeting that unblocks it (see `02-schedule-and-meetings.md`)
- **target date**
- **acceptance criteria** (tick them when done)
- the **starter prompt** to paste into Claude Code, found in `prompts/`

**How to run a step in Claude Code**

1. Start a fresh session in the repo root. Claude Code reads `CLAUDE.md` automatically.
2. Paste the contents of `docs/build-guide/prompts/B-xx-*.md`.
3. Let it plan first. Review the plan, then let it build.
4. Before merging, run `pnpm verify` (lint + typecheck + tests), open a PR, and let CI pass.
5. Tick the checklist below and note any deviations.

**Order logic**

```
Foundations           Intake & record         Stages                     Integrations & insight     Ship
B-00 → B-01 → B-02 → B-03 → B-04 → B-05 → B-06 → B-07 → B-08 → B-09 → B-10 → B-11 → B-12 → B-13 → B-14 → B-15 → B-16 → B-17 → B-18 → B-19 → B-21 → B-22 → B-23 → B-24
                                   └─ B-20 (Azure IaC + CD) runs in parallel from Oct 21, first deploy Oct 23
```

- **Domain and data first.** The stage engine, permissions and audit are the spine. Every screen after that is a thin view on top.
- **Integrations get a fake on day 1** (B-06, B-15, B-16), so access delays never block UI work. The real implementation is swapped in once access lands.

---

## Phase 0: Foundations (Oct 15–21)

### B-00: Repo, standing context, tickets · **Thu Oct 15** · Ben
- **Why first:** every later prompt depends on `CLAUDE.md` and this guide being in the repo.
- **People:** Tre (GitHub org), Raj Sharma / IT help desk (tickets in `02` §4).
- **Done when:**
  - [ ] `CLAUDE.md` and `docs/build-guide/` committed on a branch
  - [ ] IT tickets 1–7 filed
  - [ ] M1–M5 invites sent
  - [ ] repo transfer to the Pretium GitHub org requested
- **Prompt:** none (done by this guide).

### B-01: Monorepo scaffold, tooling, CI · **Fri Oct 16** · Ben
- **Why:** a working skeleton with CI keeps quality up while building fast.
- **People:** none (local). Docker Desktop and terminal access are needed (ticket 4).
- **Done when:**
  - [x] `pnpm dev` runs web + api
  - [x] `docker compose up db` works
  - [x] `pnpm verify` is green
  - [x] GitHub Actions CI is green on a PR ([#2](https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/2))
  - [x] `/api/v1/health` returns version + DB status
- **Prompt:** `prompts/B-01-monorepo-scaffold.md`
- **Done 2026-10-15. Notes and deviations:**
  - Versions: TypeScript 5.9 (typescript-eslint doesn't support TS 7 yet), ESLint 9, Vite 7, Vitest 4, Tailwind v4, React 18.3, Fastify 5.12, zod 4, Playwright 1.56.
  - `docker compose up -d db` was confirmed on 2026-10-15: the container reports healthy, and `db:migrate`, the integration tests and `pnpm dev` health (`db: up`) all pass against it. The first local checks ran on a native Postgres 16 while Docker Hub was rate-limited. The `mailpit` service wasn't pulled yet (still rate-limited); B-18 is its first user.
  - Workspace packages export TypeScript source (`exports: ./src/index.ts`). The API build (tsup) bundles them, and each package's `build` runs `tsc` only to prove it compiles.
  - Health returns **503** with `status: degraded, db: down` when Postgres is unreachable, so App Service health checks fail over correctly.
  - gitleaks runs as the CLI rather than `gitleaks-action`, so no license key is needed after the move to the Pretium GitHub org.
  - Swagger UI is at `/docs` outside production only.

### B-02: Domain core: stage/gate engine, policy, quote numbers · **Fri Oct 16 – Mon Oct 19** · Ben
- **Why:** this is where the business rules live. Building it pure and tested first makes every later route a thin wrapper.
- **People:** none. The hybrid seed comes from `01-architecture.md` §4.
- **Done when:**
  - [x] `packages/domain` has the workflow engine (transition validation, gate outcomes, required-field rules, return/requote paths, hold accounting)
  - [x] the permission policy and redaction are in place
  - [x] the scoring engine interface exists (implemented in B-08)
  - [x] ≥ 95% line coverage (100% lines)
  - [x] no I/O imports (ESLint `no-restricted-imports`, plus a ban on reading the clock)
  - **Deviations / notes:** added the dev dependency `@vitest/coverage-v8` (needed for `--coverage`) alongside `zod`. `WorkflowConfig` also carries `reasonCodes[]` and `segregation[]`, and requests take an optional `targetStageKey` for return/re-quote. The hybrid seed adds a `SUBMIT` gate for the `g1_enabled=false` path. See `packages/domain/README.md` for the seed assumptions (Stop → CLOSED_LOST, G2 capital-required routing, how a hold resumes), all provisional.
- **Prompt:** `prompts/B-02-domain-core.md`

### B-03: Database schema, RLS, config seeds, synthetic data · **Mon Oct 19** · Ben
- **Why:** persists the domain. Config seeds make open business decisions editable data instead of code.
- **People:** none to start. Value lists are refined after M4 (Jim, Danielle).
- **Done when:**
  - [x] all tables in `01-architecture.md` §5 exist as migrations
  - [x] RLS policies are in place, with `audit_event` insert-only for the app role
  - [x] seeds exist for the hybrid workflow, reason codes, value lists (from the ERF template: 8 processes, 11 resins, 8 markets, ~29 plants) and scoring model v1, all `provisional`
  - [x] the synthetic generator creates 150 quotes across all stages from 102 masked fake opportunities
- **Prompt:** `prompts/B-03-database-and-seeds.md`
- **Done 2026-10-15. Notes and deviations:**
  - Acceptance from the prompt: `pnpm db:reset` works from scratch and a seed re-run is a no-op; RLS tests pass, including a raw-SQL read by an owner-scoped KAM and a login that is only a `ccq_app` member; `audit_event` UPDATE/DELETE/TRUNCATE fail for `ccq_app` (and a trigger blocks them for the owner too); the 50-parallel-call quote-number test passes; `docs/data-dictionary.md` is generated (`pnpm db:dictionary`), and a unit test fails when it is stale. See `packages/db/README.md`.
  - **Tables added beyond §5:** `quote_hold` (hold intervals for CR-57; the engine's `hold` effect needs somewhere to live), `segregation_rule` (the domain config's `segregation[]`, so the DB carries the whole workflow) and `quote_number_counter` (behind `next_quote_number()`).
  - **Columns added beyond §5:** `quote.region` (RLS region scope), `quote.review_date` (G5 On hold needs it), `quote.queue_position` (the queue override field), `quote.packaging_type` (value list), `stage_history.quote_version`, `gate_decision.target_stage_key/quote_version/payload` (from the domain's decision record), `override.reason_code/decision_note`, `value_list.meta` (e.g. `{freeText: true}` on neck finish Other), `reason_code.requires_note`, `role_permission.qualifier` (own / assigned / fields / stages grants), `sf_opportunity_snapshot.account_name`, `app_user.region`.
  - `scoring_model` uses `model_version` for the model's own version, because `version` is the shared config-row version column.
  - `created_by` on every table is a nullable FK to `app_user` (`on delete set null`), null for seeds and jobs.
  - **Domain changes:** reason codes gain `requiresNote` (default false), enforced by `evaluateTransition`, so "Lost / Other (note required)" works. The Lost list is now the B-03 list (Price, Lead time, Capability, Capacity, Customer cancelled, Competitor relationship, Other). The `owner` scope now also matches an Engineer's assigned quotes, the same as RLS.
  - `next_quote_number()` uses the **US Central** calendar year, so a quote at 11 pm on Dec 31 Central gets the old year. It is gap-free because a rolled-back caller's number is reused.
  - Extra `app_setting`: `default_scope_type = 'all'` (B-04 needs a setting-backed default scope). Extra provisional value list: `machine_type` (7 placeholders, TODO M4). Plants are 3 placeholders and resins/markets carry TODO(M4) comments.
  - The DB package's integration tests use their own database (`<TEST_DATABASE_URL>_db`), so they never race the API's on `ccq_test` when turbo runs both.
  - Azure (B-20): allow-list `pg_trgm`; grant `ccq_app` / `ccq_migrator` membership to the managed identities; the runtime login must not be a superuser (superusers bypass RLS).

### B-04: Authentication and server-side RBAC (F-01, F-09) · **Tue Oct 20** · Ben
- **Why:** everything after this assumes a known user, roles and scope.
- **People:** **M2 (Mon Oct 19)**, Vincent Brown / IT identity. They provide the app registrations, app roles and groups. Until then, `AUTH_MODE=dev`.
- **Done when:**
  - [ ] MSAL sign-in works against Entra (test tenant config). **Blocked on M2:** the MSAL code path is built and the signed-out page is covered by the Playwright smoke; flip `AUTH_MODE=entra` and fill the `ENTRA_*` values when IT delivers the app registrations.
  - [x] the API validates JWTs, maps `roles` to permissions, and upserts `app_user` on first call
  - [x] the request context sets the Postgres `app.user_id` / `app.roles` per transaction
  - [x] the permission-matrix test harness exists
  - [x] dev mode can't start in production
- **Prompt:** `prompts/B-04-auth-rbac.md`
- **Done 2026-10-15 (Entra sign-in pending M2). Notes and deviations:**
  - Prompt acceptance: dev mode and the persona switcher work (checked in Chromium at 390 px against a seeded database). Expired, wrong-audience, wrong-issuer, wrong-key, missing-scope and no-role tokens are rejected, unit-tested with locally signed JWTs and a local JWKS (`apps/api/src/auth/entra.test.ts`). Boot fails when an `/api` route has no `permission` / `public` (`server.ts` calls `app.ready()` before `listen`). The permission matrix runs in CI as an integration test (`apps/api/test/permissions/`).
  - **Ask IT at M2:** set `accessTokenAcceptedVersion: 2` on the API registration (the API only accepts the v2 issuer `https://login.microsoftonline.com/{tenant}/v2.0`); expose the `access_as_user` delegated scope and pre-authorise the SPA client; register the SPA redirect URIs as each app origin (`http://localhost:5173`, the test URL, prod URL) on the **SPA** platform; define the eight `CCQ.*` app roles on the API registration and assign the SG-CCQ groups to them.
  - v2 tokens carry the API **client id** as `aud`, so `ENTRA_API_CLIENT_ID` is accepted as an audience alongside `ENTRA_API_AUDIENCE`. New config: `ENTRA_SPA_CLIENT_ID` (required for entra), `ENTRA_API_CLIENT_ID`, `ENTRA_API_SCOPE` (default `access_as_user`).
  - New public route `GET /api/v1/auth/config` gives the SPA its MSAL settings at runtime (or the dev personas), so one web build works in every environment.
  - The route-level check runs in the `onRequest` hook, not a `preHandler`: an unauthorised caller gets 403 before body parsing and validation, so a 400 never leaks the schema. It uses a new domain helper `holdsPermission` (any grant, qualified ones included), because `assertCan` without a resource denies qualified grants (a KAM's `outcome.record (own)`). Services still call `assertCan(actor, permission, resource)`.
  - `/me` uses the pseudo-permission `authenticated` (any signed-in user with a CCQ role). The startup check covers `/api/*` routes; swagger UI and the SPA are plugin routes with no data.
  - Route checks read the code matrix (`packages/domain/src/policy/matrix.ts`), not the `role_permission` table. Moving to the table is B-19 (admin config) work.
  - `featureFlags` in `/me` are the boolean `app_setting` rows, camelCased (`g1Enabled`, `kamCanSeePeerScores`).
  - Default scope: a user with no `user_scope` row gets `default_scope_type` (`all`; `owner` also allowed; anything else falls back to `all`). Dev personas get their persona scope written on first use.
  - Sign-in audit: one `sign_in` row per user per 8 hours, checked against `audit_event` so it holds across App Service instances. Deactivated users (`app_user.active = false`) get 403.
  - `packages/db`: new `withAppRole()` (provisioning runs as `ccq_app` before the user id is known), `hasAuditSince()`, and a `./personas` export. The synthetic seed now adopts a persona row that dev mode already provisioned (same oid, different id) instead of failing on the FK.
  - The Playwright smoke now checks the signed-out experience (sign-in page, `/me` 401, dev header refused in production) instead of the health card, which now sits behind sign-in.

### B-05: App shell, Pretium design system, role landing (F-02 shell, F-14) · **Wed Oct 21** · Ben
- **Why:** a consistent shell and components make every feature screen fast to build.
- **People:** none. Pretium tokens come from the blueprint and the `pretium-design` skill. Bailey's prototype screenshots are a follow-up she owes from 10/14.
- **Done when:**
  - [x] responsive layout (390 px → desktop)
  - [x] role-aware navigation
  - [x] landing route per role (placeholders filled in by B-17)
  - [x] theme tokens, dark mode, toast/error boundary
  - [x] `<RequirePermission>` component
  - [x] Playwright smoke test passes
- **Prompt:** `prompts/B-05-shell-design-system.md`
- **Done 2026-10-15. Notes and deviations:**
  - Prompt acceptance: all 12 dev personas land on the right dashboard with the right nav (`apps/web/e2e/shell.spec.ts`). axe (WCAG 2.1 A/AA) reports no serious or critical violations on the landing, the user menu, 404/403 and the `/admin/ui-kit` reference page, in light and dark, desktop and 390 × 844 (`a11y.spec.ts`, `mobile.spec.ts`). At 390 px there is no horizontal scroll, the gutters are 16 px and every header, nav and main tap target is ≥ 44 px.
  - **Contrast deviations from the blueprint:** the High tier chip text `#B04A2C` on `#F6E5E0` is 4.45:1, so it uses copper-hover `#A64427` (4.95:1). Copper `#C05131` as *text* on the page background is 4.37:1, so copper text is `#A64427` in light mode (`#EC8A66` in dark). `#C05131` stays for fills with white text (4.71:1) and the focus ring. On the green header the focus ring is light copper `#F2B8A2` (copper on green is under 3:1). Dark-mode tier chips have their own contrast-checked colours. All values are in `apps/web/src/styles/tokens.css`.
  - **Fonts:** no licensed Value Serif Pro / Basis Grotesque Pro files yet, so the Georgia / Arial fallbacks render. Drop the files in `apps/web/public/fonts` and add `@font-face` in `tokens.css` once Pretium provides them.
  - **Nav is permission-driven** (from `/me`, the same check as `useCan`), so it follows the matrix rather than role names. Admin sees *New intake* because the matrix grants Admin `quote.create`. *My queue* is one item labelled per role: *Engineering queue* (`queue.assign`, EngLead), *My assignments* (`engReview.edit` only, Engineer) and *Pricing queue*. For the Approver, the queue *is* Approvals, so it isn't listed twice. Admin's `queue.assign` doesn't add a queue tab; the tab needs `engReview.edit`.
  - **Primary role for multi-role users:** Approver → EngLead → Pricing → Engineer → SalesLeader → KAM → Leadership → Admin (most time-critical work first). Multi-role users get role tabs on the landing (`/?as=SalesLeader`). This is UI ordering, not a business rule.
  - Mobile is ≤ 640 px (`sm` moved to 641 px). The bottom bar shows up to five tabs; beyond that the fifth becomes *More*.
  - `GET /api/v1/config/public` (`quote.read`) returns stages, gates, outcomes, active reason codes, active value lists, tier thresholds and an allow-list of UI settings (`PUBLIC_SETTING_KEYS` in `packages/contracts`; `default_scope_type` stays server-side). Cached 5 min in TanStack Query (`usePublicConfig`). Added to the permission registry, with integration tests.
  - Global error routing (`lib/query-client.ts`): 5xx and network failures raise a de-duplicated toast; 4xx stay inline (`<ErrorState>`) and are not retried. Toasts use a small in-house store instead of a library: sonner injects `<style>` tags, which the `style-src 'self'` CSP blocks.
  - The theme is applied before first paint by `public/theme-init.js` (a file, because the CSP forbids inline scripts). The preference is in `localStorage['ccq.theme']`, wrapped in try/catch; `system` clears it.
  - **Mobile snapshot:** a structural ARIA snapshot (`toMatchAriaSnapshot`) is asserted, and the full-page 390 × 844 PNG is attached to the Playwright report. A pixel `toHaveScreenshot` baseline was not used, because font rendering differs between dev machines and the CI runner and would make it flaky.
  - Playwright now runs three projects: `smoke` (production API, Entra), and `shell` / `mobile` (`vite preview` of the same build, proxied to an `AUTH_MODE=dev` API on :3101). CI seeds config before e2e.
  - Added `/admin/ui-kit` (Admin only): every shared component with synthetic data and live config labels. axe scans it in both themes.
  - Found while testing in the browser and fixed: `Button` must `forwardRef` (React 18), or Radix `asChild` triggers can't position popovers (the Filters popover rendered off-screen). Dialogs opened from state now return focus to the element that opened them; Radix only does this for its own `Trigger`. Both have Playwright regression tests.
  - New deps: `radix-ui`, `@tanstack/react-table` 8.21.3 (v9 changed the API), `lucide-react`, `@axe-core/playwright`. Vendor code is split into cacheable chunks (msal, radix, tanstack, zod, vendor).

### B-20: Azure infrastructure as code and continuous delivery · **Wed Oct 21 (code) → Fri Oct 23 (first deploy)** · Ben + IT
- **Why:** an early deploy surfaces network, identity and policy problems while there's still time to fix them.
- **People:**
  - **M1 (Oct 16)** for approval
  - **M2 (Oct 19)** for the resource group, OIDC and the review
  - Tim Webb / Chris O'Brien (IT infra) to run or approve the deployment
- **Done when:**
  - [ ] Bicep for App Service (+ staging slot in prod), PostgreSQL Flexible (private endpoint, Entra auth), Key Vault, App Insights, VNet, managed identity
  - [ ] `deploy.yml` deploys `main` to test via OIDC
  - [ ] the DB migrates on deploy
  - [ ] smoke test passes against the test URL
- **Prompt:** `prompts/B-20-azure-iac-cd.md`

---

## Phase 1: Intake and the core record (Oct 22–27)

### B-06: Salesforce read connector (F-10) · **Thu Oct 22** · Ben
- **Why:** every quote starts from a Salesforce opportunity (DEC-12). Intake can't be built without the opportunity picker.
- **People:** **M3 (Mon Oct 19)**:
  - Rachel Dew: connected app and integration user on the UAT org
  - Zac Cairns + Graham Parle: field crosswalk and ERF-number field
- **Done when:**
  - [x] the `SalesforceReader` interface has fake and jsforce implementations
  - [x] delta sync job (15 min, advisory lock) fills `sf_opportunity_snapshot` and `customer`
  - [x] live search endpoint for the intake picker
  - [x] ERF number + quote source captured
  - [x] `integration_run` logged
  - [ ] works against the UAT org: **not yet verified.** Waiting on the connected app, integration user and key from Rachel Dew. Then run `SF_LIVE_TEST=1 pnpm --filter @ccq/integrations test` and set `SF_MODE=live`.
- **Prompt:** `prompts/B-06-salesforce-reader.md`
- **Built 2026-10-15. Notes and deviations:**
  - **Custom-field API names confirmed at M3: none yet.** Every custom name in `packages/integrations/src/salesforce/fieldMap.ts` is a placeholder marked `TODO(M3)`, for Zac Cairns / Graham Parle to confirm:
    - Opportunity: `ERF_Number__c`, `Quote_Source__c`
    - the product spec object `Opportunity_Product_Specification__c`, with the fields `Opportunity__c`, `Product_Type__c`, `Resin__c`, `Capacity__c`, `Neck_Finish__c`, `Color__c` and `Annual_Volume__c`
    - ship-to: the standard Account `Shipping*` address for now
  - The live reader describes each object once per session. If a mapped custom field is missing from the org, it drops the field from the SOQL and logs its name (never data), so a wrong placeholder maps to `null` instead of breaking every query. The live contract test (`contract.live.test.ts`, skipped unless `SF_LIVE_TEST=1`) fails until every mapped field resolves. Run it after the crosswalk lands.
  - **Read-only is enforced three ways:**
    - the reader interface has no write methods
    - an ESLint `no-restricted-syntax` rule in `packages/integrations/eslint.config.js` bans the jsforce write calls (`create`, `insert`, `update`, `upsert`, `destroy`, `del`, `delete`, `bulk`, `apex`, `requestPost`, …) and any `POST`/`PUT`/`PATCH`/`DELETE` outside the JWT token exchange
    - `readonly.test.ts` greps the connector for the same calls
  - **JWT bearer flow:** an RS256 assertion is signed with `node:crypto` (PKCS#1 or PKCS#8 PEM) and exchanged at `{SF_LOGIN_URL}/services/oauth2/token`; jsforce v3 (3.10.28) then queries with that session. In Azure, `SF_PRIVATE_KEY` is an App Service Key Vault reference, so there's no Key Vault SDK in the app. The API refuses to boot with `SF_MODE=live` and no client id, username or key. On an expired session the reader logs in again once.
  - **Calls:** SOQL with explicit field lists, `queryMore` paging, a 20 s timeout per call, and up to 3 retries with exponential backoff and jitter on `REQUEST_LIMIT_EXCEEDED`, 5xx, timeouts and network resets. Deleted records come from `getDeleted`, clamped to SF's ~30-day window.
  - **Fake:** `FakeSalesforceReader` serves `fixtures/synthetic.json`, generated from the B-03 generator (`pnpm db:sf-fixture`). It has the same 102 opportunity ids, names, accounts and owners as `db:seed --synthetic`, so a sync over a seeded database updates the seeded snapshots and quotes stay linked. A unit test fails if the fixture is stale. The fixture adds the discovery messiness: ERF numbers in 4 formats on ~40 %, inconsistent quote-source labels, a $0.31 placeholder, blank and $1 amounts, opportunities with no account, ship-to countries spelt 3 ways, product specs, and 1 deleted opportunity.
  - **Suspect amounts:** the < $100 threshold is a config setting, `sf_amount_suspect_below_usd` (seed 100, provisional), not code. The mapper raises `dataQuality` flags (`amount_missing`, `amount_suspect`, `account_missing`, `owner_missing`, `close_date_missing`). They are stored on the snapshot and returned by the API; nothing is blocked on them.
  - **Sync job** (`apps/api/src/jobs/sfSync.ts`):
    - Started by `server.ts` after `listen` (never in tests). The first run is 10 s after boot, then every `SF_SYNC_INTERVAL_MINUTES` (default 15).
    - `pg_try_advisory_lock` runs on a reserved connection (`withAdvisoryLock`), and triggers within one process are coalesced.
    - The watermark is the start of the last **succeeded** run minus a 5-minute overlap. Upserts skip rows whose `SystemModstamp` hasn't changed, so the overlap and re-runs are idempotent. A `partial` or `failed` run doesn't move the watermark.
    - Customers are upserted by SF account id. Status and source are kept on existing rows, so a synthetic row stays synthetic.
    - The job runs as a system context (`withSystemContext`: `ccq_app`, Admin role, `all` scope, a fixed non-user id) so RLS still applies.
    - On failure it marks the run `failed` with a data-free error code, sends an in-app `integration.failed` notification to each active Admin, and logs the code. It never throws.
  - **Closed or deleted in SF:**
    - The new column `quote.sf_status_flag` (`closed_won` | `closed_lost` | `deleted`, plus `sf_status_flagged_at`) is recomputed from the snapshot on every run, so a reopened opportunity clears it.
    - Each change writes an `activity_event` (`sf_status_changed`, actor null).
    - Snapshots are never deleted; `deleted_in_sf_at` is set instead.
  - **Migration 0005** (`sf_reader`, Drizzle-generated):
    - `sf_opportunity_snapshot` gains `owner_name`, `is_closed`, `is_won`, `system_modstamp`, `deleted_in_sf_at` and `data_quality`, plus a trigram index on `account_name` and an index on `owner_email`
    - `quote` gains `sf_status_flag` (with a CHECK) and `sf_status_flagged_at`
  - **Ship-to shape** is `{ line1, city, state, postal, country }`. The synthetic seed and the `customer.default_ship_to` comment used `region` for the state, and were renamed to match.
  - **Routes**, all in the permission-matrix registry:
    - `GET /salesforce/opportunities` (`quote.create`): pg_trgm snapshot search, where every term must match the name or account by substring or `<%` word similarity, so "pakaging" still matches. It falls back to SF live under 5 hits. If the live search fails, it still returns the snapshot hits with `liveError`. `mine=true` matches the caller's email, UPN, or UPN local part (as an alias) to the SF owner.
    - `GET /salesforce/opportunities/:id` (`quote.read`): snapshot plus a live read with product specs, cached 60 s per id. A fresh live read refreshes the snapshot. If SF is down it falls back to the snapshot with `liveError`, and reports `deletedInSf`. It includes the `sf_stage_map` CCQ stage hint.
    - `POST /admin/salesforce/sync`, `GET /admin/integrations` and `GET /admin/reports/erf-linkage`: all `config.manage`, matching the Admin-only `/admin` UI. The sync answers `202 running` if it takes longer than 25 s.
  - **ERF linkage report:** ERF numbers are compared ignoring case, punctuation and an "ERF" prefix (`ERF-2026-00042` = `erf#202600042`). Each quote is classified `match` | `mismatch` | `sf_only` | `ccq_only` | `both_missing`, with summary counts and `sfLinkedPct`. On the synthetic data, 37 % of quotes' SF opportunities carry an ERF number.
  - **Web:**
    - `/admin/integrations`: the runs table and a *Sync Salesforce now* button
    - `/admin/reports/erf-linkage`: summary tiles and the table
    - Both reuse `DataTable`, so rows become cards at ≤ 640 px. A Playwright spec covers the sync and Admin-only access, and runs axe in both themes.
    - The intake picker UI itself is B-07.
  - **Logging:** ids, counts, field names and error codes only. `sfErrorCode` never uses error messages (SF and Postgres messages can echo record data), and maps DB errors to `DB_<SQLSTATE>`.

### B-07: Guided intake wizard (F-03) · **Fri Oct 23** · Ben
- **Why:** intake quality is the #1 engineering constraint (DF-11, DF-18). This is the KAM's first impression.
- **People:**
  - **M4 (Tue Oct 20)**: Jim Zweifel, Danielle Leu, a sales leader and Jordan Albin validate the field set
  - **R1 (Fri Oct 23)**: KAM review
- **Done when:**
  - [x] 4-step wizard: Opportunity → Customer & ship-to → Product & volume → Drawing & notes / review
  - [x] only Sales-knowable fields; no plant, process, machine, capital, engineer or priority
  - [x] existing vs not-yet-established customer
  - [x] ship-to auto-fills and can be overridden with a reason
  - [x] the drawing prompt never blocks
  - [x] drafts autosave
  - [x] submit creates `CCQ-2026-NNNNN` in Intake with an audit trail
  - [x] mobile usable
  - [ ] R1 KAM review (Fri Oct 23)
- **Prompt:** `prompts/B-07-intake-wizard.md`
- **Built 2026-10-16. Notes and deviations:**
  - **Field set (provisional, pending the M4 sign-off by Danielle Leu and Jim Zweifel, D-05 / CR-08).** M4 has not confirmed a final list yet, so this is the seed set, all config:
    - Step 1: SF opportunity (picker over `GET /salesforce/opportunities`, Mine/All).
    - Step 2: customer (existing from the SF Account, or not yet established: name, location, contact name/email/phone), ship-to / fill location (default from the account; changing it needs a reason).
    - Step 3: request class (default `CCQ`), product family, container size, resin, market, components (multi), neck finish/type (+ free text for *Other*), packaging type, packaging requirements, estimated annual volume, estimated annual revenue (pre-filled from the SF amount, original kept), expected close date (from SF), standard description (suggested from the template) and free-text description.
    - Step 4: drawing status, a disabled upload placeholder (B-16), comments for engineering, full review with *Edit* per section.
    - **Blocking** (`intake_required_fields`, required-field DSL): SF opportunity, customer name, ship-to (street or city), product family, resin, estimated annual volume. Everything else that is blank is an amber *"Engineering may ask about this"*, never an error.
  - **New settings** (all provisional, in `PUBLIC_SETTING_KEYS`): `intake_required_fields`, `intake_volume_placeholder` (`{values: [1000000], roundMultiple: 1000000}`: soft confirm), `intake_default_request_class`, `intake_description_template` (`{container_size} {product_family}[, {resin}][ with {components}]`), `intake_field_help` (one-line "why we ask" per field, feeds P1 F-19) and `salesforce_new_opportunity_url`. `drawing_status` `HAVE_DRAWING` carries `meta.hasDrawing` (the drawing nudge is silent for it).
  - **Domain** (`packages/domain/src/intake`): `evaluateIntake` returns blocking vs warnings (`MISSING_FIELD`, `INVALID_VALUE`, `SHIP_TO_REASON_REQUIRED` / `VOLUME_PLACEHOLDER`, `DRAWING_MISSING`, `REQUEST_CLASS_REDIRECT`, `ENRICH`) and `renderDescriptionTemplate`. The draft → snake_case mapping is `intakeValues` in `packages/contracts/src/intake.ts`, shared by the API and the wizard: the wizard evaluates locally for instant feedback, and the API evaluates again inside the submit transaction (the authority).
  - **Drafts are their own table, `quote_draft`** (migration 0006), because `quote.quote_number` is NOT NULL and the number is issued at submit. RLS: the creator, plus Admin (read). Admin can list and open others' drafts but not change, submit or delete them. A submitted draft is kept, linked to its quote, and is read-only. Autosave PATCHes are **not** audited (every 5 s); draft create and delete are, and submit writes the quote's `create` audit row.
  - **One active quote per SF opportunity:** unique partial index `quote_one_active_per_opportunity_uidx` on `quote(sf_opportunity_id) where status <> 'closed'`. The service returns 409 `active_quote_exists` (with the quote number when the caller can see it), and a race that reaches the index is mapped to the same 409. The SF search response gained `activeQuote` per item, so the picker offers *Open existing*.
  - **Submit** (`POST /quotes/drafts/:id/submit`): makes sure the opportunity is in the snapshot (live read under the caller's context), links or records the customer, inserts the quote in `INTAKE` with `submitted_at`, writes `stage_history`, `activity_event` (`quote_created`, plus `ship_to_overridden`) and `audit_event`, calls the scoring hook (`scoring: null` until B-08, so the score stays null) and routes through the domain: when G1 is disabled the KAM's `SUBMIT` gate is applied (`evaluateTransition` + `persistTransition`, so it lands in `ENG_REVIEW` with a gate decision); otherwise it waits in `INTAKE` for G1. The EngLead arrival alert is still TODO(B-10/B-18). Routing reads the gate rows, not the `g1_enabled` setting; keeping the two in step is B-19's job.
  - **Ship-to override until B-09:** stored on the quote (`ship_to_original`, `ship_to_override_reason`, `ship_to_overridden`) plus a `ship_to_overridden` activity event. B-09 should migrate these into `override` rows.
  - **New columns:** `quote.ship_to_original`, `ship_to_override_reason`, `est_annual_revenue_sf`, `est_annual_volume_confirmed`, `submitted_at`; `customer.location`, `customer.contact`. The data dictionary is regenerated.
  - **Synthetic seed rebalanced** so the unique index holds: still 150 quotes, but 80 active (INTAKE 12, ENG_REVIEW 22, QUOTING 18, FINAL_REVIEW 10, CUSTOMER_DECISION 18) on 80 distinct opportunities, and 70 closed (AWARDED 22, CLOSED_LOST 18, DECLINED 8, EXPIRED 12, REDIRECTED 10). Closed quotes reuse only the spare open opportunities, which leaves ~22 open opportunities free for new intakes in the demo. Existing local databases need `pnpm db:reset` (migration 0006 fails on a database seeded with the old generator). Two sfSync integration tests now pick single-quote opportunities.
  - **Web:** `/intake/new` (start screen with *Continue a draft* and the picker) and `/intake/new?draft=<id>` (resume). Autosave every 5 s, on every step change, and on leaving the page. react-hook-form was **not** used: the wizard is one draft object saved as a whole, so plain controlled state was simpler; no new dependency. `@ccq/domain` moved from the web app's dev dependencies to its dependencies (it now runs in the browser).
  - **Tests:** domain unit tests (100% lines); DB RLS tests for `quote_draft` and the unique index; API integration tests for create, autosave, resume, submit, 409, 422, required-field config, placeholder volume, drawing warning, ship-to reason, not-yet-established customer, draft visibility and G1-disabled routing; the six routes are in the permission-matrix registry; Playwright `intake.spec.ts` (desktop flow with a reload/resume and a submit without a drawing, ship-to reason, and the full flow at 390 × 844 with no horizontal scroll; axe on the review step). The desktop flow takes a few seconds, well inside the 3-minute target.

### B-08: Prioritization engine + G1 qualification (F-05, CR-10/11) · **Mon Oct 26** · Ben
- **Why:** engineering needs a ranked queue, and leadership wants a qualify decision before engineering spends effort.
- **People:** M4 outcome (attribute set, interim G1 decider). The Knowledge Steward (unassigned) eventually owns the weights; until then Bailey approves the provisional weights.
- **Done when:**
  - [x] scoring model v1 is config-driven: 7 PRD attributes, each mapped to 0–100 through bands, weighted, with tiers Low / Standard / High / Critical
  - [x] the score explanation breakdown shows in the UI
  - [x] the score recalculates when inputs change and records the model version
  - [x] min value/volume **warnings**
  - [x] G1 decision screen for the SalesLeader with Advance / Hold / Rework / Redirect / Stop, reason codes and note rules
  - [x] G1 can be disabled by config
- **Prompt:** `prompts/B-08-scoring-and-g1.md`
- **Built 2026-10-16, ahead of M4. Notes and deviations:**
  - **Not yet confirmed at M4 (Oct 23).** The attribute set and weights (D-19) and the G1 decider (D-06) ship as the provisional seeds listed in `04-decisions-and-risks.md` §2 ("Provisional choices B-08 shipped"). Update this note after M4. If M4 changes them, it is a config change: a new `scoring_model` version, or `role_permission` / gate rows.
  - **Scoring engine** (`packages/domain/src/scoring/`): `parseScoringModel` (weights must sum to 1; bands, maps and tiers are validated), `score(model, facts, now)` → `{ total, tier, tierLabel, modelVersion, breakdown[], unknowns[] }`, `redactScore`, `qualificationWarnings`, `exceptionNoteErrors` and `canSeePriorityScore`. Attribute inputs go through the `INPUT_RESOLVERS` registry (`map` and `days_to_close`). Any other `input` is a numeric fact path such as `eng_review.prelim_capital_usd`. A test configures the 10/14 prototype set as v2 with no code change. Ten fixture quotes are snapshot-tested.
  - **Stored explanation:** migration 0007 adds `quote.priority_breakdown` and `quote.priority_scored_at`. The breakdown is stored with the score, so the "Why?" table always adds up to the stored total. Timing depends on today's date, so a score is "as of" its `priority_scored_at`. A scheduled rescore is not built (follow-up if leadership wants timing to tick daily). Tier keys are now `CRITICAL / HIGH / STANDARD / LOW`, with labels in the model. Public config `tiers[]` gained `label`.
  - **Recalculation:** on submit and resubmit, after every gate decision (covers the G2 capital estimate), and through `ScoringService.recalculate` for B-10's engineering-review edits. A change of computed tier writes `priority_tier_changed`. With `priority_tier_overridden` (B-09), the score and computed tier update but the displayed tier stays.
  - **Redaction:** with `kam_can_see_peer_scores=false`, a KAM-only user gets `priority.visible=false` and nulls for other KAMs' quotes (server-side). The capital figure behind *Capital exposure* is a commercial field: roles without `quote.read.commercialFields` get its points but `raw: null`.
  - **Generic gate route + service** (documented in `01-architecture.md` §4.1, "Gate decision API"). The route floor is `quote.read`. The domain enforces the gate's decider permission, so "only SalesLeader decides G1" is an integration test over all 8 roles rather than a matrix-registry row. Notifications go through a `NotificationHook` that only logs until B-18.
  - **Rework = back to the KAM's drafts:** the Rework transition re-enters INTAKE and clears `submitted_at`, and G1 now requires `submitted_at` (a gate rule), so a returned quote leaves the queue until it is resubmitted. The KAM opens a **rework draft** (`POST /quotes/:quoteNumber/rework`, migration 0007 `quote_draft.rework_of_quote_id`, at most one open per quote). It is pre-filled from the last submitted intake (or rebuilt from the quote), and submitting it updates the **same** quote and number (`quote_resubmitted`). `GET /quotes/drafts` gained `returned[]`. The quote page and the wizard show the reason and note.
  - **Domain seed changes:** G1 Stop now closes as **DECLINED** (`closeAs: declined`). Before, every Stop was CLOSED_LOST; G2/G3 Stop still is. Hold needs a reason code + review date. Rework needs a reason code + note. Stop needs a reason code + note. The synthetic seed was adjusted to match (the two G1 stops are now in the DECLINED count; the stage totals are unchanged), and every synthetic quote is scored by the real engine.
  - **Quote read:** `GET /api/v1/quotes/:quoteNumber` (audited as `view`) and the quote detail page (intake, priority explanation, decisions, rework banner) replace the B-05 stub. The full timeline and overrides stay B-09.
  - **Web:** `/approvals?gate=G1` "To qualify" (nav item for `gate.G1.decide`, hidden when the G1 gate is disabled), `GateDecisionDialog` rebuilt on `availableActions` (the UI-kit demo of it was removed; `g1.spec.ts` now covers its axe scan, validation and focus return), `PriorityBadge` / `ScoreBreakdownTable` / `QualificationWarnings`.
  - **Tests:** domain 100% lines (scoring snapshots, validation, unknowns, prototype v2, G1 rules). API `gates.int.test.ts`: all 5 outcomes and their constraints through the generic route, the 8-role decider check, segregation, evidence/history/activity/audit/notification, rework round-trip with rescore, warnings + exception note, peer-score and commercial redaction, and `g1_enabled=false`. Playwright `g1.spec.ts`: a SalesLeader qualifies one quote and redirects another, and the rework banner reaches the KAM.

### B-09: Governed overrides, activity timeline, usage audit (F-06, F-08, F-12) · **Tue Oct 27** · Ben
- **Why:** these are cross-cutting controls used by every later stage. Building them once means later stages just call them.
- **People:** a decision on who approves overrides (blueprint gap). Interim: SalesLeader for priority, EngLead for queue position. Confirm in R1.
- **Done when:**
  - [x] generic override service: request → approve/reject → apply → one-click revert; the original value is preserved and a justification is required
  - [x] priority tier and ship-to wired up
  - [x] the timeline on quote detail shows stage changes, gate decisions, overrides, uploads and comments
  - [x] every quote view and export writes an `audit_event`
  - [x] the override log is visible to Leadership/Admin only
- **Prompt:** `prompts/B-09-overrides-timeline-audit.md`
- **Built 2026-10-16, ahead of R1. Notes and deviations:**
  - **Who approves overrides is NOT yet confirmed (D-OA, blueprint gap; confirm in R1).** It ships as the provisional `app_setting.overridable_fields` listed in `04-decisions-and-risks.md` §2 ("Provisional choices B-09 shipped"): SalesLeader or EngLead approve the priority tier; the KAM self-applies a ship-to on their own quotes (logged); the EngLead pins the queue position. Changing who approves, or adding a field's approval step, is a settings change (an integration test proves it). Update this note after R1.
  - **Domain** (`packages/domain/src/overrides/`): `parseOverrideSettings`, the value kinds (`OVERRIDE_VALUE_KINDS`: tier key of the model in effect, normalized address, queue position ≥ 1), structural value equality, and `planOverrideRequest` / `planOverrideDecision` / `planOverrideRevert` / `overrideActions`. An approver needs a configured approver role **and** `override.approve` for the field (matrix); nobody decides their own request (SEGREGATION); a reject needs a note; approving a request whose field no longer holds `original_value` is `STALE_VALUE` → **409**, and so is reverting when the field no longer holds the applied value (undo the later change first). Also `comments/` (sanitize, markdown-lite tokens, mentions) and `timeline/` (filter categories). 100% line coverage.
  - **Lifecycle storage:** approve applies at once, so a decided-for request is stored as `applied` (`approved` is an audit step: `override_approved` + `override_applied`); a self-applied field writes `override_requested` + `override_applied`. Rows and quote are locked `FOR UPDATE`; a partial unique index allows one open request per quote+field (a race → 409). Revert restores `original_value` exactly; the `*_overridden` flag stays set if an earlier applied override on the same field still holds.
  - **New permission `audit.read`** (Leadership + Admin) for the audit viewer, export and usage report: the prompt's "config.manage + Leadership read" needs one route permission, and `overrideLog.read` means something else. Matrix, can-tests, CHECK constraints and `/me` updated.
  - **Ship-to from intake:** a B-07 ship-to reason now also writes a self-applied `override` row and an `override_applied` event (the old `ship_to_overridden` event is still shown for existing rows). Migration 0008 creates the rows for quotes that already had `ship_to_overridden`. The intake keeps its own reason rule (no 15-character minimum there), so B-07 behaviour is unchanged.
  - **Notifications:** override (approver roles on request, the requester on approve/reject/revert) and @mention notifications are written as in-app `notification` rows in the same transaction; email delivery and the bell's read flow stay B-18.
  - **Timeline:** `GET /quotes/:qn/timeline?filter=&cursor=` merges `activity_event` and `comment` (keyset on `(at, id)`), with priority events and tier overrides hidden where `kam_can_see_peer_scores` hides the score. Comments are stored sanitized (tags and control characters stripped) and rendered from tokens, never HTML; only users picked **and** still @named in the text are mentioned. `GET /users?q=` feeds the picker (it searches the word after `@`).
  - **Audit plugin** (`apps/api/src/plugins/audit.ts`): routes set `req.auditView`; the view row is written after the response, best effort, debounced per user per quote per 10 min in memory and re-checked in the DB under an advisory lock (multi-instance safe). `recordAudit(tx, …)` redacts token/secret keys and runs in the mutation's transaction (a test injects a failure after the audit insert: no row survives). Sign-in audit is B-04's. Report and filter days are US Central.
  - **UI:** pencil + "Override" beside the tier and the ship-to, dialog (current → requested, justification counter), pending badge, copper "Overridden" marker (hover/focus/tap shows original, justification and who), Approvals → "Override requests" (nav item for `override.approve` too, so SalesLeader, EngLead and Admin now see Approvals), timeline card with filter chips, "Load older", revert (confirmed) and the comment composer, `/admin/audit` (filters, CSV), `/admin/reports/usage`, `/admin/override-log`. Leadership gets an "Audit log" nav item. The B-08 `TierChip` "(override)" suffix lost its opacity (it failed contrast on Critical).
  - **Tests:** domain unit tests; API `overrides.int.test.ts` (lifecycle, 409s, exact revert, justification, approver-per-config, segregation, ship-to own-only, queue pin, notifications, log access per role), `timeline.int.test.ts` (every event type, filters, paging, sanitized comments, mention notifications, revert flag, priority redaction) and `audit.int.test.ts` (10-minute debounce incl. two instances, transactional failure, UPDATE/DELETE denied, viewer filters, audited CSV export, usage report, access per role); 12 routes added to the permission-matrix registry; Playwright `overrides.spec.ts` (tier request → approve → revert, ship-to self-apply, @mention comment, filters, Leadership audit pages; axe on each).

---

## Phase 2: Workflow stages (Oct 28 – Nov 2)

### B-10: Engineering queue and Engineering Review (F-04, F-07 queue, CR-14/15/19, DEC-26) · **Wed Oct 28 – Thu Oct 29** · Ben
- **Why:** engineering is the binding constraint. A visible, aged, prioritized queue is the MVP's biggest value.
- **People:**
  - **R2 (Thu Oct 29)**: Jim Zweifel, Faron Ipox, Jeffrey Pitrak, Danielle Leu
  - Paul Slomkowski (optional) for the BOM/capital fields
- **Done when:**
  - [x] queue shows every quote past G1, sorted by tier/score then age, with time-in-queue and time-in-stage
  - [x] the EngLead gets an alert on arrival (in-app now, email in B-18)
  - [x] assign/reassign is recorded
  - [x] accept / return to KAM (reason required)
  - [x] Eng Review form: process, machine, plant/site, cavitation, cycle time, prelim capital (commercial field), downstream equipment notes
  - [x] **capacity evidence** sub-form (site, line/asset, assumed effectiveness %, cycle time, utilization, buffer, analysis date; no OEE default)
  - [x] G2 outcomes: Proceed / Proceed with risk / Capital required / Hold / Rework / Stop
  - [ ] **R2 (Thu Oct 29)** with Jim Zweifel, Faron Ipox, Jeffrey Pitrak (Danielle Leu): walk-through done and feedback recorded below
- **Prompt:** `prompts/B-10-engineering-queue-review.md`
- **Built 2026-10-16, ahead of R2. Notes and deviations:**
  - **R2 feedback: not yet held (R2 is Thu Oct 29).** Record Jim's, Faron's and Jeffrey's feedback here after the session. Questions to put to R2 are in `04-decisions-and-risks.md` §2 ("Provisional choices B-10 shipped"): the G2 solution field set, whether "Capital required" also needs capacity evidence, the aging edges, the backup assigner, and whether assigned Engineers should read the commercial numbers they enter.
  - **Domain** (`packages/domain/src/engineering/`): `businessDaysBetween` (US Central calendar, Mon–Fri, no holiday calendar yet), `agingBucket` / labels / counts, `compareEngQueue` / `sortEngQueue` (pinned by an applied `queue_position` override → tier in the model's order → score desc → oldest in the queue → quote number), `filterEngQueue`, `canAssignEngQueue` (queue.assign or a backup assigner who can read the quote), `canEditEngReview` (engReview.edit on the quote while in ENG_REVIEW, on hold included), `planAssignment`, `planAccept`, `planCapacityEvidence`, `engineeringCompleteness` (the intake warnings minus G1's request-class note). `summarizeStageTimes` was added beside `computeTimeInStage` for the stage-times route and B-17. 100% line coverage.
  - **G2 seed rules changed** (`seeds/hybrid.ts`, all still provisional): Proceed / Proceed with risk need process, machine, plant, cavitation, cycle time + ≥ 1 capacity row (risk: + note). Capital required needs only `prelim_capital_usd` (per the 9/15 one-pager as given in the prompt; before it also needed the feasibility fields). Hold needs a reason + review date; Rework a reason + note; **Stop needs a reason + note and closes as DECLINED** (was CLOSED_LOST): an engineering "won't pursue" is internal, like G1's. The synthetic seed now puts its four engineering stops in DECLINED and four more customer losses in CLOSED_LOST, so the stage counts are unchanged.
  - **New permission `engQueue.read`** (EngLead, Engineer, Leadership, Admin) for the queue page: none of the existing permissions matched "EngLead + Engineer + Leadership read". Matrix, can-tests, CHECK constraints (migration 0009) and the nav updated. **The nav changed:** Leadership and Admin now get "Engineering queue"; Admin's mobile tabs are home, intake, queue, pipeline + More.
  - **Assignment's route floor is `quote.read`**, not `queue.assign`, because a backup assigner (`eng_queue_backup_assigner_user_ids`, R-04) may hold no queue.assign. The domain then requires queue.assign or the setting, so a KAM or a plain Engineer gets 403 (integration-tested). A backup assigner also needs a role with `engQueue.read` to open the page. Accept is allowed to the EngLead **and the assigned engineer** (engReview.edit on the quote): the prompt lists it under EngLead actions, the engineer starting their own review seemed natural. Revisit at R2.
  - **Commercial numbers are write-only for Engineers.** Architecture §3.3 (non-negotiable rule 2) keeps prelim capital and the capacity numbers from roles without `quote.read.commercialFields`, and the Engineer role does not hold it. So an assigned Engineer can enter them but never reads them back: an omitted number on an existing capacity row, or a blank capital field, keeps the stored value. The UI says so. If R2 wants engineers to see their own numbers, that is a matrix change (an `assigned` qualifier on `quote.read.commercialFields` for Engineer), not a code change in B-10.
  - **Arrival alert:** whenever a transition enters ENG_REVIEW (G1 Advance, the no-G1 SUBMIT, G3 Rework, G4 Return, G5 Re-quote) every active EngLead and every backup assigner gets an in-app `quote.ready_for_eng_review` row in the same transaction (`onEngQueueArrival`); email is B-18. The review's acceptance is cleared on (re-)entry and on reassignment, the fields are kept. Assignment notifies the engineer (`quote.assigned`).
  - **Notification feed (minimal):** `GET /notifications` + `POST /notifications/read` (mark all) and the header bell with an unread badge, polling every minute. Per-item read state and email stay B-18. This also surfaces the B-09 override and @mention rows that were already being written.
  - **Data:** migration 0009 adds `quote.assigned_at` (backfilled from acceptance or the last update), `eng_review.accepted_by` and `eng_review.technical_concept_notes`. `returned_reason` is unused: a return is the G2 Rework decision (reason code + note on `gate_decision`). Settings: `eng_queue_aging_days` {aging 3, old 10}, `eng_queue_backup_assigner_user_ids` [], `capital_readiness_on_outcome` {"G2:capital_required": "pending"}. The synthetic seed no longer sets a random `queue_position`: a position is only an EngLead pin.
  - **G2 evidence:** the gate service adds `evidence.engineering` (solution fields, every capacity row as stored, the assigned engineer) to G2 decisions. "Capital required" upserts the pricing record's `capital_readiness` from the setting, keeping any other pricing fields.
  - **API:** `GET /queue/engineering` (filters `tier`, `engineer` = id | `unassigned` | `me`, `agedOver`, `bucket`, `productFamily`, `q`; header counts and `total` are before filters; `mine` is the caller's assignments), `POST /quotes/:qn/assignment`, `POST /quotes/:qn/eng-review/accept`, `PUT /quotes/:qn/eng-review` (only the keys sent change; a capital change rescores), `PUT /quotes/:qn/capacity-evidence` (replaces the set), `GET /quotes/:qn/stage-times`. `QuoteDetail.engineering` carries the tab. Timeline events `engineer_assigned`, `eng_review_accepted`, `eng_review_updated` (field names only, never values) and `capacity_evidence_updated`. 8 routes added to the permission-matrix registry.
  - **Bulk assign** is one request per quote from the UI (each recorded and audited on its own; failures are listed), not a batch endpoint.
  - **UI:** `/queue/engineering` (aging chips that filter, search, aged-over select, Filters popover, sortable table that becomes cards on mobile, multi-select bulk assign, row menu: Assign/Reassign, Accept, Return to KAM (G2 dialog preset to Rework), Pin to top (the B-09 queue_position override), Open review). Engineers see "Assigned to me" above the read-only queue. The quote page has Overview / Engineering tabs (`?tab=engineering`) and a time-in-stage bar. `GateDecisionDialog` gained `initialOutcomeKey`; its completeness line reads "Nothing missing for this decision" outside INTAKE.
  - **Tests:** domain unit tests (business days, buckets, order, filters, assign/accept/edit rules, capacity merge incl. write-only, completeness, stage totals); API `engineering.int.test.ts` (24: order, pin, aging with a frozen clock incl. config change, filters, completeness, who sees the queue, arrival alert incl. backup and the no-G1 path, notification feed, assignment record/audit/notify/reassign, bulk assign + open counts, assign permissions + backup + 409, accept, Engineer only on assigned quotes, KAM 403, value-list checks, capital redaction + rescore, capacity no-default + redaction + keep, every G2 outcome's rules, evidence snapshot, capital readiness pending, rework banner, DECLINED, re-entry alert, stage times); Playwright `engineering.spec.ts` (EngLead alerted → assigns → Engineer accepts and completes with capacity evidence → EngLead Proceeds; KAM read-only with capital hidden; axe on each).

### B-11: Quoting stage (Pricing) (F-11 context, CR-26) · **Fri Oct 30** · Ben
- **Why:** pricing is a required gate (DEC-19/20), and the price approval has to be recorded in CCQ instead of free-text notes.
- **People:** **M5** (pricing route), **R3** (Gemma Cebolla + pricing analyst).
- **Done when:**
  - [x] Pricing queue (quotes in QUOTING)
  - [x] pricing record: price approved by and date, pricing-app references (ERF/BPR #), approved-range note, capital readiness (not required / pending / pre-approved / not approved)
  - [x] no editable price figures
  - [x] G3 submit to Final Review
  - [x] Pricing can't approve Final Review
  - [x] commercial fields are redacted for other roles (tested)
  - [ ] **R3 (Thu Nov 5)** with Gemma Cebolla (+ pricing analyst): walk-through done and feedback recorded below
- **Prompt:** `prompts/B-11-quoting-stage.md`
- **Built 2026-10-16, ahead of M5 and R3. Notes and deviations:**
  - **R3 feedback: not yet held (R3 is Thu Nov 5).** Questions for R3 and M5 are in `04-decisions-and-risks.md` §2 ("Provisional choices B-11 shipped"): costing attestation required or warned, whether "capital not approved" blocks, the ERF/BPR formats (Cory, M5), and D-11.
  - **Price approval is a decision, not free text.** No column, body field or input holds a price figure: the PUT bodies are `.strict()` (a `price` key is a 400, integration-tested) and the Quoting tab has no number input (Playwright-checked). The basis and range are notes (DEC-23, PRD §9, D-10).
  - **Domain** (`packages/domain/src/pricing/`): `PRICING_QUEUE_STAGE_KEY`, `sortPricingQueue` (tier in the model's order → score desc → longest active time in Quoting → quote number), `filterPricingQueue` (tier, G2 outcome, capital readiness incl. `none`, approved, product family, KAM, text), `canEditQuoting` (quoting.edit while in QUOTING, on hold included), `planPricingRecord` (only keys sent change; approver must be on the Pricing team; time defaults to now and can't be in the future beyond 5 min skew; refs trimmed, upper-cased, de-duplicated and format-checked; the costing tick records who/when), `planCapitalReadiness` (not `not_required` after G2 "Capital required"; the pending justification is cleared once not pending), `carryForwardPricingRecord`, `priceApprovalStatus`, `quotingWarnings`, `parsePricingRefFormats`. 99% line coverage. New segregation deny `actor_is_price_approver` reads `QuoteState.priceApproverIds` (the record's approver + G3 deciders on the current version).
  - **G3 seed rules changed** (`seeds/hybrid.ts`, provisional): Submit = approver + time + (ERF or BPR or no-record note) + capital readiness + (not pending or a justification). Hold: reason + review date. Rework: reason code (no note required). **Stop: reason + note, DECLINED** (was CLOSED_LOST). The synthetic seed records a justification when it draws pending capital, and re-records the approval after a G4 Return (a new version needs its own record).
  - **New permission `pricingQueue.read`** (Pricing, Leadership, Admin). Matrix, can-tests, CHECK constraints (migration 0010) and the nav updated: Leadership and Admin now see "Pricing queue".
  - **Data:** migration 0010 makes `pricing_record` versioned (`quote_version`, unique with `quote_id`; existing rows backfilled with the quote's version) and adds `pricing_basis_note`, `no_pricing_app_record_note`, `costing_completed` / `costing_attested_by` / `costing_attested_at`, `cer_reference`, `capital_pending_justification`. `pricing_refs` is now `{erf: string[], bpr: string[]}`. Setting `pricing_ref_formats` (provisional). Capital readiness joins the commercial redaction registry (with `pricing_records`, the history).
  - **Gate service:** entering QUOTING creates the version's record (references carried forward) and tells Pricing in-app (`quote.ready_for_quoting`); G3 Submit tells the Approver group in-app (`quote.ready_for_final_review`; email is B-18). G2 "Capital required" writes pending capital on the current version's record. G3 decisions add `evidence.quoting.warnings` (pending capital, capital not approved, costing not attested, no pricing-app record).
  - **API:** `GET /queue/pricing` (filters `tier`, `g2`, `capital` incl. `none`, `approved=yes|no`, `productFamily`, `kam`, `q`; `total` and `counts` are before filters), `PUT /quotes/:qn/pricing-record`, `PUT /quotes/:qn/capital-readiness`. `QuoteDetail.quoting` carries the tab: `approval` (everyone), `g2` and, commercial (stripped for KAM / Engineer / SalesLeader), `pricingRecord` (current version) and `pricingRecords` (history). Timeline events `price_approval_recorded` (approver name + time: the status is not commercial), `price_approval_cleared`, `pricing_record_updated` (field names only). 3 routes added to the permission-matrix registry.
  - **UI:** `/queue/pricing` (counts, search incl. ERF/BPR, approval select, Filters popover for tier / G2 outcome / capital readiness / family, sortable table that becomes cards on mobile, row menu: Record price approval, Decide G3). Quote page gains a **Quoting** tab (`?tab=quoting`): approval status for everyone; for commercial roles the engineering summary, a B-15 pricing-app panel slot, the approval form (approver picker of Pricing users defaulting to the caller, datetime, basis, range, ERF/BPR, no-record note, costing tick), capital readiness, warnings, Submit / Return to Engineering / Hold-or-stop buttons and earlier versions. `GateDecisionDialog` shows the G3 gaps in words. Form helpers moved from `EngineeringTab` to `components/forms.tsx`.
  - **Not done here:** the G4 screen (B-12). The segregation rule is enforced and unit-tested, but no seeded persona holds Pricing + Approver, so the integration test checks `priceApproverIds` on the quote state rather than a 403.
  - **Tests:** domain `pricing.test.ts` (formats, who edits, record planning, capital rules, approval status, redaction of the tab's shape, warnings, queue order/filters, every G3 outcome's rules, segregation); API `pricing.int.test.ts` (19: queue order and columns, filters, who opens the queue, arrival record + Pricing alert, recording + timeline without values + audit with values, approver / format / future-time checks with formats changed in config, only Pricing and only in QUOTING, no price figure accepted, redaction for KAM / Engineer / SalesLeader on the quote and the timeline, capital rules after "Capital required", G3 required fields + Approver alert + evidence warnings, the "Capital required" path, only Pricing decides G3, segregation state, Hold, Stop → DECLINED, Rework → new version with v1 kept byte-for-byte); Playwright `pricing.spec.ts` (Pricing: queue flags → format error → approval → pending capital with justification → Submit to Final Review; KAM sees only "Price approved ✓ on … by …"; the Approver is notified; axe on each).

### B-12: Final Review (G4 internal approval) (F-16 as a P0 decision record, CR-29) · **Fri Oct 30** · Ben
- **Why:** the internal "do we stand behind this offer" decision. It has to stay **separate** from the customer outcome (fixes X-88).
- **People:** the Final Review approver(s) from the **D-pack (needed by Oct 28)**. Without a decision, seed a provisional `SG-CCQ-Approver` membership confirmed by Darren.
- **Done when:**
  - [x] Approvals queue (`/approvals`: Final Review, To qualify, Overrides tabs; mobile cards)
  - [x] Approve → CUSTOMER_DECISION, setting proposal issued date and validity date
  - [x] Decline needs a note + reason code and closes as DECLINED, or Return sends it to the affected stage
  - [x] the approver can't be the quote's KAM, nor the Pricing approver on the quote (segregation check, domain-tested)
  - [x] Approve and decline never set Awarded/Lost; the customer outcome stays separate (G5, B-13)
  - [x] mobile approval works (Playwright at 390 × 844: approve one quote, decline another)
  - [ ] **D-10: who is confirmed as Approver: NOT YET DECIDED.** No names are recorded here or in code. Approver = whoever IT puts in `SG-CCQ-Approver` (Entra group → `CCQ.Approver` app role). Candidates named in the prompt: Sarah Brennan, Darren Miller, Paul Slomkowski, a sales leader within delegation, or a delegate. Record the confirmed members here once Darren / the D-pack (Oct 28) decides.
- **Prompt:** `prompts/B-12-final-review.md`
- **Built 2026-10-16, ahead of the D-10 decision. Notes and deviations:**
  - **Already seeded before B-12 (B-08/B-11), kept:** the G4 outcomes (approve, decline with note + `decline` reason, return with note + target QUOTING | ENG_REVIEW + version bump) and both segregation rules (`actor_is_kam`, `actor_is_price_approver`). B-12 adds the dates, notifications, tier hook, queue, review summary and UI.
  - **Domain** (`packages/domain/src/final-review/`): `planProposalRelease` (issued = now or the actual send date, never in the future; `validity_until` = issued + `validity_days_default`, counted on the US Central calendar), `releasesProposal` (decided by the transition: G4 → active → CUSTOMER_DECISION, not by outcome name), approver-tier hook (`tiers.ts`), `finalReviewAvailability` (can decide / why not), queue order + filters, review warnings. `evaluateTransition` and `availableActions` take an optional `{ approverTiers }`. New error codes `TIER_APPROVER_REQUIRED`, `INVALID_PROPOSAL_DATE`.
  - **Tier hook, disabled:** `app_setting.g4_tier_rules` = `null`. When set (shape in `tiers.ts`; tiers by capital or revenue → approver roles / user ids) Approve needs the highest matching tier's group; Decline and Return stay open (`outcomeKeys`, default `["approve"]`). Tested with a sample rule enabled in the test only. A malformed setting **fails closed** (G4 refused with INVALID_CONFIG), as does a malformed `validity_days_default`.
  - **Gate service:** `GateDecisionBody.proposalIssuedAt` (only for the releasing outcome). On Approve it writes `quote.proposal_issued_at` / `validity_until`, a `proposal_released` timeline event and `evidence.release`. Every decision's evidence now carries `decidedByRoles` ("records the deciding role"); G4 also keeps the warnings the approver saw. `QuoteDetail` gained `proposalIssuedAt` / `validityUntil`; `AvailableGateAction` gained `releasesProposal` / `validityDays`.
  - **Notifications (in-app; email is B-18):** Approve → KAM "Approved; issue the proposal." (with the validity date); Decline → KAM + the Pricing role (reason label only, the note stays on the decision); Return → the existing arrival alerts of the stage it returns to, now worded "returned from Final Review".
  - **New permission `finalReview.read`** (Approver, Leadership, Admin; migration 0011 CHECK constraints). Leadership and Admin read the queue; only the Approver holds `gate.G4.decide`. Leadership's nav gains Approvals.
  - **API:** `GET /approvals?gate=G4` (filters `tier`, `g2`, `capital`, `kam`, `q`; per row `canDecide` + `blockedBy`), `GET /quotes/:qn/review-summary` (quote.read floor, commercial parts redacted per role, audited as a view). Decisions: the generic gate route. Both routes are in the permission-matrix registry.
  - **UI:** `/approvals` is now tabs (`?tab=final-review|to-qualify|overrides`; `?gate=G1` still opens To qualify). Final Review = cards (works on a phone), `/quotes/:qn/review` = the one-page snapshot with a **sticky decision bar** above the mobile tab bar. The decision dialog gained the "Proposal issued" field with a "valid until" preview; the score table in it is collapsed outside intake. Two a11y fixes found by axe (link name vs label, a low-contrast label).
  - **Attachments:** listed from the `attachment` table; uploads arrive with B-16, so the list is empty for now.
  - **Tests:** domain `final-review.test.ts` (48); API `final-review.int.test.ts` (30: queue, summary + redaction, approve / decline / return, config-driven validity, segregation 403s, tier hook on/off/malformed, never Awarded/Lost); Playwright `final-review.spec.ts` (390 px: approve one quote, decline another, axe, tap targets, sticky bar in view).
### B-13: Customer decision, outcome closure, validity, minimal hand-off (CR-37/39/41) · **Mon Nov 2** · Ben
- **Why:** 71% of FY26 outcomes are unrecorded today. Making outcome and reason mandatory is how win rate becomes measurable.
- **People:** the D-15 taxonomy (Sarah/Darren via Bailey); R3 for the hand-off fields (Amanda Cronkhite optional).
- **Done when:**
  - [x] outcomes: Awarded / Lost / Expired (no response) / On hold (review date required) / Re-quote (versioned return to the affected stage)
  - [x] reason code + closure owner + date are mandatory to close (no quote can close without outcome + reason + owner + date, on every terminal path)
  - [x] "silence ≠ loss" (expired is a distinct state)
  - [x] validity countdown with an expired flag; nothing auto-closes
  - [x] Awarded captures acceptance evidence, CER ID, BPR ID and receiving role
  - [x] the SF stage is shown side by side, with a mismatch flag
  - [ ] **D-15 (outcome taxonomy, reason codes, closure owner): NOT YET APPROVED, still provisional.** Every `reason_code` row ships `provisional = true` without `approved_by`. If D-15 lands (due Oct 28), update the rows and set `provisional = false` + `approved_by` (config, no code). The outcomes report shows a provisional banner until then.
  - [ ] **R3 (Thu Nov 5):** hand-off fields confirmed with Amanda Cronkhite (optional) and feedback recorded below
- **Prompt:** `prompts/B-13-outcome-closure-handoff.md`
- **Built 2026-10-16, ahead of the D-pack and R3. Notes and deviations:**
  - **D-15 still provisional; D-12 still open.** Questions for the D-pack and R3 are in `04-decisions-and-risks.md` §2 ("Provisional choices B-13 shipped"): the taxonomy, the closure-owner split, whether Expired is allowed before the validity date, the SF mismatch noise level, the hand-off fields, revalidation.
  - **Closure rule in the domain (CR-39/40):** `evaluateTransition` now plans a `closure` (outcome = `closeAs`, reason, owner, `closed_at`, deciding roles) on every closing transition and refuses one without a reason code, whatever the outcome row says; `persistTransition` writes exactly that and throws if a closing effect has none. `validateWorkflowConfig` refuses config whose closing outcome doesn't require a reason. New DB CHECK `quote_closure_complete_check` (migration 0012 backfills legacy rows from the closing decision / hand-off, else `unrecorded`). Domain tests sweep every terminal path of the hybrid (G1 on and off) and PRD-5 configs; the API test sweeps all eight seeded terminal paths through the gate route. CR-40's internal no-gos already closed with a reason; their deciding roles are on the closure event and the decision evidence.
  - **Closure owner:** `transition_rule.closure_owner` (`kam` for G5 Awarded / Lost / Expired, `decider` for internal no-gos). New permission **`outcome.assignOwner`** (SalesLeader) to name someone else; a KAM naming another owner gets 403, an unknown or inactive user 422.
  - **G5 seed rules changed** (`seeds/hybrid.ts`, provisional): Awarded now needs a reason code (new context `awarded` = the acceptance evidence: verbal / PO / LOI / contract) and `accepted_at`; Expired needs `validity_lapsed` (the server computes it) **or** a note (`decision_note`: the engine now exposes the decision's note to rules); On hold now requires a reason; Re-quote now requires a reason (scope / volume / resin / terms / other + note). Two old re-quote codes retired (inactive). The PRD-5 alternative seed's award also requires the `awarded` reason.
  - **Gate route, G5:** `GateDecisionBody` gained `acceptedAt`, `acceptanceDocumentUrl` (http(s) only), `competitor` and `closureOwnerId`; the customer fields are refused at other gates. Payload keeps them (+ `validity_lapsed`), evidence keeps the countdown and SF stage the KAM saw. An award opens the `handoff_record`. A G4 release clears the expiry flag. A G5 Re-quote's arrival alerts say "The customer asked for a re-quote".
  - **Re-quote (CR-38):** version bump to the chosen stage (Quoting or Engineering Review); every earlier decision is byte-for-byte unchanged and `GateDecisionSummary.superseded` marks it (Gate decisions card shows "Superseded"); the v1 pricing record stays and v2 starts afresh.
  - **Expiry job** (`apps/api/src/jobs/validityExpiry.ts`): daily (`VALIDITY_EXPIRY_INTERVAL_HOURS`, default 24, 0 = off), advisory lock `1_301_001`, system context. Flags open Customer Decision quotes past `validity_until` (US Central) once per date (`quote.validity_expired_flagged_at`), writes `validity_expired` to the timeline, notifies the KAM in-app ("Revalidate or record the outcome"; email B-18). Never closes (D-12).
  - **API:** `GET /quotes/mine/proposals` (`outcome.record`; the caller's own open Customer Decision quotes, soonest validity end first, with counts), `PUT /quotes/:qn/handoff` (`handoff.edit`: KAM own, SalesLeader, Admin; strict body; 409 unless AWARDED; timeline gets field names, audit the values; CER/BPR mirrored to `quote.cer_id` / `bpr_id`), `GET /admin/reports/outcomes` (**`analytics.read`**, not only Admin: sales leadership owns the capture rate). `QuoteDetail.customerDecision` carries the header, the closure and the hand-off. 3 routes added to the permission-matrix registry.
  - **Hand-off fields** beyond the B-03 table (migration 0012): acceptance date + document link, receiving role other, receiving contact, accepted-by date (`accepted_on`), completed at/by, updated by. Receiving roles are config (`handoff_receiving_roles`), not a CHECK.
  - **Settings:** `validity_warning_days` = 7, `handoff_receiving_roles` (provisional). **SF mismatch** is flagged only when either side is an outcome (see 04).
  - **UI:** "My proposals" nav item (KAM, SalesLeader: `outcome.record`) → `/proposals` (cards, countdown chip, SF stage, "Record outcome"). Quote page: Customer decision header (issued, valid until + countdown chip, SF stage + mismatch), closure card (outcome, reason, owner, date, recorded by + roles, competitor), hand-off card on AWARDED (focus moves to it after recording Awarded; "Hand-off complete" shows who confirmed). The decision dialog asks for the acceptance date / link, a competitor on Lost, explains "silence is not a loss" on Expired, and lets a SalesLeader pick the closure owner. `/admin/reports/outcomes` (also linked from Analytics). `Input` is now a forwardRef. **The nav changed:** KAM and SalesLeader personas gain "My proposals".
  - **Tests:** domain `outcome.test.ts` (closure sweep, owner, every G5 outcome, frozen-clock countdown incl. Central-calendar edges, expiry selection, SF compare, report: expired ≠ lost and capture rate, hand-off rules, ordering); API `outcome.int.test.ts` (32: header + countdown on a frozen clock + config window, SF mismatch, my proposals + scope, every G5 outcome, owner rules, Expired before/after validity, hold time excluded, re-quote keeps decisions byte-for-byte, all terminal paths, DB CHECK, expiry job once-only + advisory lock + reset, hand-off only on AWARDED / fields / complete / who edits, report); existing tests that closed quotes with raw SQL now set a reason and owner. Playwright `outcome.spec.ts`: a KAM records Awarded + hand-off, and a Lost with a reason (axe on each).

---

## Phase 3: Views, integrations, insight (Nov 3–6)

### B-14: Pipeline board, quote list, approvals and prioritization views, export (F-07) · **Tue Nov 3** · Ben
- **People:** none new (validated in R1–R3).
- **Done when:**
  - [x] kanban by stage (drag only where a transition is allowed, opening the gate dialog)
  - [x] Quotes list
  - [x] Approvals and Prioritization views
  - [x] search + Filters popover + inline sort; saved filters in URL
  - [x] CSV export (scoped, redacted, audited)
  - [x] all views mobile usable
  - [x] performance on ≥ 500 open quotes: list API p95 95 ms (target < 300), board API p95 230 ms, board render 945 ms for 560 cards (target < 1.5 s)
- **Prompt:** `prompts/B-14-board-and-lists.md`
- **Built 2026-10-16. Notes and deviations:**
  - **One query layer for three views.** `GET /quotes` (list; the Prioritization view is the same route sorted by score), `GET /quotes/board` and `GET /quotes/export.csv` take the same filters: `q`, `stage`, `tier`, `kam`, `engineer`, `productFamily`, `market`, `resin` (arrays as repeated keys, `key[]=` or comma-separated), `status` (`open` | `active` | `on_hold` | `closed`), `agedOverDays`, `closeDateFrom/To`, `hasWarnings`, `sfMismatch`; the list adds `sort` (score, tier, age, closeDate, amount, updated), `dir`, `page`, `pageSize` (≤ 200). **Paging is `page`, not a cursor:** at ~600 quotes a year a cursor buys nothing, and the two-phase query below already returns the total.
  - **Two-phase query** (`packages/db/src/repos/pipeline.ts`): phase 1 returns every matching id in order (RLS applies) with the facts for the second scope check; the service then re-checks each row with the domain policy (`can(actor, 'quote.read', quote)`) and applies the two filters only the domain can compute (`hasWarnings` = `qualificationWarnings`, `sfMismatch` = `compareSfStage`). Phase 2 loads the wide rows for the page. So paging and the total stay right whatever the policy or the domain filters remove.
  - **Priority withholding reaches SQL.** With `kam_can_see_peer_scores = false`, a KAM-only user's tier filter and score/tier sort read peers' priority as NULL, so filtering or ordering can't reveal a withheld score (integration-tested). `peerPriorityVisible` tells the UI.
  - **Redaction:** list rows carry `commercial: { prelimCapitalUsd, capitalReadiness } | null` (null without `quote.read.commercialFields`). The SF opportunity **amount** is shown to everyone (it mirrors Salesforce visibility); price and capital are not. The export decides its columns with the domain's sensitivity registry (`exportColumnsFor` → `isCommercialKey`), so a KAM asking for `prelimCapitalUsd` simply doesn't get the column.
  - **Export:** the visible list columns (`columns=`), in the list's order, streamed; cells neutralise spreadsheet formulas (shared `csvCell`). > 5,000 matching quotes → **422 `export_too_large`** ("narrow the filters"), with no export audit row. Otherwise one `audit_event` (`action = 'export'`, `entity = 'quote'`, `after = { format, view, filters, columns, rows }`) in the same transaction. Engineer has no `export.csv` (matrix) → 403.
  - **Board** (`/board`): a column per stage in config order with count and SF amount total; terminal stages collapse into "Closed (n)" (`?closed=true` expands them; the closed cards load only then). Card: tier chip (override marker), score, quote number, account, product one-liner, volume, KAM initials, days in stage, warnings dot (qualification warnings, validity expired, SF mismatch). Each open card carries the gate actions the caller may take now: the API runs the domain's `availableActions` on the full quote state, batched (`loadQuoteStates`, one query per table) and only for stages whose gate the caller decides. The domain's `boardMoves` / `droppableColumns` / `planDrop` / `dropDenialReason` (`packages/domain/src/pipeline/board.ts`, unit-tested per role against the hybrid seed) turn them into drop targets; holds are not moves. A drop opens `GateDecisionDialog` with the outcome **and target stage** preselected (new `initialTargetStageKey`, e.g. G4 Return → the column it landed on); the card shows in the new column while the dialog is open and snaps back on cancel. A refused drop shows why in the column (and to screen readers). On the collapsed Closed lane the outcome is preselected only when one closing outcome is possible.
  - **dnd-kit** (`@dnd-kit/core` 6.3.1, new dependency): `MouseSensor` + `KeyboardSensor` (keyboard drag from the grip button, so the card's links stay normal links). Touch never starts a drag: phones and coarse pointers use the card's **Move** menu (also there on desktop). At ≤ 640 px the columns scroll horizontally with stage tabs that jump to each.
  - **Quotes list** (`/quotes`): DataTable with server-side sort (new `manualSorting` prop), column chooser (per user, `localStorage`; commercial columns offered only to roles that see them), row click → detail, cards on mobile, pager. **Prioritization** (`/quotes?view=priority`): ranked cards with the "Why this priority?" popover, the override marker and the breakdown expandable inline; it shows **open quotes unless a status is picked** (the view is about open work).
  - **Shared toolbar** (`PipelineToolbar`): debounced search, the Filters popover (stage, status, tier, KAM incl. "Me", engineer incl. "Unassigned", product family, market, resin, warnings, SF stage; plus aged-over and the close-date range), inline sort + direction, saved views. Everything is in the URL (`replace` navigation; multi-values comma-joined). **Saved views** are `localStorage` per user and view, wrapped in try/catch (a private window just has none). List / Prioritization / Board tabs carry the filters across.
  - **Approvals:** the Final Review tab now keeps its search, filters and a sort (tier then score, score, waiting longest, quote number; client-side, the queue is small) in the `/approvals` URL. To qualify and Overrides are unchanged (short lists, no filters needed yet).
  - **Global search:** header type-ahead (ARIA combobox) over quote number, opportunity and account, top 8 newest first; arrows + Enter open a quote, Enter with nothing highlighted opens the full list with `?q=`.
  - **"Age" is calendar days in the current stage** (from the open `stage_history` stay, holds included), not business days like the engineering queue's buckets. *Ask R2/R3* if a business-day age is wanted here too.
  - **Data:** migration 0013 adds trigram indexes on `quote.quote_number`, `quote.description`, `customer.name`, `quote(updated_at desc)` and a partial index for the open stage stay (`stage_history(quote_id, entered_at) where exited_at is null`). The architecture §5 minimum indexes were already there. The data dictionary is regenerated.
  - **Fixed on the way:** the Filters button's accessible name now contains its visible text ("Filters 1 active"; axe `label-content-name-mismatch`), and its popover fits the space below the button with a sticky Clear / Done footer (with many filter groups "Done" was off-screen). `loadQuoteState` is now a batched `loadQuoteStates` (same output).
  - **Tests:** domain `pipeline.test.ts` (availableActions → droppable columns for all 8 roles, own-only KAM moves, segregation, preselection incl. G4 Return and the Closed lane, denial texts, list helpers; 100% lines); API `pipeline.int.test.ts` (21: paging, every filter and combinations, the three array syntaxes, 400 on a bad id, sorts, owner scope, commercial and peer-priority redaction incl. filter/sort, board columns / actions per role / filters, export order + columns + audit, KAM column stripping + scope, formula neutralising, Engineer 403, the 5k cap → 422 without audit); 3 routes in the permission-matrix registry; web unit tests for the URL state and saved views; Playwright `pipeline.spec.ts` (filter → sort → reload keeps the view → open a quote, with axe; EngLead drags ENG_REVIEW → QUOTING and gets G2 with Proceed preselected, a drop on Final Review is refused with the reason, cancel snaps back; a KAM can't drag and the board has no page-level horizontal scroll at 390 px).
  - **Performance check (opt-in):** `pnpm --filter @ccq/api test:perf` builds `ccq_test_perf` (the synthetic seed with its open quotes cloned to 560 open), asserts list p95 < 300 ms across 5 roles × 8 filter sets, board p95 < 1 s, and prints `EXPLAIN (ANALYZE, BUFFERS)` of both list queries run as `ccq_app` with RLS on (phase 1 ≈ 10 ms, phase 2 ≈ 3 ms; sequential scans on `quote` are the planner's right choice at this size). `PERF_E2E=1 DATABASE_URL=…/ccq_test_perf` runs `e2e/board-perf.spec.ts` (board render of every open card < 1.5 s). Measured 2026-10-16 in the cloud dev container: list p95 95 ms (p50 60 ms), board API p95 230 ms, board render 560 cards in 945 ms.

### B-15: Pricing application read connector (F-11) · **Wed Nov 4** · Ben
- **People:** **M5 (Oct 21)**: Cory McGahan (DB access), Gemma Cebolla (scope and sensitivity), Brennan Paul (if the Fabric route).
- **Done when:**
  - [x] `PricingReader` interface has fake + real implementations (route A **and** B; neither run against a live database yet, see below)
  - [x] look up ERF/BPR by number and by customer
  - [x] pricing context panel on the Quoting stage (read-only, commercial-redacted)
  - [x] SPR shown as history only
  - [x] `integration_run` logged
  - [x] falls back to manual references when the reader is unavailable
  - [ ] **after M5:** route chosen and recorded here, column map confirmed, live contract test passed (`PRICING_LIVE_TEST=1`)
- **Prompt:** `prompts/B-15-pricing-reader.md`
- **Built 2026-10-16, ahead of M5 (Oct 21). Notes and deviations:**
  - **Route at M5: not chosen yet.** As the prompt says for this case, `PRICING_MODE=fake` is the default and Route A is ready with config placeholders. Route B is built too, since both speak TDS and share every statement: `sqlserver` = Route A (read-only SQL login, `mssql` 12.7.2 / tedious 20.3.3 pinned by a pnpm override, `encrypt` + certificate check, `ApplicationIntent=ReadOnly`, password from Key Vault); `fabric` = Route B (the Fabric SQL analytics endpoint, `azure-active-directory-default`, i.e. the App Service managed identity). Env: `PRICING_SQL_SERVER`, `PRICING_SQL_DATABASE`, `PRICING_SQL_USER` / `PRICING_SQL_PASSWORD` (A), `PRICING_SQL_MI_CLIENT_ID` (B, optional); the API refuses to boot without the ones its mode needs. **When M5 decides:** set the mode and env, confirm `columnMap.ts`, run the live test, tick the last box and record the route here.
  - **Column map: provisional** (`packages/integrations/src/pricing/columnMap.ts`, the only place view and column names live). Each column is tagged `evidence` (named in Cory's 2026-09-22 export: Priority, Product_Class, Channel, Plant, Machine, Est_Revenue / Est_Volume / Est_Net_Capital, Decision_Type / _By / _Date / _Reason, Attachment_Count, Days_Submitted_To_Engineer_Assigned / _ECE_Approved / _Price_Confirmed), `placeholder` (TODO(M5): keys, customer, description, dates, the accepted/rejected/abandoned flag names, every BPR and SPR column, the view names) or `confirmed`. The SQL readers check each view's columns once (INFORMATION_SCHEMA): a missing optional column maps to null (logged by name); a missing key column fails every call with `COLUMN_MISSING`, so the UI falls back to manual references. Questions for M5 are in `04-decisions-and-risks.md` ("B-15 questions").
  - **Read-only, three ways:** the interface has no write method; every statement is one parameterized `SELECT` re-checked at runtime by `assertSelectOnly` (no write keyword, `;`, comment, `SELECT INTO`, `EXEC`, `OPENROWSET`…); `readonly.test.ts` greps the connector for write SQL and the mssql batch/procedure APIs. View and column names are the only text spliced into SQL and must match a strict identifier pattern. Values never are. Every query has a 10 s timeout and returns at most 50 rows.
  - **Blanks are unknown, not zero:** NULL, blank, whitespace and junk ("N/A") figures map to null and the panel shows "Unknown"; a real 0 stays 0. Dates accept SQL `Date`, ISO and M/D/YYYY. The ERF status comes from the flags (accepted, then rejected, then abandoned, else open; bit / Y/N / Yes/No / true all read).
  - **API** (`quote.read.commercialFields`: Pricing, EngLead, Approver, Leadership, Admin; KAM, Engineer and SalesLeader get 403): `GET /pricing/erf/:erfNumber` (with every BPR that follows it), `GET /pricing/erf?customer=&q=&opportunity=` (a filter is required; limit ≤ 50), `GET /pricing/bpr/:bprNumber`, `GET /quotes/:qn/pricing-context` (resolves `quote.erf_number`, the current pricing record's ERF/BPR refs and the SF opportunity's ERF number; BPRs tagged `reference` or `erf`; SPR history by the quote's customer; `notFound` refs; CCQ vs SF ERF linkage with the admin report's rules; `canUseAsReference`). Lookups answer 404 when unknown and **503 `pricing_app_unavailable`** when the reader fails; the context answers 200 with `source.available = false` so the tab can fall back. The context route writes the debounced quote-view audit row. An "ERF"/"BPR" prefix and spacing are tolerated on lookups.
  - **Cache and usage:** successful reads are cached in memory for 5 minutes per ERF / BPR / BPR list / customer SPR list (failures are not cached; searches are not cached). **`integration_run` counts per hour:** one row per hour for source `pricing` (migration 0014: unique partial index on `(source, started_at) where source = 'pricing'`), counts `requests`, `calls`, `cacheHits`, `rows`, `failed` summed key by key, status succeeded / partial / failed from the hour's totals, the latest error code kept. Counts are flushed about once a minute and on shutdown (`PricingUsage`); Admin → Integrations lists the rows like the SF runs.
  - **UI:** a **Pricing context** card on the Quoting tab (above the approval form, for every commercial role) and on the Final Review screen: ERF cards (status, quote-ERF marker, submitted, priority, product class, channel, plant, machine, estimated revenue / volume / net capital with "Unknown" for blanks, decision, reason, attachments, the three elapsed-day fields), "Not in the pricing app" refs, linked BPRs, SPR history collapsed as "Historical (SPR retired Nov 2025)", and a mismatch alert when the SF ERF number differs. **"Use as reference"** (Pricing, in Quoting) adds the ERF/BPR to the current pricing record through the B-11 route (format-checked there; the button is disabled with a hint for numbers that don't match `pricing_ref_formats`). On any error, or `available = false`, the card says **"Pricing app unavailable; enter references manually."** with the refs CCQ holds, and the B-11 reference fields work as before. The B-11 placeholder slot became a one-line hint. Hidden entirely for other roles (`useCan`), and the API refuses them.
  - **Linkage:** saving ERF references on the pricing record (typed or via "Use as reference") sets `quote.erf_number` to the first one **if it is empty**, audited (`entity = 'quote'`, before/after); it never overwrites. A different SF ERF number shows as the mismatch alert (and on the B-06 ERF linkage report).
  - **Sensitivity (provisional until M5/Gemma):** `est_revenue_usd`, `est_volume`, `est_net_capital_usd` join the commercial keys, and `erf_record(s)`, `bpr_record(s)`, `spr_history`, `pricing_context` the commercial subtrees, so the domain's `redact` strips any pricing-app record for other roles wherever it appears (second layer behind the 403).
  - **Logging:** operation, row counts, column names and a data-free error code only (`pricingErrorCode`: ETIMEOUT, ELOGIN, ESOCKET, COLUMN_MISSING…); never row contents, values or SQL Server messages.
  - **Fake** (`PRICING_MODE=fake`): a deterministic synthetic fixture built from the SF synthetic fixture (every seeded opportunity's ERF number resolves; FY26 ERFs have blank figures; 0–3 BPRs per ERF and a few without an ERF; SPRs end before Nov 2025). In dev it also makes up a plausible ERF for any 4–7-digit number **not ending in 0** (so seeded quotes' references show something and "not found" can still be tried); tests use the strict fixture.
  - **Tests:** integrations: column-map and mapper tests on fixture rows (blanks → unknown, zeros kept, flags, dates, missing columns), SQL tests (parameterized against an injection string, the 50 cap, LIKE escaping, the read-only guard, column resolution, timeout, logs carry codes only), fake tests, the read-only grep, and the live contract test behind `PRICING_LIVE_TEST=1` (skipped; not yet run). Domain: redaction of every pricing-app shape for each role. API: `pricing-app.int.test.ts` (21: 403 with nothing leaked for KAM/Engineer/SalesLeader on every route, 200 for the five commercial roles, lookups / 404 / 400, search cap, the context with BPR cardinality, `notFound`, SPR, linkage match/mismatch, `canUseAsReference`, the view audit, `quote.erf_number` set once and audited, the 5-minute cache, the 503 / `available = false` fallback with manual refs still saving and recovery, hourly `integration_run` rows), a service unit test that no log line carries data, config tests, and 4 routes in the permission-matrix registry. Playwright `pricing.spec.ts` now covers the panel, "Use as reference" on a BPR, the fallback (API stubbed to 503) and the KAM (no panel, 403 from the API).

### B-16: Document attachments to SharePoint (F-13) · **Wed Nov 4** · Ben
- **People:** **M7 (Oct 27)**: the SharePoint admin grants `Sites.Selected`; Bailey confirms the folder structure.
- **Done when:**
  - [x] upload from intake and any stage, streamed through the API to `/CCQ/{quote_number}/` (local store and SharePoint against the mock Graph; not yet against a real site, see below)
  - [x] list/download in the quote
  - [x] type/size limits
  - [x] uploading a drawing sets `drawing_status`
  - [x] audited
  - [x] Blob fallback implementation behind the same interface
  - [ ] **after M7:** site + library recorded here (`SP_SITE_ID`, `SP_DRIVE_ID`), `Sites.Selected` (write) granted on that site only, folder convention confirmed with Bailey (`attachment_settings`), Defender scanning confirmed, live contract test passed (`SP_LIVE_TEST=1`)
- **Prompt:** `prompts/B-16-sharepoint-attachments.md`
- **Built 2026-10-19, ahead of M7 (Oct 27). Notes and deviations:**
  - **Site and folder at M7: not agreed yet.** As with B-15, the safe mode is the default: `FILESTORE_MODE=local` (files under `FILESTORE_LOCAL_DIR`, `.data/files`, git-ignored) in development and CI, and the API **refuses `local` in production**. `sharepoint` needs `SP_SITE_ID` + `SP_DRIVE_ID`; `blob` needs `BLOB_ACCOUNT_URL` (https) + `BLOB_CONTAINER`. Credentials: the App Service managed identity (`GRAPH_MI_CLIENT_ID` for a user-assigned one); a developer may use `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` against the **test site only** (refused in production). **When M7 decides:** set the env, confirm `attachment_settings`, run `SP_LIVE_TEST=1`, tick the last box and record the site/library and folder convention here. Questions for M7 are in `04-decisions-and-risks.md` ("B-16 questions").
  - **`packages/integrations/src/graph/`** (the prompt's `packages/integrations/graph/`, following the package's `src/` layout): `FileStore` (`ensureFolder`, `upload`, `list`, `get`, `getDownloadUrl`, `move`, `delete`); `GraphClient` (`@azure/identity` 4.13.3: `ManagedIdentityCredential` / `ClientSecretCredential`; retries 429/5xx honouring Retry-After; logs method, status and Graph error code only); `SharePointFileStore` (upload session in **5 MiB = 16 × 320 KiB** ranges with a constant `Content-Range` total, the bearer token never sent to the pre-authenticated upload URL, the session cancelled on any failure; `conflictBehavior: rename`, so nothing is overwritten); `BlobFileStore` over a small `BlobContainer` adapter (`AzureBlobContainer`: `@azure/storage-blob` 12.34.0, private container, `ifNoneMatch: *` uploads in 4 MB blocks, read-only HTTPS **user-delegation SAS** links valid 5 minutes with `Content-Disposition`; moves are copy + delete); `LocalFileStore` (temp file then hard-link into place, so no overwrite and nothing left on failure; path-escape checks). Every store holds the stream to its **declared size** (`TOO_LARGE` / `SIZE_MISMATCH`).
  - **Soft delete only** (`delete(itemId, removedFolder)`): the file moves to `CCQ/_removed/<its folder>/`. Deleting an intake draft soft-removes its files (the FK is `on delete set null`; a removed row may then have neither quote nor draft).
  - **API** (`apps/api/src/routes/v1/attachments.ts`, `services/attachments.ts`): `POST /quotes/:qn/attachments` (`attachment.upload`, then the quote's scope), `GET /quotes/:qn/attachments` (`quote.read` floor + the quote's scope; debounced view audit), `POST|GET /quotes/drafts/:id/attachments` (`quote.create`; the draft's owner, Admin reads), `GET /attachments/:id/download` (authz, **audit row in the same transaction as the link**, then **302**; `?format=json` returns `{url, expiresAt, fileName}` because the SPA's fetch can't read a cross-origin redirect), `DELETE /attachments/:id` (the uploader within `uploaderRemoveHours`, the owner of an open draft, or the new permission **`attachment.removeAny`** = Admin; soft). `GET /files/local?t=…` exists only in local mode: an HMAC-signed, 5-minute link standing in for SharePoint's download URL (public route; the signature is the authorization). Out-of-scope quotes and other people's drafts are **404**, so nothing leaks.
  - **Streaming:** `@fastify/multipart` 10.1.2 (one file, 5 small fields, limit 100 MB + 1 byte so an overrun is caught by the store as 413). The client sends `kind`, `note`, `size` **before** the file, because Graph needs the total size before the first range. The first 4 KB are read for the **magic-byte check** (pdf, png, jpeg, heic brands, dwg `AC10xx`, dxf ascii/binary, STEP `ISO-10303-21;`, IGES column 73 `S`, xlsx/docx ZIP, msg OLE, eml header), then replayed into the store while a SHA-256 is taken; nothing else is held. The stored MIME is the canonical one for the verified type, never the browser's. Names are sanitized (`sanitizeFileName`: no path, no SharePoint-illegal characters, `#`/`%`, reserved names, `~$`/`_vti_`, ≤ 120 chars); the original is kept in `attachment.file_name`.
  - **Side effects:** a `bottle_drawing` sets `drawing_status` to the first `drawing_status` value-list code with `meta.hasDrawing` (HAVE_DRAWING in the seed) unless it already has one (quote: updated + audited; draft: its data, which the wizard mirrors). Removing a drawing does **not** reset the status. Quote uploads and removals write `attachment_uploaded` / `attachment_removed` timeline events; every upload, download and removal writes an `audit_event` (`upload` / `download` / `update`) with name, size, storage, folder and the SHA-256. Logs carry codes, sizes and ids, never names or content.
  - **Drafts:** files go to `CCQ/_drafts/{draftId}/`. Submit claims them for the quote in the submit transaction (timeline: `fromDraft`), then moves the bytes to the quote folder after the commit; a failed move is logged and retried on the next list of the quote's files (the file stays downloadable meanwhile). `SubmitIntakeResponse.attachments` counts them.
  - **Mode switches don't migrate files:** each row records its `storage`; a file in a store the server isn't configured for answers **503 `storage_unavailable`** instead of a broken link. Seeded synthetic rows have no bytes (`available: false`, download 404 `file_unavailable`).
  - **Data:** migration 0015 (Drizzle + hand-written RLS): `attachment.quote_id` nullable, `draft_id`, `stored_name`, `note`, `sha256`, `storage`, `storage_item_id`, `storage_path`, `removed_at` / `removed_by`, CHECKs (storage list, quote or draft or removed, removed consistency), `attachment.removeAny` in the permission CHECKs. RLS: a quote's files follow the quote; a draft's follow `quote_draft` (owner + Admin). New setting `attachment_settings` (provisional). The data dictionary is regenerated.
  - **UI:** `AttachmentsPanel` (`apps/web/src/components/attachments/`): kind + optional note, a drop zone with "choose files" (`accept` = the allowed extensions) and **"Take a photo"** (`accept="image/*" capture="environment"`, kind sample photo), per-file progress (XHR: fetch has no upload progress) with cancel, retry for server/network failures, and the type/size message before anything is sent (the domain's `checkUploadRequest`); content mismatches come back from the server with a clear message. The list shows kind, name, size, uploader, date and note, with Download and Remove (confirm). It replaces the B-07 placeholder in intake step 4 and is a new **Attachments** tab on the quote (`?tab=attachments`; the tab bar now scrolls horizontally on phones). Final Review's file names download through the audited route instead of linking to SharePoint directly.
  - **Tests:** domain `attachments.test.ts` (every format's sniff incl. renamed executables / HTML, sanitizing, folder templates, settings, upload / remove rules, drawing status; 100% lines); integrations: the **FileStore contract** (`graph/contract.ts`) run against `LocalFileStore`, `SharePointFileStore` on a mock Graph drive (`MockGraphDrive`: path/id addressing, upload sessions checking order, 320 KiB multiples and totals, moves, paging) and `BlobFileStore` on a memory container, plus SharePoint specifics (exact 5 MiB ranges, no bearer on the upload URL, session cancelled on failure, retries, 403, paging, token failure leaks nothing) and the live run behind `SP_LIVE_TEST=1` (skipped; not yet run); db: RLS for draft files; API `attachments.int.test.ts` (17: upload + drawing status + timeline + audit, no overwrite, list for all 8 roles, type / content / size / short / long / kind / missing-file / 415 errors with nothing stored, upload 403 for Approver / Leadership / Admin, download 302 + JSON + signed link bytes + tampered / expired links + audit, **an owner-scoped KAM can't list, download or remove another KAM's file (404, nothing audited)**, metadata-only rows, remove rules and the 24 h window, draft upload / owner-only / Admin read, **draft → quote move on submit**, draft deletion, the same flow on SharePoint (mock Graph) and Blob (memory), 503 for another store's file, `FILESTORE_MODE` → implementation), `attachments.stream.int.test.ts` (**a 50 MB upload through a real socket grows RSS by < 50 MB** on the local store and on SharePoint in ten 5 MB ranges; the integration pool runs with `--expose-gc` so the sampler measures retained memory, and the client is `node:http` with backpressure, because `fetch` with a streamed body was measured buffering the whole file itself), config tests, 7 routes in the permission-matrix registry; Playwright `attachments.spec.ts` (upload with note, drawing status toast, client-side type error, server content error, axe, download bytes, timeline, remove; Approver reads only; intake step 4 upload mirrors the drawing status, submit, file on the quote; 390 × 844 camera input + photo upload, no horizontal scroll).
  - **Fixed on the way:** `pricing.spec.ts` clicked "Use as reference" by role, which matches twice when the shuffled opportunity's own ERF adds a second BPR; it now clicks `use-bpr-BPR-482111`. The dictionary test's identifier pattern now allows digits (`sha256`).

### B-17: Role dashboards and operational analytics (F-02 complete, F-17 subset, CR-55) · **Thu Nov 5** · Ben
- **People:** **M6 (Oct 22)** with D&A for definitions; R3 for the leadership view.
- **Done when:**
  - [ ] **KAM:** my pipeline, my drafts, returned-to-me
  - [ ] **EngLead:** queue health (count, aging buckets, unassigned)
  - [ ] **Pricing:** quoting queue
  - [ ] **Approver:** pending approvals
  - [ ] **Leadership:**
    - pipeline value by stage
    - median time in stage
    - outcome capture rate
    - win rate (decided only, shown with the capture rate)
    - priority distribution
    - override frequency
  - [ ] labelled "operational, not D&A-certified"
- **Prompt:** `prompts/B-17-dashboards-analytics.md`

### B-18: Notifications (P0 minimum: assignment alerts, in-app + email) · **Thu Nov 5** · Ben
- **People:** M7, for the shared mailbox and application access policy.
- **Done when:**
  - [ ] in-app bell with unread count
  - [ ] events: new item in the engineering queue (to EngLead), assigned (to engineer), returned (to KAM), awaiting approval (to Approver), G4 decided (to KAM)
  - [ ] email via Graph for the same events, with per-user opt-out
  - [ ] failures logged and an owner alert raised
  - [ ] Teams digest and SLA/stale alerts deferred to P1
- **Prompt:** `prompts/B-18-notifications.md`

### B-19: Admin configuration console (CR-51) · **Fri Nov 6** · Ben
- **People:** the Knowledge Steward (unassigned). Bailey acts as interim approver of config values.
- **Done when:**
  - [ ] Admin screens for value lists, reason codes, stage/gate labels, app settings, scoring model (new version with change reason; never edit in place), user scope view
  - [ ] every change is versioned and audited, forming a minimal decision log (F-21 seed)
- **Prompt:** `prompts/B-19-admin-config.md`

---

## Phase 4: Harden, load, UAT, sign-off (Nov 6–13)

### B-21: Security, access and quality hardening · **Fri Nov 6** · Ben
- **People:** **M8 (Oct 30)**; IT security for U4 (Nov 11).
- **Done when:**
  - [ ] permission-matrix tests cover **every** route × role (allowed and denied)
  - [ ] RLS tests
  - [ ] redaction tests
  - [ ] CSP/helmet, rate limits, upload limits
  - [ ] `pnpm audit` and gitleaks clean
  - [ ] a11y pass (axe) on the core flows
  - [ ] mobile pass at 390 px
  - [ ] load test (k6): 50 users, p95 < 400 ms
  - [ ] runbook draft
- **Prompt:** `prompts/B-21-hardening.md`

### B-22: Production data load and UAT environment prep · **Fri Nov 6** · Ben + IT/D&A
- **People:** **M9 (Nov 2)** confirms production-data approval (Oliver Kade, Brennan Paul); Rachel Dew switches the integration user to production; Bailey confirms the UAT cohort and IT adds them to groups.
- **Done when:**
  - [ ] prod environment deployed
  - [ ] SF prod sync run and reconciled (count vs the SF report)
  - [ ] value lists approved, or flagged provisional
  - [ ] UAT users can sign in with the correct roles
  - [ ] synthetic data purged from prod
- **Prompt:** `prompts/B-22-prod-data-uat-env.md`

### B-23: UAT pack, in-app feedback, training aids · **Mon Nov 9 – Thu Nov 12** · Ben + Bailey
- **People:** UAT cohort (U1–U3), Bailey runs the sessions.
- **Done when:**
  - [ ] UAT scripts per role (in `docs/uat/`)
  - [ ] in-app "Report an issue" button that creates a feedback record with page + quote context
  - [ ] a 1-page quick-start per role
  - [ ] defect triage board
  - [ ] all Sev-1/2 defects fixed by Thu Nov 12
- **Prompt:** `prompts/B-23-uat-pack.md`

### B-24: Gate package and hand-off documentation · **Thu Nov 12 – Fri Nov 13** · Ben + Bailey
- **People:** U6 sign-off attendees.
- **Done when:**
  - [ ] solution design (from `01-architecture.md`)
  - [ ] requirements traceability matrix (PRD + CR → step → test)
  - [ ] test results
  - [ ] defect log
  - [ ] runbook + support model
  - [ ] release notes
  - [ ] P1/P2 backlog
  - [ ] signed UAT
- **Prompt:** `prompts/B-24-gate-package.md`

---

## Post-MVP backlog (P1 / P2, not before Nov 13)

| Item | Priority | Blocked by |
|---|---|---|
| Teams digest; SLA and stale-quote alerts | P1 | D-20 thresholds after baseline |
| Rules-based engineering routing | P1 | Pilot learning; D-19 |
| Ranger AI assist (suggested score, missing fields, drawing inference, similar quotes) | P1 | Contract execution (X-86); D-22 |
| Guided onboarding walkthrough per role | P1 | — |
| Fabric mirroring + D&A-certified analytics | P1 | Brennan Paul |
| MCP / API for Copilot and Cowork agents, user-scoped | P2 | IT agent-identity pattern |
| Full decision log and corrections ledger | P2 | Knowledge Steward |
| Post-award hand-off view (Nicole, Anne) | P2 | D-14 |
| Visit-to-win analysis | P2 | — |
| Salesforce write-back | Decide before scale | D-16 |
| CER / BPR integration | Scale | Capital-system redesign (Jan) |
