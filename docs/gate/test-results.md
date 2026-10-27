# Test plan and results (Gate 5, draft template)

**Status: DRAFT TEMPLATE, 2026-10-27.** Section 1–3 record the evidence that exists in the repo today. Sections 4–7 are empty until UAT week (Nov 9–12). Numbers below are **as recorded in `03-build-steps.md` at build time** unless a newer source is named; suites have grown since, so re-read the counts from the CI run used for sign-off.

Owner: Ben Whann (automated evidence), Bailey Schmitt (UAT results).

---

## 1. Test strategy

| Layer | What it proves | Where | Runs in |
|---|---|---|---|
| Unit (domain) | Stage/gate engine, policy and redaction, scoring, overrides, intake rules, pricing, final review, outcome, notifications, config admin. No I/O; 100% line coverage at B-02. | `packages/domain/src/**/*.test.ts` | CI `pnpm test` |
| Unit (other packages, web) | Connectors against fakes and mocks (Salesforce read-only guard, Graph upload sessions, mail MIME, pricing export mapper), contracts, design-token contrast, URL state | `packages/integrations/src/**/*.test.ts`, `packages/db/src/**/*.test.ts`, `apps/web/src/**/*.test.ts`, `apps/api/src/**/*.test.ts` | CI `pnpm test` |
| Integration (API + real Postgres) | Every feature's routes, audit rows, notifications, redaction per role, RLS through the API | `apps/api/test/*.int.test.ts` | CI `pnpm test:integration` (Postgres 16 service) |
| Permission matrix | Every `/api` route × every MVP role (allowed: not 401/403/5xx; denied: 403 problem+json naming the permission) and anonymous (401 unless public) | `apps/api/test/permissions/matrix.int.test.ts`; static twin `apps/api/src/routes/v1/routeMatrix.test.ts` keeps `docs/security/route-inventory.md` current | CI |
| Database / RLS | RLS by role and scope, `audit_event` append-only, quote-number concurrency, seeds idempotent, analytics definitions, Fabric mirror-safety | `packages/db/test/*.int.test.ts`, `packages/db/src/schema/fabricCompat.test.ts`, `packages/db/src/fabricTwins.test.ts` | CI |
| End-to-end (Playwright) | One happy path per stage, role shells, mobile 390 × 844, axe (WCAG 2.1 A/AA) in light and dark | `apps/web/e2e/*.spec.ts` | CI (Chromium) |
| Performance | List/board API p95 and board render on ≥ 500 open quotes | `apps/api/test/perf/pipeline.perf.test.ts`, `apps/web/e2e/board-perf.spec.ts` | Opt-in (`pnpm --filter @ccq/api test:perf`, `PERF_E2E=1`) |
| Load | 50 VUs on dashboard, list, detail, queue, board; p95 < 400 ms, failed < 1% | `tests/load/read-paths.js` (k6) | Manual (`pnpm load`) |
| Live contract | Salesforce and SharePoint against the real systems | `packages/integrations/src/salesforce/contract.live.test.ts`, `packages/integrations/src/graph/sharepoint.live.test.ts` | Manual (`SF_LIVE_TEST=1`, `SP_LIVE_TEST=1`) |
| Supply chain and secrets | High/critical advisories; secrets in full git history | `pnpm audit --audit-level=high`; `gitleaks git` | CI jobs `audit`, `secrets` |
| UAT | Each role's flows with gate-owner candidates; IT access test; tie-out | `docs/uat/scripts/*.md` | U1–U5 |

## 2. CI and deploy pipelines (evidence available today)

`.github/workflows/ci.yml` runs on every push and pull request:

| Job | Steps |
|---|---|
| `verify` (Lint, typecheck, test, build, e2e) | install (frozen lockfile) → lint → typecheck → unit tests → integration tests (Postgres 16 service) → build → migrate + config seed → Playwright (smoke, persona shell, mobile, axe); Playwright report uploaded |
| `audit` (Dependency audit) | `pnpm audit --audit-level=high` (one documented exception: GHSA-xcx6-jx8p-x3h5, `04` BR-13) |
| `secrets` (Secret scan) | `gitleaks git --redact --exit-code 1 .` over the full history |

`.github/workflows/deploy.yml` (Deploy (test)) runs after CI passes on `main`: build, package, Fabric stop if migrations changed, deploy, smoke (waits for `/api/v1/health` to report the new commit with `db: up`), Fabric start and wait. First green run: Deploy (test) #6, 2026-10-21 (`03` B-20).

