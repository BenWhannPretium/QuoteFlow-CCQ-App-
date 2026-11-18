# Test plan and results (Gate 5, draft template)

> Checked against the build on 2026-11-17 (pre-release audit): CI trigger, the prod deploy workflow, the route inventory (129 routes), the B-21 checklist and the axe / mobile spec lists corrected; FB-15 to FB-20 suites and the audit's baseline run added.

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

`.github/workflows/ci.yml` runs on every pull request and on every push to `main`:

| Job | Steps |
|---|---|
| `verify` (Lint, typecheck, test, build, e2e) | install (frozen lockfile) → lint → typecheck → unit tests → integration tests (Postgres 16 service) → build → migrate + config seed (no synthetic data) → install Chromium → Playwright (every spec: the `smoke`, `shell` and `mobile` projects, axe included); the Playwright report is uploaded when the job fails. 45-minute limit (the job runs 25 to 30 minutes) |
| `audit` (Dependency audit) | `pnpm audit --audit-level=high` (two documented exceptions: GHSA-xcx6-jx8p-x3h5, `04` BR-13; GHSA-fc5q-39xc-vjpf, `04` BR-17) |
| `secrets` (Secret scan) | `gitleaks git --redact --exit-code 1 .` over the full history |

`.github/workflows/deploy.yml` (Deploy (test)) runs after CI passes on `main`: build, package, Fabric stop if migrations changed, deploy, smoke (waits for `/api/v1/health` to report the new commit with `db: up`), Fabric start and wait. First green run: Deploy (test) #6, 2026-10-21 (`03` B-20).

`.github/workflows/deploy-prod.yml` (Deploy (production), added 2026-11-12) is manual only, from `main` or a `v*` tag, behind the `production` environment's reviewer. It refuses unless the target resource group is `rg-ccq-prod`, CI has passed on the exact commit and the commit is on `main`; then the same build, package, Fabric stop, deploy and health smoke (up to 15 minutes), with a slot swap only when a slot is configured (none today).

| Evidence | Link | Owner |
|---|---|---|
| CI run used for sign-off (commit, date, all jobs green) | **TBD** | Ben |
| Deploy (test) run for the UAT build | **TBD** | Ben |
| Deploy (prod) run | First prod deploy: run 43285209403, commit `c471243`, 2026-11-12 (`03` B-22). Run for the release build: **TBD** | Ben |

## 3. Automated results recorded so far

### 3.1 Authorization

| Measure | Value | Source |
|---|---|---|
| Routes in the inventory | **129**: 3 public, 6 any signed-in role, 120 gated by a matrix permission (115 when this page was drafted) | `docs/security/route-inventory.md` (generated) |
| Permission-matrix run at completion | 111 routes × 9 MVP roles + anonymous = 1,111 cases (2026-10-26). The inventory has grown to 129 since, and the code now has twelve roles (Finance and ProductionScheduler added; PostAward has no dev persona, so the matrix signs in as eleven); re-read the case count from CI. | `03` B-21, FB-16 and FB-18 notes |
| Permissions checked in services (not at the route) | 6 listed today: the G1, G4 and G6 deciders, `outcome.assignOwner`, `override.revert`, `attachment.removeAny`, each with its feature test (8 when this page was drafted; G2 and G3 are no longer in that list) | `docs/security/route-inventory.md` |
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

**FB-15 to FB-20 suites** (added 2026-11-13 to 2026-11-16; files checked to exist on 2026-11-17, per-file counts not recorded here):

| Step | Unit | Integration | Playwright |
|---|---|---|---|
| FB-15 intake fixes | `packages/domain/src/intake/fb15.test.ts`, `apps/web/src/intake/fb15.test.ts` | `apps/api/test/fb15-intake.int.test.ts`, `packages/db/test/fb15-migration.int.test.ts` | `apps/web/e2e/fb15.spec.ts` |
| FB-16 Engineering & Capacity, Production Scheduler | `packages/domain/src/engineering/fb16.test.ts` | `apps/api/test/fb16-engineering-capacity.int.test.ts`, `packages/db/test/fb16-migration.int.test.ts` | `apps/web/e2e/fb16.spec.ts`, `engineering.spec.ts` |
| FB-17 gate decisions and holds | `packages/domain/src/engineering/capital-needed.test.ts`, `packages/domain/src/workflow/hold-owner.test.ts`, `apps/web/src/lib/decision-groups.test.ts`, `hold-text.test.ts` | `packages/db/test/fb17-migration.int.test.ts`; API cases inside `admin-config`, `gates`, `engineering`, `pricing`, `final-review` and `outcome` `.int.test.ts` (there is no `fb17-*.int.test.ts` under `apps/api/test`) | `apps/web/e2e/fb17.spec.ts` |
| FB-18 Command Center | `packages/domain/src/workflow/hold-list.test.ts`, `apps/web/src/lib/command-center.test.ts`, `save-status.test.ts`, `apps/web/src/components/HoldChip.test.tsx`, `SalesforceLink.test.tsx` | `apps/api/test/fb18-command-center.int.test.ts` | `apps/web/e2e/fb18.spec.ts` |
| FB-19 multi-item quotes | `packages/domain/src/intake/fb19-items.test.ts`, `packages/domain/src/workflow/item-rules.test.ts`, `packages/contracts/src/fb19.test.ts`, `apps/web/src/intake/fb19.test.ts` | `apps/api/test/fb19-multi-item.int.test.ts`, `packages/db/test/fb19-migration.int.test.ts` | `apps/web/e2e/fb19.spec.ts` |
| FB-20 offer letter | `packages/domain/src/offer-letter/offer-letter.test.ts`, `apps/api/src/documents/offer-letter-docx.test.ts`, `apps/web/src/components/outcome/offer-letter.test.ts` | `apps/api/test/fb20-offer-letter.int.test.ts`, `packages/db/test/fb20-migration.int.test.ts` | `apps/web/e2e/offer-letter.spec.ts` |

