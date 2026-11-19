# FB-28 · Release guard: prove every migration applies on an existing database, and prove a merge reached the test site

**Run with:** Claude Code · **Opus 5.5** · **high** effort · **Wave 1** · one draft PR · branch `claude/fb-28-release-guard` · **merges first** (the other steps use its check)
**Ports:** Postgres `5441` · `E2E_PORT=3110` `E2E_DEV_API_PORT=3111` `E2E_WEB_PORT=4181` · **Migration:** none expected
**Feedback item:** N19-27 (`docs/build-guide/feedback/inputs/feedback-2026-11-19.md`) · **Tracker rows it follows:** BR-18 (the 2026-11-19 outage), B-20 (CI and deploy)

---

## Stop check
1. Follow `docs/build-guide/prompts/feedback/FB-28-to-33-ground-rules.md` in full.
2. **You own:** `scripts/` (new files), `packages/db/src/cli/` (a new `release-upgrade-check.ts`) and `packages/db/package.json` (one script), `.github/workflows/ci.yml`, the root `package.json` scripts, `packages/db/src/migrate.ts` and its tests (additive exports only), `docs/build-guide/04-decisions-and-risks.md` row BR-18 and `CLAUDE.md` rule 12 (the only shared-doc edits this step may make, and only if the command name changes), and a new `docs/build-guide/09-release-guards.md`. **Running beside you:** FB-29 to FB-31, which add migrations and nothing else of yours.
3. **Do not edit** `.github/workflows/deploy.yml` or `deploy-prod.yml`, infrastructure (`infra/`), or branch protection. You cannot test a deploy from here; a change you cannot test is a change that can break the test site again. Anything you want changed there goes into `09-release-guards.md` as a proposal for Ben.
4. This step touches no product behaviour. No route, permission, screen or table changes, so no permission matrix, Playwright or Fabric work applies; unit and integration tests do.

## What happened (the reason for this step; read `04-decisions-and-risks.md` BR-18 first)
- Drizzle applies a migration only when its journal `when` (`packages/db/migrations/meta/_journal.json`) is later than the newest one already recorded in the database. A migration (0053) carried a hand-set `when` about a day in the future; 0054 and 0055 merged after it and were **silently skipped** on the test database. Start-up then failed on a `COMMENT ON` for objects those migrations add (42703, then 42P01), the container exited 1, and every deploy failed from 05:54 to 13:34 UTC.
- CI never saw it, because `ci.yml` runs `pnpm db:migrate` on an **empty** database, which applies the whole journal in order.
- Already merged as fixes (PRs #117 and #118; read them, do not redo them): `packages/db/src/migrationJournal.test.ts` (each `when` strictly greater than the one before it); `runMigrations` in `packages/db/src/migrate.ts` realigns applied rows to the journal by hash, then throws `MigrationsNotAppliedError` naming any journal entry still unapplied; the start-up log prints it (`apps/api/src/startup.ts`); `packages/db/test/migrate-journal-reorder.int.test.ts`.
- **What is still open:** (1) nothing runs a PR's migrations on top of the database the test site actually has (`origin/main`'s), so a PR that adds a migration with a `when` earlier than something already on `main` still passes CI; (2) nothing tells a person or a script that a merge has reached the test site healthy; the orchestrator and Ben read GitHub Actions by eye.

