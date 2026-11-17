# 00: Baseline before any change

Pre-release audit, 2026-11-17. This is the state of `origin/main` at `06c02c5` (PRs #98 to #106 merged) on a clean checkout, before the audit touched anything. The end-of-audit run is compared with it in `01-prod-readiness.md`.

## How it was run

- Windows 11, Node 22.23.3 (the repo's `.nvmrc`; the machine's default Node 24 is refused by `engine-strict`), pnpm 9.15.9, Postgres 16 in Docker (`quoteflow-db-1`, local).
- Every run was inert: `SF_MODE=fake`, `FILESTORE_MODE=local`, `MAIL_MODE=fake`, `AUTH_MODE=dev`, no `FABRIC_*`, database host `localhost`. The developer's `.env` holds the same local values (checked by key and host only; no value was printed).
- Integration tests used the repo's own test databases (`ccq_test*`). The Playwright run used a dedicated database, `ccq_audit_e2e`, migrated and config-seeded exactly as CI does, so the developer's `ccq` database was not touched.
- CI on GitHub (Linux) was green on `main` for the four commits before this one.

## Result

| Step | Command | Result | Time | Counts |
|---|---|---|---|---|
| Install | `pnpm install --frozen-lockfile` | pass | 2 s | lockfile up to date |
| Lint | `pnpm lint` | **fail (local only)** | 164 s | ESLint clean. Prettier reported 260 files, every one under the untracked `.claude/worktrees/` (six stale local checkouts) |
| Typecheck | `pnpm typecheck` | pass | 19 s | 8 packages |
| Unit | `pnpm test` | **fail (Windows only)** | 37 s | contracts 20/20, domain 2273/2273, web 253/253, db 66/66, api 194/194 (13 files), integrations 152 pass, **2 fail**, 4 skipped |
| Integration | `pnpm test:integration` | **fail (Windows only)** | 1690 s | db 224/224 (25 files); api 2322 pass, **1 fail** (44 files) |
| Build | `pnpm build` | pass | 40 s | |
| e2e database | `pnpm db:migrate && pnpm db:seed` | pass | 17 s | config seed only |
| Playwright | `pnpm --filter @ccq/web e2e` | **fail** | 266 s | 156 pass, **3 fail**, 1 skipped |

The integration time is not representative: other audit work ran on the machine at the same time. CI reports 10 to 13 minutes.

A first Playwright run, made while that other work was using the CPU, failed four different tests (two 30-second timeouts in `g1.spec.ts` and `intake.spec.ts`, a notification count that follows from them, and the pricing import below). It was discarded and the suite was run again alone on a fresh database; the table shows that second run.

## The failures, diagnosed

### 1. Prettier scans local worktrees (environment)

`prettier --check .` walks `.claude/worktrees/`, which holds whole checkouts. Nothing in the repository is misformatted and CI has no such folder. Fixed by ignoring `.claude/` in `.prettierignore`.

### 2. The ExcelJS streaming reader loses the end of a small workbook on Windows (environment; a latent race everywhere)

One cause behind five failures: `integrations` unit tests `exportReader.test.ts` (2), api integration `pricing-history.int.test.ts` (1), and Playwright `admin-integrations.spec.ts` and `pricing.spec.ts` (2). Each reads a small `.xlsx` and gets "The file could not be read as an .xlsx workbook".

Root cause, reproduced in isolation outside the test runner:

- ExcelJS 4.4.0's `WorkbookReader` parks a worksheet in a temp file when the shared strings come after it in the zip (which is how Excel and ExcelJS both write files).
- Its `iterate-stream` helper treats the unzip stream's `end` event as "no more entries".
- `unzipper` 0.10.14 emits `end` as soon as its input is consumed, even while later entries are still buffered and unread.
- When the rest of the zip is small (every remaining entry under 16 KB), the parser finishes before the temp-file write does, the loop exits, and `xl/workbook.xml` (written last) is never parsed. The reader then fails on `this.model.sheets`.

Measured with one 6 KB workbook written by ExcelJS itself: on Windows, 40 of 40 reads fail under Node 22 and Node 24. In a Linux `node:22` container, 0 of 40 fail. CI (Linux) is green.

What it means:

- **Production (Linux) is not exposed in the normal case.** The race is still there in principle: a slow temp disk could lose it. If it did, a costing or payback summary would read "unavailable" (it never blocks the upload or G3), or a small pricing-history import would be refused and could be retried.
- **On a Windows machine** (a developer laptop, a demo run locally), summaries of small workbooks read "unavailable" and a small pricing-history import is refused, every time. Large files are unaffected (their entries stall the parser until they are read).

Not fixed in this audit: the defect is inside a dependency, and patching it the day before release carries more risk than the Windows-only symptom. It is written up with two fix options in `04-needs-ben.md`.

### 3. `fb19.spec.ts` hung for three minutes (intermittent)

"A KAM builds a three-item quote…" timed out on a click after 180 seconds in the clean run and passed in the first run. It is the busiest intake test. The audit found that every intake draft request takes a second pooled connection while holding one, which freezes the API when ten such requests overlap (`01-prod-readiness.md`, A-01). That matches the symptom; it is not proven to be the cause of this particular run.

## Bundle sizes (the baseline build)

`apps/web/dist`: 137 files, 11,840 KB in total.

| Part | Size |
|---|---|
| JavaScript (no source maps) | 2,103 KB |
| CSS | 72 KB |
| Fonts | 484 KB |
| Source maps (served publicly today) | 9,127 KB |

Largest chunks: `vendor` 638 KB, `index` 369 KB, `msal` 247 KB, `tanstack` 158 KB, `zod` 97 KB, `radix` 96 KB, the quote page 87 KB, intake 83 KB.

`apps/api/dist`: `server.js` 872 KB, the shared chunk 1,636 KB, `azureStart.js` 114 KB (plus source maps).

## Dependencies

`pnpm audit`: 0 critical; 1 high, which is the documented exception (`GHSA-xcx6-jx8p-x3h5`, `@azure/msal-node` through `@azure/identity`, risk BR-13) and is still the only path to it; 13 moderate; 6 low. `pnpm audit --audit-level=high`, the CI check, exits 0. The moderate ones that run in production are listed in `04-needs-ben.md`.

## Infrastructure as code

`az bicep build` and `az bicep lint` on `infra/main.bicep`, and `build-params` on both parameter files: clean, no warnings (Bicep CLI 0.49.2). Nothing was run against Azure.

## Test-suite quality (skim)

- **Skipped by design:** two live contract suites (`sharepoint.live.test.ts`, `salesforce/contract.live.test.ts`) that need real credentials; `board-perf.spec.ts` unless `PERF_E2E=1`; one conditional skip in `intake.spec.ts` when the chosen opportunity has no default ship-to. No `.only`, no `.todo`.
- **Order-dependent:** the Playwright `shell` project shares one database across spec files, and at least one assertion counts rows other tests create (`notifications.spec.ts` expects an exact unread count). When an earlier test fails, later ones fail for that reason alone, as the discarded first run showed.
- **A gap in the policy test:** `packages/domain/src/policy/can.test.ts` checks every permission against every role with no resource, so a grant that is qualified (own, assigned, in a stage) always reads as denied there; widening one would not fail that test. The route matrix and the feature tests cover the qualified cases. Listed in `02-code-audit.md`.
- **Tests that could not see production behavior:** the rate-limit test runs with no proxy and no SPA, so it could not catch either of the two rate-limit defects (A-06); the logger test checked the redaction helper alone, never a real log line, so it could not catch the empty error logs (A-02).