**Baseline run, 2026-11-17 (pre-release audit; `docs/audit/00-baseline.md`).** `origin/main` at `06c02c5`, the commit before the audit's fixes, run locally on Windows under Node 22:

| Step | Result |
|---|---|
| Typecheck | pass |
| Unit tests | contracts 20, domain 2273, web 253, db 66, api 194 passing; integrations 152 passing, 2 failing, 4 skipped |
| Integration tests | db 224 passing; api 2322 passing, 1 failing |
| Playwright | 156 passing, 3 failing, 1 skipped |

The two integrations failures, the one api integration failure and two of the three Playwright failures are one Windows-only defect in the ExcelJS streaming reader on small workbooks; Linux and CI are green. The third Playwright failure (`fb19.spec.ts`, a 3-minute hang) is intermittent and matches a connection-pool starvation defect fixed on the audit branch `claude/audit-prerelease`. CI on `main` is green.

Total suite counts for the sign-off build: **TBD** from the CI run (Ben).

### 3.3 Performance and volume

| Measure | Target | Result | Where / when | Source |
|---|---|---|---|---|
| Quote list API p95, ≥ 500 open quotes | < 300 ms | 95 ms (p50 60 ms) | Cloud dev container, 560 open quotes, 2026-10-16 | `03` B-14 |
| Board API p95 | < 1 s | 230 ms | same | `03` B-14 |
| Board render, 560 cards | < 1.5 s | 945 ms | same | `03` B-14 |
| k6, 50 VUs, all read paths, p95 | < 400 ms | 298 ms, 0% failed | **Local only**, dev mode, 150 synthetic quotes, 1-minute hold, 2026-10-26 | `tests/load/README.md` |
| k6, 50 VUs, 10 minutes, **test** environment | < 400 ms, failed < 1% | **TBD** (not yet run; the per-user limiter it waited on is in since 2026-10-27; the `03` B-21 box is still open) | Azure test | Ben (B-21) |
| Salesforce first full sync | — | 31,947 opportunities, 0 errors, 51 s | Production org, 2026-10-24 | `03` B-06 |
| Pricing-history import | — | 47,284 records, none skipped, 33 s; re-import writes nothing (27 s); lookups < 0.11 s | Scratch database | `03` B-15 |
| 50 MB upload memory | RSS growth < 50 MB | passes (local store; SharePoint mock in 5 MB ranges) | CI | `apps/api/test/attachments.stream.int.test.ts` |

### 3.4 Accessibility and mobile

| Measure | Result | Source |
|---|---|---|
| axe (WCAG 2.1 A/AA), no serious/critical | Scanned in `a11y.spec.ts`, `intake.spec.ts`, `g1.spec.ts`, `overrides.spec.ts`, `engineering.spec.ts`, `pricing.spec.ts`, `final-review.spec.ts`, `outcome.spec.ts`, `pipeline.spec.ts`, `dashboards.spec.ts`, `dashboards.mobile.spec.ts`, `notifications.spec.ts`, `admin-config.spec.ts`, `admin-integrations.spec.ts`, `attachments.spec.ts`, `feedback.spec.ts`, `mobile.spec.ts`; and, added since, `fb04.spec.ts`, `fb08.spec.ts`, `fb10.spec.ts`, `fb15.spec.ts` to `fb19.spec.ts`, `final-review-unblock.spec.ts`, `notifications-handoff.spec.ts`, `offer-letter.spec.ts`, `quoting-steps.spec.ts`, `workflow-integrity.spec.ts` (30 spec files call the axe helper on 2026-11-17); green in CI when last recorded | `apps/web/e2e/*.spec.ts`, `03` notes |
| 390 × 844: no horizontal scroll, tap targets ≥ 44 px | Checked in `mobile.spec.ts`, `dashboards.mobile.spec.ts`, `final-review.spec.ts`, `intake.spec.ts`, `notifications.spec.ts`, `attachments.spec.ts`, `pipeline.spec.ts`; since then also `final-review-unblock.spec.ts` (mobile project) and, at a 390 px width inside the spec, `fb18.spec.ts`, `fb19.spec.ts`, `offer-letter.spec.ts` | `03` notes |
| Colour contrast tokens | Enforced by unit test | `apps/web/src/styles/tokens.test.ts` |
| B-21 consolidated a11y and mobile pass | Both boxes ticked in `03` B-21 | Ben |

### 3.5 B-21 hardening checklist (from `03`)

| Item | Status 2026-11-17 (from the `03` B-21 checklist) |
|---|---|
| Permission matrix, every route × role | Done 2026-10-26 |
| RLS suite | Ticked (2026-10-27 review) |
| Redaction suite (every quote-returning route + CSV) | Ticked (2026-10-27 review). Since 2026-10-30 every role holds `quote.read.commercialFields`, so the redaction code strips nothing today; the tests prove the mechanism |
| CSP / helmet, rate limits, upload limits | Ticked. The rate limiter is per signed-in user (`apps/api/test/rate-limit.int.test.ts`) and counts API requests only |
| `pnpm audit` and gitleaks clean | Ticked; in CI on every pull request and push to `main` |
| a11y pass on the core flows | Ticked |
| Mobile pass at 390 px | Ticked |
| Load test 50 users p95 < 400 ms on test | Open (local only) |
| Hardening report `docs/security/hardening-report.md` | Not started (the file does not exist) |

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