## What the code does today (read 2026-11-19 at `c9ea359`; verify before relying on it)
- `ci.yml`: three jobs today, `verify` (45-minute cap, Postgres 16 service: lint, typecheck, unit, integration, build, `pnpm db:migrate && pnpm db:seed` on `ccq`, Playwright install, e2e), `audit` (dependency audit) and `secrets` (gitleaks, `fetch-depth: 0`). Triggers: `pull_request` and `push` to `main`. `concurrency` is keyed on the ref with `cancel-in-progress`, so a second push to `main` cancels the first run's CI: a cancelled run is not a failure. `deploy.yml` has its own `deploy-test` concurrency group, so a pending deploy can be superseded by a newer one.
- `deploy.yml` ("Deploy (test)"): runs after CI **succeeds** on a push to `main` (`workflow_run`), checks out the commit CI tested, builds, packages, deploys to the App Service `quoteflow-test` (repository variable `AZURE_WEBAPP_NAME`), then polls `https://<app>.azurewebsites.net/api/v1/health` for up to 10 minutes until the body has `"status":"ok"`, `"version":"<sha>"` and `"db":"up"`. A skipped run means CI did not succeed.
- Root scripts (`package.json`) include `verify`, `build`, `lint`, `typecheck`, `test`, `test:integration`, `e2e`, `db:migrate`, `db:seed`, `db:reset`, `db:dictionary`; no release scripts. `packages/db` runs its CLIs as TypeScript with tsx (`"db:migrate": "tsx --env-file-if-exists=../../.env src/cli/migrate.ts"`); the root package does **not** depend on `@ccq/db`, and `@ccq/db`'s exports are TypeScript source, so a plain `.mjs` in `scripts/` cannot import `runMigrations` or resolve `drizzle-orm` and `postgres`. `scripts/` holds `fabric-mirroring.sh` and `package-azure.sh`.
- **`runMigrations` does more than apply SQL** (`packages/db/src/migrate.ts` ~79-110): it also aligns applied rows to the journal, asserts every journal entry applied, runs `applyChangedComments` (builds `COMMENT ON` statements from the **branch's** Drizzle schema) and applies `sql/analytics` views. It accepts `{ migrationsDir, analyticsSqlDir }`. `ensureDatabase` (~224) and `dropAll` (~212) exist.
- **The App Service entry point is `apps/api/dist/azureStart.js`** (`scripts/package-azure.sh`): it runs `runMigrations` from `dist/db/migrations`, then `seedConfig`, then imports `server.js`. `server.js` alone does neither.
- `gh` is installed and authenticated on this machine (account `ben-whannai`) with access to `BenWhannPretium/QuoteFlow-CCQ-App-`. Repository variables `AZURE_WEBAPP_NAME` (`quoteflow-test`) and others are readable with `gh variable list`.

## Build

### A. `pnpm release:upgrade-check`: apply the branch's migrations on top of `main`'s, then start the API
A script written **in TypeScript** at `packages/db/src/cli/release-upgrade-check.ts` (run with tsx like the other CLIs; a package script `release:upgrade-check` in `packages/db/package.json`; the root `package.json` script `release:upgrade-check` delegates to it with `pnpm --filter @ccq/db`; no new dependency unless you justify it) that:
1. Takes a Postgres admin URL (`DATABASE_URL`) and a base ref (default `origin/main`; `--base <ref>` to override). It connects to that server, creates a **new, randomly named database** (`ensureDatabase` exists), refuses only if that name already exists, and drops the database at the end and on failure.
2. Writes the base ref's `packages/db/migrations/` (the SQL files, `meta/_journal.json` and snapshots) to a temp directory with `git archive` or `git show`, and applies **that** folder to the new database with drizzle's own `migrate()` and `readMigrationFiles` **only**. **Do not use `runMigrations` for this step**: it also applies the *branch's* `COMMENT ON` statements and analytics views, and on a base-migrated database any PR that adds a column would fail with 42703, which is the incident itself. This step stands in for "the database the test site has".
3. Runs the branch's full `runMigrations` (defaults) on the same database. It must finish without `MigrationsNotAppliedError`, and every tag in the branch's journal must be recorded as applied.
4. Checks the **journal against the base**: every entry the branch adds has `idx` one more than the one before it, a `tag` whose number matches `idx`, and a `when` strictly greater than the largest `when` on the base. Print the offending entry and the number it should use if not.
5. Starts the built API the way the App Service does, `node apps/api/dist/azureStart.js` (so its start-up migrate and config seed run too), against that database with the environment of the Playwright config's **dev-API** block (`apps/web/e2e/playwright.config.ts` ~131-148: `NODE_ENV`, `AUTH_MODE=dev`, `DATABASE_URL`, and a **free random port** you choose at run time (never 3000, 3100, 3101, 4173 or another session's: up to four builders may run this check at once); `SF_MODE` defaults to `fake` in `apps/api/src/config.ts`), polls `/api/v1/health` for up to 60 seconds for `"status":"ok"` and `"db":"up"`, then stops it. A start-up crash must print the last lines of its log.
6. Exits non-zero with one clear sentence per failure. Exit 0 prints what it proved, in three lines.
Add `"release:upgrade-check"` to the root `package.json`.
**Prove it works by breaking it on purpose.** In a scratch branch (do not commit it), reproduce the 2026-11-19 failure: give a new migration a `when` below `main`'s newest, and confirm the check fails and names it. Do the same for a migration whose journal `idx` repeats. Put the reproductions in the PR as commands and output, and add integration tests that do the same against temp journals (the `migrate-journal-reorder.int.test.ts` pattern).

