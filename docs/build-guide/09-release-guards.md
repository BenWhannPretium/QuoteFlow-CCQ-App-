# 09 · Release guards: migrations that apply on an existing database, and merges that reach the test site

Added by FB-28 (2026-11-19), after the test outage recorded as BR-18 in [`04-decisions-and-risks.md`](04-decisions-and-risks.md) and as N19-27 in [`feedback/inputs/feedback-2026-11-19.md`](feedback/inputs/feedback-2026-11-19.md).

**What happened.** Drizzle applies a migration only when its journal `when` (`packages/db/migrations/meta/_journal.json`) is later than the newest one already recorded in the database. Migration 0053 carried a hand-set `when` about a day in the future; 0054 and 0055 merged after it with earlier values and were **silently skipped** on the test database. Start-up then failed on a `COMMENT ON` for a column 0054 should have added (42703, then 42P01), and every deploy failed from 05:54 to 13:34 UTC. CI did not see it, because CI migrates an **empty** database, which applies the whole journal in order.

## 1. The guards, and what each one does not catch

| Guard | Where it runs | Catches | Does not catch |
|---|---|---|---|
| **Journal order test** `packages/db/src/migrationJournal.test.ts` (PR #117) | `pnpm test`, CI `verify` on every push | A `when` not later than the entry before it **in the branch's own journal**; `idx` not 0..n; a SQL file without an entry or the reverse | A `when` that is in order in the branch's journal but not later than something **already applied on a real database**: a migration merged and then reverted, or one that landed on `main` after the branch was cut. It never looks at a database. |
| **`runMigrations` alignment and `MigrationsNotAppliedError`** `packages/db/src/migrate.ts` (PRs #117, #118) | Every API start (`apps/api/dist/azureStart.js`), and `pnpm db:migrate` | Realigns applied rows to the journal by hash (a merged migration whose `when` was moved is not run twice), then **refuses to start**, naming every journal entry still unapplied, instead of failing later on an unexplained 42703 | It does not prevent the outage: it fires **at deploy time, on the test site**, which then still fails to start. It turns a mystery into a one-line log message (`[quoteflow-start] refusing to start … MigrationsNotAppliedError`). |
| **`pnpm release:upgrade-check`** `packages/db/src/cli/release-upgrade-check.ts` (FB-28) | CI job **Migration upgrade check** (`upgrade`) on every pull request; locally before a PR is ready | Applies the base ref's (`origin/main`'s) migrations folder and analytics views to a new database with drizzle's own migrator (the database the test site has), then the branch's full `runMigrations` on top, then starts the built API as the App Service does and waits for `/api/v1/health` to say `"status":"ok"` and `"db":"up"`. Fails, by name, on: a new entry whose `when` is not above the largest `when` **ever merged** to the base (read from the base's first-parent history of `_journal.json`, so a reverted migration still counts); a new entry whose `idx` does not follow, or whose tag number does not match its `idx`; a base migration missing from the branch (rebase first); a branch migration that throws on a base-shaped schema (it names the migration and the Postgres code); a migration drizzle skips; schema comments or analytics views that fail after the upgrade; an API that will not start (it prints the last 30 lines of its log). | See the list below this table. |
| **`scripts/wait-for-deploy.sh <sha>`** (FB-28) | By hand or by the orchestrator, after a merge | Says, with an exit code, whether the merge commit's CI passed, whether the **Deploy (test)** run that CI started succeeded (and which job or step failed if not), and whether `https://<AZURE_WEBAPP_NAME>.azurewebsites.net/api/v1/health` reports that commit with the database up. Exit 0 healthy; 10 CI failed or did not start; 11 deploy failed, skipped or did not start; 12 the site did not report the commit healthy; 13 **superseded** (a newer `main` commit cancelled this one's CI or deploy: run it again for the commit it names); 2 usage or `gh` not usable. `--dry-run` prints the `gh` and `curl` commands. | It prevents nothing; it reports. It cannot judge a hand-started deploy (it follows the deploy CI started). It matches the deploy run by time (the first one created after CI finished, within 30 seconds of skew), because a `workflow_run`'s `headSha` is `main`'s tip when it was triggered, not the commit CI tested (seen on 2026-11-19: run 44478104047 carries 9d92c86 but was triggered by an older cancelled CI run); two CI runs on `main` finishing within the same seconds could confuse it, so the health body's `version` is the final proof. |

**What the upgrade check does not catch**, so nobody reads more into a green tick than it proves:

1. **A bug in `migrate.ts` itself.** The base step applies `main`'s migrations with **this branch's** copy of drizzle and of `ensureRoleMembership`, and the API step runs this branch's `runMigrations`. A change that breaks the migrator for databases it did not create is not seen. (The base's own `migrate.ts` is not run, because running the base's TypeScript would need a second install.)
2. **Data.** The base database has no rows: the base's config seed and the synthetic data the test site loads (`SEED_SYNTHETIC_DATA=true`) are not applied before the branch's migrations, because they are the base's TypeScript, not SQL. A migration that fails only when a table has rows (a `NOT NULL` column without a default, a unique index over duplicates, a data `UPDATE` that hits a check constraint) passes here. The branch's own config seed does run when the API starts.
3. **The test site's real state, if it is not `main`'s.** A hand-run SQL fix, a deploy of a branch other than `main` (the `test` environment allows any branch; §3), or a rollback that left newer rows behind.
4. **Azure differences.** The admin login on Azure Database for PostgreSQL is not a superuser and has no BYPASSRLS (`ensureRoleMembership` exists for this); extensions, server parameters and the PostgreSQL minor version can differ; Fabric mirroring of the test database (DDL on a mirrored table) is not exercised.
5. **Two pull requests that each pass alone.** GitHub runs a pull request's checks on its merge with the base **as it was when the checks ran**; when another migration merges first, the second PR's green check is stale until it is pushed again. The journal file usually conflicts in that case (both append at the end), which forces a rebase, but not always. §2 says what to do; §5 proposes making it automatic.
6. **Production.** The base is `origin/main`, the database the **test** site has. Production (B-22) will be behind `main`; check against the commit production runs with `--base <sha>`.

## 2. The rule for a migration's `when`, and how to renumber

**A new migration's `when` is the largest `when` ever merged to `origin/main`, plus 1** (CLAUDE.md rule 12). "Ever merged" includes a migration that was merged and later reverted: a revert does not un-apply it on a database that already ran it, and that database will skip anything with a smaller `when`. Never the clock (`drizzle-kit generate` writes `Date.now()`, which can be lower than an existing entry) and never a hand-set future date.

You do not have to work the number out: run the check and it tells you.

```bash
git fetch origin
pnpm release:upgrade-check            # needs DATABASE_URL (a server where it may create a database) and `pnpm build`
```

On failure it prints, for each new entry, the number and `when` to use, for example:

```
- `0056_fb28_repro` has `when` 1795150000001, not above 1795150000002, the largest `when` ever merged to origin/main (ae869d0): drizzle would skip it on the test database, so use number 0056 (idx 56) and `when` 1795150000003.
```

**When another migration lands on `main` before yours:**

1. `git fetch origin && git rebase origin/main`. Resolve `_journal.json` by **keeping both sides**: `main`'s entries first, unchanged, then yours.
2. Renumber yours to follow `main`'s last entry with no gap: the SQL file name, `meta/NNNN_snapshot.json`, and the entry's `idx` and `tag` in the journal.
3. Set its `when` to the number the check prints (the largest ever merged, plus 1; plus 2 for a second new entry, and so on).
4. Regenerate generated files (`pnpm db:dictionary`, the route inventory) rather than hand-merging them.
5. `pnpm build && pnpm release:upgrade-check` until it prints three `ok` lines, then push. The CI `upgrade` job re-runs on the push.

Useful flags: `--base <ref>` (a stacked PR, or production's commit), `--no-api` (skip the API start: a partial check for a quick loop, never in CI), `--timeout <seconds>` (default 60 for the API's health). Exit codes: 0 passed, 1 a check failed (one sentence per failure), 2 usage or setup (no `DATABASE_URL`, unknown base ref, a shallow clone, the API not built).

## 3. Rollback playbook for the test site

Written from `.github/workflows/deploy.yml`, runbook [`06-azure-entra-setup.md`](06-azure-entra-setup.md) (Part E) and the GitHub Actions history of 2026-11-19. **[verified]** means checked against the workflow file, GitHub's API or the Actions history on 2026-11-19; **[unverified]** means nobody has done it or checked it yet. `deploy.yml` is unchanged by FB-28.

**What the workflow and the environment allow**

- [verified] **Deploy (test)** runs on `workflow_run` (after **CI** completes on `main`; the job runs only if CI succeeded on a `push`) and on `workflow_dispatch` (**Run workflow**). For `workflow_run` it checks out `github.event.workflow_run.head_sha`, the commit CI tested; for `workflow_dispatch` it checks out `github.sha`, the tip of the branch or tag chosen in **Use workflow from**. (`deploy.yml`, the `ref:` of the checkout step.)
- [verified] The job uses the GitHub environment `test`, whose `url` is `https://<AZURE_WEBAPP_NAME>.azurewebsites.net` (`AZURE_WEBAPP_NAME` = `quoteflow-test`). On 2026-11-19 the environment had **no protection rules and no deployment branch policy** (`gh api repos/{owner}/{repo}/environments/test`: `protection_rules: []`, `deployment_branch_policy: null`), so **any branch or tag** can be deployed to test with **Run workflow**, with no approval. The Azure side trusts `environment:test` only (runbook 06 B8), so that is the gate.
- [verified] Deploys queue in the `deploy-test` concurrency group without cancelling the one running; a pending deploy is replaced by a newer one.
- [unverified] Branch protection and rulesets on `main`: the account used for FB-28 has no admin rights, and the API answered 404 (no protection, or no permission to see it).

**A. Re-run the last good deploy (how the 2026-11-19 outage was ended).** [verified from the Actions history]
1. Find the last commit that was healthy on test: the latest **Deploy (test)** run that succeeded and whose smoke test printed `healthy on <sha>`. On 2026-11-19 that was `bf115d0` (run 44463571762, first attempt 05:12 UTC, success).
2. Open that run → **Re-run all jobs**. A re-run replays the original `workflow_run` event, so it checks out and deploys **the same commit** again (it does not pick up `main`'s tip). On 2026-11-19 attempt 3 of run 44463571762 (13:29:50 to 13:43:16 UTC) did this.
3. **Judge by `/health`, not by the colour of the run.** On 2026-11-19 that attempt's **Deploy** step ended red (`az webapp deploy` was still polling "Starting the site…" at its limit) although the site was back about 13:34; App Service's own deployment history records that zip deploy (`OneDeploy`) as completed, 13:32:02 to 13:32:46 UTC [verified in Azure, 2026-11-19]. Check: `curl -fsS https://quoteflow-test.azurewebsites.net/api/v1/health` reports `"version":"<the good sha>"` and `"db":"up"`.
4. [unverified] GitHub allows a re-run only for a limited time after the original run (GitHub's documentation says 30 days); after that, use B.

**B. Run workflow on a ref that points at the good commit.** [unverified: not done yet]
1. Make a branch at the good commit: `git push origin <good-sha>:refs/heads/rollback/<good-sha>` (needs push rights).
2. **Actions → Deploy (test) → Run workflow**, **Use workflow from** `rollback/<good-sha>` → **Run workflow**. The run uses that ref's `deploy.yml` and checks out its tip (`github.sha`).
3. Check `/health` as in A3, then delete the branch.

**C. Revert on `main`** (the documented path, runbook 06 Part E). [verified as documented; slowest]
Revert the bad merge with a pull request; CI (about 25 to 30 minutes) then deploys the reverted code. Use `scripts/wait-for-deploy.sh <revert-merge-sha>` to know when it is live. A revert does **not** undo migrations (the next point) and its `when` values stay "ever merged" (§2).

**Points that apply to every rollback**

- [verified in code] **Migrations do not roll back.** Older code starts on a newer schema. Since PR #117, `runMigrations` ignores applied rows it does not know (a newer build ran here before a rollback); builds older than PR #117 (`72e69ae`) do not have that tolerance [unverified what they do]. Older code works on a newer schema only while migrations add and never drop or rename (rule 10: deprecate, never drop) [unverified for any given pair of commits].
- [verified in code] **Fabric mirroring.** If the Fabric variables are set, a deploy whose migrations folder differs from the deployed commit's stops mirroring first and restarts it after (`scripts/fabric-mirroring.sh migrations-changed`); a rollback across a migration counts as a change. [unverified in a real rollback]
- [verified in Azure, 2026-11-19] The plan `asp-quoteflow-test` is **B1 (Basic), one worker**, and `quoteflow-test` has **no deployment slots** (`az appservice plan show`, `az webapp deployment slot list`). The app's last ten deployments (2026-11-18 23:43 to 2026-11-19 18:28 UTC) are all `OneDeploy`, the zip deploy `deploy.yml` runs, and all completed; none was made by hand, including during the outage.
- [unverified] Redeploying from the Azure portal (Deployment Center) or `az webapp deploy` from a laptop: possible in principle with Contributor on `rg-ccq-test`, not documented in runbook 06 and not tried. Slots need Standard or higher (Azure's documentation; not checked here).

## 4. Proposal (for Ben to decide): roll back automatically, or swap slots

**This is a proposal only. `deploy.yml` is unchanged.**

**Option 1: automatic redeploy of the previous commit when the smoke test fails.** The deploy job already reads the deployed commit from `/health` before it deploys (the Fabric step). Record it in every run; add a final step, `if: failure() && steps.deploy.outcome != 'skipped'`, that checks out that commit, builds, packages, deploys and smoke-tests it, then **still fails the job** so the red run is seen.
- Risks: the old code then runs on whatever the new build's start-up did to the database. Drizzle applies all pending migrations in **one transaction**, so a build that failed **in** its migrations leaves the schema unchanged and the rollback is clean; a build that failed **after** them (config seed, comments, views, server start) leaves the schema upgraded, and the old code must cope (the "migrations do not roll back" point above). A deploy takes about twice as long when it fails. A rollback that also fails leaves the site down with two red deploys to read. Fabric mirroring is stopped and restarted twice. The deployed commit is unknown when `/health` does not answer (as during the outage), so the step needs a fallback: the last successful **Deploy (test)** run's commit, read with `gh run list`.
- Cost: none in Azure. Effort: about half a day, testable only on test itself.

**Option 2: deploy to a staging slot and swap.** Deploy to a `staging` slot, wait for its `/health` to report the new commit with the database up, then `az webapp deployment slot swap`. The site never serves a build that did not start.
- Risks: needs the plan raised from B1 (verified in Azure) to Standard (S1) or higher, a cost IT and Ben must approve. The slot shares the database, so the new build's migrations run on the live database **before** the swap, while the old build is still serving: the same forward-only caveat as Option 1, during the warm-up window. Slot settings must be marked sticky where they differ (`APP_ENVIRONMENT`, `ENTRA_ROLE_PREFIX`); the slot's managed identity needs its own Key Vault access, or the `DATABASE_URL` reference does not resolve; Fabric mirroring's stop and start would wrap the slot deploy. Production is already planned with a staging slot (runbook 06 §5, `infra/`), so this is the same pattern earlier.

**Suggested order** (Ben decides): (a) make the **Migration upgrade check** a required check and turn on "Require branches to be up to date before merging" on `main`, which removes the cause and the stale-check gap (§1 item 5); (b) Option 1 on test as a cheap safety net; (c) Option 2 when production is built.

## 5. Questions for Ben

1. Add the `upgrade` job (**Migration upgrade check**) to the required status checks on `main`? It is in `ci.yml` from FB-28 and runs on pull requests only. Adding a required check needs a repository admin.
2. Turn on "Require branches to be up to date before merging" on `main`, so the upgrade check always ran against the current `main`? It makes every PR re-run CI after each merge (about 25 to 30 minutes for `verify`).
3. Should `deploy.yml` roll back automatically if the smoke test fails (§4 Option 1), or wait for slots (Option 2)?