| Evidence | Link | Owner |
|---|---|---|
| CI run used for sign-off (commit, date, all jobs green) | **TBD** | Ben |
| Deploy (test) run for the UAT build | **TBD** | Ben |
| Deploy (prod) run | **TBD** (no prod workflow yet, B-22) | Ben |

## 3. Automated results recorded so far

### 3.1 Authorization

| Measure | Value | Source |
|---|---|---|
| Routes in the inventory | **115**: 3 public, 6 any signed-in role, 106 gated by a matrix permission | `docs/security/route-inventory.md` (generated) |
| Permission-matrix run at completion | 111 routes × 9 MVP roles + anonymous = 1,111 cases (2026-10-26). The inventory has grown to 115 since; re-read from CI. | `03` B-21 notes |
| Permissions checked in services (not at the route) | 8: G1, G2, G3, G4, G6 deciders, `outcome.assignOwner`, `override.revert`, `attachment.removeAny`, each with its feature test | `docs/security/route-inventory.md` |
| Not exercised | `CCQ.PostAward` (P2, no dev persona) | `03` B-21 notes |

### 3.2 Feature suites (counts as recorded at build)

| Suite | Tests recorded | Step |
|---|---|---|
| `apps/api/test/engineering.int.test.ts` | 24 | B-10 |
| `apps/api/test/pricing.int.test.ts` | 19 | B-11 |
| `packages/domain/src/final-review/final-review.test.ts` / `apps/api/test/final-review.int.test.ts` | 48 / 30 | B-12 |
| `apps/api/test/outcome.int.test.ts` | 32 | B-13 |
| `apps/api/test/pipeline.int.test.ts` | 21 | B-14 |
| `apps/api/test/pricing-history.int.test.ts` | 22 | B-15 |
| `apps/api/test/attachments.int.test.ts` | 17 | B-16 |
| `packages/db/test/analytics.int.test.ts` / `apps/api/test/analytics.int.test.ts` | 20 / 42 | B-17 |
| Domain notifications / mail / templates / `apps/api/test/notifications.int.test.ts` | 29 / 12 / 38 / 33 | B-18 |
| Domain config admin / `apps/api/test/admin-config.int.test.ts` | 16 / 22 | B-19 |

Total suite counts for the sign-off build: **TBD** from the CI run (Ben).

### 3.3 Performance and volume

| Measure | Target | Result | Where / when | Source |
|---|---|---|---|---|
| Quote list API p95, ≥ 500 open quotes | < 300 ms | 95 ms (p50 60 ms) | Cloud dev container, 560 open quotes, 2026-10-16 | `03` B-14 |
| Board API p95 | < 1 s | 230 ms | same | `03` B-14 |
| Board render, 560 cards | < 1.5 s | 945 ms | same | `03` B-14 |
| k6, 50 VUs, all read paths, p95 | < 400 ms | 298 ms, 0% failed | **Local only**, dev mode, 150 synthetic quotes, 1-minute hold, 2026-10-26 | `tests/load/README.md` |
| k6, 50 VUs, 10 minutes, **test** environment | < 400 ms, failed < 1% | **TBD** (not yet run; needs `RATE_LIMIT_MAX` raised or the per-user limiter) | Azure test | Ben (B-21) |
| Salesforce first full sync | — | 31,947 opportunities, 0 errors, 51 s | Production org, 2026-10-24 | `03` B-06 |
| Pricing-history import | — | 47,284 records, none skipped, 33 s; re-import writes nothing (27 s); lookups < 0.11 s | Scratch database | `03` B-15 |
| 50 MB upload memory | RSS growth < 50 MB | passes (local store; SharePoint mock in 5 MB ranges) | CI | `apps/api/test/attachments.stream.int.test.ts` |

### 3.4 Accessibility and mobile