### B. Run it in CI on every pull request, in parallel with `verify`
Add a job `upgrade` to `ci.yml` beside `verify`, `audit` and `secrets`: `pull_request` only, `fetch-depth: 0` (as `secrets` does), the Postgres 16 service, install, build the API and the packages it needs (not the web app unless the script needs it), `pnpm release:upgrade-check`. It must not lengthen the `verify` job, and must finish in about five minutes. Do not change `verify`. Say in the PR that Ben should add `upgrade` to the branch's required checks (you cannot).

### C. `scripts/wait-for-deploy.sh <sha> [timeout-minutes]`: has this merge reached the test site, healthy?
For the orchestrator and for Ben. It uses `gh`, `curl` and POSIX shell, and works from Git Bash on Windows and on Linux:
1. Waits (default 40 minutes) for the **CI** run on that commit, event `push`, branch `main`, to finish; fails fast if it concluded anything but success, printing the run URL and the failed job's name.
2. Waits for the **Deploy (test)** run for that commit to finish; fails if it did not succeed, printing the URL and the failing step. **Do not assume the run's `head_sha` is the commit CI tested:** for a run started by `workflow_run`, GitHub reports the default branch's tip at trigger time, and `deploy.yml` itself uses `github.event.workflow_run.head_sha || github.sha` for this reason. Check what `gh run list --workflow deploy.yml --json headSha,event,createdAt,conclusion` returns for a real run before relying on it; match on `event` `workflow_run` and a creation time after CI finished, and treat the health body's `version` as the final proof. A run that is `cancelled` is its own message (superseded): if a newer `main` commit exists, say so instead of reporting a failure, and do the same for a cancelled CI run.
3. Polls `https://<AZURE_WEBAPP_NAME from gh variable get>.azurewebsites.net/api/v1/health` until the body reports `"status":"ok"`, `"version":"<sha>"` and `"db":"up"`, up to 10 minutes.
4. Exit codes: 0 healthy on that sha; 10 CI failed or did not start; 11 deploy failed, was skipped or did not start; 12 the site did not report the sha healthy; 2 usage. One line of output per state change, so a log stays short.
Test it without a deploy: a `--dry-run` that prints the `gh` and `curl` commands it would run, and a Vitest or shell test that puts a fake `gh` and `curl` first on `PATH` and covers each exit code. Then run it for real once against the latest `main` commit (`c9ea359` or newer) and paste the output in the PR.

### D. Write `docs/build-guide/09-release-guards.md`, and update BR-18
1. What each guard catches and does not catch: the journal-order test, `runMigrations`' alignment and `MigrationsNotAppliedError`, the new upgrade check (and that it applies `main`'s migrations with the **branch's** migrator, so a bug in `migrate.ts` itself is not seen), `wait-for-deploy.sh`.
2. The rule for a migration's `when` (largest on `origin/main` plus 1) and how to renumber a PR after another migration lands.
3. **A rollback playbook for the test site**, written only from what you can verify in `deploy.yml` and in the Azure runbook `06-azure-entra-setup.md`: how to redeploy the last healthy commit by hand (the incident was restored by redeploying `bf115d0`), what the `test` environment's `url` and branch rules allow, and what is **not** verified. Mark every unverified step. Do not change `deploy.yml`.
4. **A proposal** (clearly labelled as such) for an automatic rollback or a slot swap in `deploy.yml`, with its risks. Ben decides.
5. BR-18 in `04-decisions-and-risks.md`: add one sentence naming the upgrade check and `wait-for-deploy.sh`.
6. Fix CLAUDE.md rule 12's mention of the check if the command name differs from `pnpm release:upgrade-check`.

## Tests
Integration (real Postgres): the upgrade check passes on the current branch; fails with a clear message for a `when` below the base's newest, a repeated `idx`, a tag number that does not match `idx`, and a migration that throws; the API start-up failure path prints the log tail. Unit or shell: each `wait-for-deploy.sh` exit code with a fake `gh` and `curl`. Do not weaken `migrationJournal.test.ts`.

## Questions to put to Ben (draft them; send nothing)
1. Add the `upgrade` job to the required checks on `main`?
2. Should `deploy.yml` roll back automatically if the smoke test fails (your proposal in `09-release-guards.md`)?

## Done when
- [ ] `pnpm release:upgrade-check` passes on this branch and fails, by name, on each deliberate breakage, with the output in the PR
- [ ] the `upgrade` job runs on pull requests beside `verify` and passes on this PR
- [ ] `scripts/wait-for-deploy.sh` has tests for every exit code and one real run against `main`
- [ ] `09-release-guards.md` and BR-18 written; the rollback steps marked verified or unverified
- [ ] `deploy.yml`, `infra/` and branch protection untouched
- [ ] `pnpm verify` passes; close-out file written (ground rules)