| Measure | Result | Source |
|---|---|---|
| axe (WCAG 2.1 A/AA), no serious/critical | Scanned in `a11y.spec.ts`, `intake.spec.ts`, `g1.spec.ts`, `overrides.spec.ts`, `engineering.spec.ts`, `pricing.spec.ts`, `final-review.spec.ts`, `outcome.spec.ts`, `pipeline.spec.ts`, `dashboards.spec.ts`, `dashboards.mobile.spec.ts`, `notifications.spec.ts`, `admin-config.spec.ts`, `admin-integrations.spec.ts`, `attachments.spec.ts`, `feedback.spec.ts`, `mobile.spec.ts`; green in CI when last recorded | `apps/web/e2e/*.spec.ts`, `03` notes |
| 390 × 844: no horizontal scroll, tap targets ≥ 44 px | Checked in `mobile.spec.ts`, `dashboards.mobile.spec.ts`, `final-review.spec.ts`, `intake.spec.ts`, `notifications.spec.ts`, `attachments.spec.ts`, `pipeline.spec.ts` | `03` notes |
| Colour contrast tokens | Enforced by unit test | `apps/web/src/styles/tokens.test.ts` |
| B-21 consolidated a11y and mobile pass | **TBD** (B-21 boxes open) | Ben |

### 3.5 B-21 hardening checklist (from `03`)

| Item | Status 2026-10-27 |
|---|---|
| Permission matrix, every route × role | Done 2026-10-26 |
| RLS suite | Open |
| Redaction suite (every quote-returning route + CSV) | Open (per-feature redaction tests exist) |
| CSP / helmet, rate limits, upload limits | Open (helmet registered in `apps/api/src/app.ts`; rate limiter per IP, being changed to per user) |
| `pnpm audit` and gitleaks clean | In CI on every push; formal sign-off open |
| a11y pass on the core flows | Open |
| Mobile pass at 390 px | Open |
| Load test 50 users p95 < 400 ms on test | Open (local only) |
| Hardening report `docs/security/hardening-report.md` | Not started |

## 4. UAT results (U1–U3)

Fill from the signed tables at the end of each script. Severity rules: `docs/uat/README.md`.

### U1: KAM and sales leader (Mon Nov 9) · `scripts/kam.md`, `scripts/sales-leader.md`

| Tester | Role | Date | Steps passed / total | Fails (step: defect id) | Overall | Signed |
|---|---|---|---|---|---|---|
| | KAM | | | | | |
| | KAM | | | | | |
| | Sales leader | | | | | |

### U2: Engineering (Tue Nov 10) · `scripts/engineering.md`

| Tester | Role | Date | Steps passed / total | Fails (step: defect id) | Overall | Signed |
|---|---|---|---|---|---|---|
| | Engineering lead | | | | | |
| | Engineer | | | | | |
| | Capacity analyst | | | | | |

### U3: Pricing, approver, leadership (Wed Nov 11) · `scripts/pricing.md`, `scripts/approver.md`, `scripts/leadership.md`

| Tester | Role | Date | Steps passed / total | Fails (step: defect id) | Overall | Signed |
|---|---|---|---|---|---|---|
| | Pricing lead | | | | | |
| | Pricing analyst | | | | | |
| | Approver | | | | | |
| | Approver | | | | | |
| | Leadership | | | | | |

## 5. U4: IT security and access test (Wed Nov 11) · `scripts/security-access.md`

| Tester | Role | Date | Steps passed / total | Findings | Overall | Signed |
|---|---|---|---|---|---|---|
| | IT security delegate | | | | | |
| | Builder (Ben Whann) | | | | | |

## 6. U5: Tie-out (Thu Nov 12) · `scripts/tie-out.md`

| Check | Expected | Result | Checked by |
|---|---|---|---|
| CCQ ↔ Salesforce: opportunity counts vs the SF report (same filter) | Match, or differences explained | | |
| CCQ ↔ Salesforce: field spot checks | Values match | | |
| CCQ ↔ pricing history: ERF spot checks | Values match the export | | |
| CCQ ↔ Fabric: row counts per table (B-27) | Match | | |
| CCQ ↔ Fabric: commercial columns hidden from a non-commercial reader | Hidden | | |

| Tester | Role | Date | Overall | Signed |
|---|---|---|---|---|
| | Salesforce (Zac Cairns) | | | |
| | Sales Ops (Graham Parle) | | | |
| | D&A | | | |
| | Builder (Ben Whann) | | | |

## 7. Defect log summary

From `pnpm uat:defects` (the log itself is git-ignored and shared on SharePoint).

| Severity | Raised | Fixed and retested | Open | Deferred to backlog |
|---|---|---|---|---|
| Sev-1 | | | | — (must be 0 open at U6) |
| Sev-2 | | | | — (must be 0 open at U6) |
| Sev-3 | | | | |
| Sev-4 | | | | |
