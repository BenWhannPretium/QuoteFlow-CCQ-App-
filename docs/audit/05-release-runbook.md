# 05: Release runbook (production)

This is the step-by-step for putting a build of QuoteFlow on production (`rg-ccq-prod`, `https://quoteflow-prod.azurewebsites.net`) and for backing it out. It is for the person who dispatches the deploy and the person on call beside them. Written 2026-11-17 during the pre-release audit, from the repo as it stood on branch `claude/audit-prerelease`. Anything that needs the live subscription, the Entra tenant or GitHub settings is marked **not verified from the repo**. Steps the pipeline cannot do for you are marked **[manual]**. It extends `docs/gate/runbook.md` (a draft from 2026-10-27, written before prod existed); where the two differ, section 9 says so.

## 1. What a prod deploy is today

| Fact | Value | Source |
|---|---|---|
| Workflow | `.github/workflows/deploy-prod.yml`, manual (`workflow_dispatch`), from `main` or a `v*` tag | the workflow |
| Plan | B1, one instance, **no staging slot** (interim: quota) | `infra/main.prod.bicepparam` |
| Effect | Zip deploy, then the app **restarts in place**. Users are interrupted. | workflow `Deploy` step |
| Start-up | `node apps/api/dist/azureStart.js`: migrations (under a session advisory lock), config seed, then the server listens | `apps/api/src/azureStart.ts`, `packages/db/src/migrate.ts` |
| Duration | The first prod deploy took about 5 minutes from deploy to healthy; the job waits up to 15 | workflow comment, `03-build-steps.md` B-22 |
| Kept build | None. The zip is not saved as an artifact. | the workflow |

## 2. Pre-flight checklist

Do these before pressing **Run workflow**. None is done by the pipeline unless the last column says so.

| # | Check | How | Pipeline checks it? |
|---|---|---|---|
| 1 | The commit is merged to `main` and **CI is green on that exact SHA** | Actions → CI. CI takes 14 to 21 minutes after a merge; starting early fails the deploy. | Yes (refuses) |
| 2 | You know which migrations this deploy brings | `curl -s https://quoteflow-prod.azurewebsites.net/api/v1/health` gives the running `version` (a commit). Then `git diff --name-only <running-sha> <new-sha> -- packages/db/migrations`. Read section 6 for each file listed. | No **[manual]** |
| 3 | GitHub `production` environment variables | Settings → Environments → production: `AZURE_CLIENT_ID` (client id of `id-quoteflow-deploy-prod`), `AZURE_RESOURCE_GROUP` = `rg-ccq-prod`, `AZURE_WEBAPP_NAME` = `quoteflow-prod`. `AZURE_TENANT_ID` and `AZURE_SUBSCRIPTION_ID` may come from the repository variables. `AZURE_WEBAPP_SLOT` must be **empty** while there is no slot. Not verified from the repo. | Partly: refuses if the RG is not `rg-ccq-prod` or the app name is empty |
| 4 | `FABRIC_WORKSPACE_ID` / `FABRIC_MIRRORED_DB_ID` are empty for production **and not set at repository level** | Same page, plus Settings → Secrets and variables → Actions → Variables. A repository-level value is inherited by the production job and would point it at the test mirror. Not verified from the repo. | No **[manual]** |
| 5 | Environment protection rule: a required reviewer is set | Settings → Environments → production. `03-build-steps.md` B-22 records the repo owner as reviewer with self-approval allowed. Not verified from the repo. | GitHub enforces it |
| 6 | Entra app roles and groups exist | Enterprise applications → QuoteFlow-API → Users and groups: each `SG-CCQ-<Role>` group holds its `CCQ.<Role>` app role. `06-azure-entra-setup.md` A4c records `CCQ.ProductionScheduler` and its group as created on 2026-11-17 with two members. Not verified from the repo. | No **[manual]** |
| 7 | Who holds prod roles | Test and prod both honour the prefix `CCQ.` (both parameter files). Every role granted for UAT works in prod. Review the assignments, `CCQ.Admin` and `CCQ.Approver` first. | No **[manual]** |
| 8 | Key Vault secrets `database-url` and `sf-client-secret` exist in `kv-quoteflow-prod-ptpk` and both references resolve | Portal → web app → Environment variables: green tick on `DATABASE_URL` and `SF_CLIENT_SECRET`. An unresolved `DATABASE_URL` stops the start (message below). An unresolved `SF_CLIENT_SECRET` does **not**: the literal reference text passes validation and Salesforce then fails at run time. | No **[manual]** |
| 9 | App settings match the Bicep | See 2.1. Compare with `az webapp config appsettings list -g rg-ccq-prod -n quoteflow-prod` (names only; do not paste values into chat or tickets). | No **[manual]** |
| 10 | A first Admin can sign in | At least one person you can reach is a direct member of `SG-CCQ-Admin` (nested groups do not carry the role). `03` B-22 lists "sign-in with a `CCQ.*` role on prod" as still open. | No **[manual]** |
| 10a | No stored intake draft holds a value the tightened request schema now refuses (first deploy of this branch only) | The same schema is used to send a draft back, so a draft saved earlier with an impossible date or an absurd figure would fail to load (a 500 on opening it). Run, read-only: `select id, owner_user_id from quote_draft where submitted_quote_id is null and ((data->>'quoteNeededBy') is not null and (data->>'quoteNeededBy') !~ '^\d{4}-(0[1-9]\|1[0-2])-(0[1-9]\|[12]\d\|3[01])$' or (data->>'estAnnualRevenue')::numeric > 999999999999.99 or (data->>'estAnnualVolume')::numeric > 1000000000000);` Expect no rows; correct any by hand with the owner. | No **[manual]** |
| 11 | Restore point | Write down the UTC time just before the deploy. It is the point-in-time-restore target if the worst happens (35-day retention in the parameter file). | No **[manual]** |
| 12 | Users are told | The restart drops in-flight requests. Pick a quiet time and tell the pilot group. An open tab from the old build is told to reload (commit `d4ac5cc`). | No **[manual]** |

### 2.1 App settings the Bicep sets (`infra/main.bicep`, prod values)

`NODE_ENV=production`, `APP_ENVIRONMENT=prod`, `SCM_DO_BUILD_DURING_DEPLOYMENT=false`, `AUTH_MODE=entra`, `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID`, `ENTRA_API_AUDIENCE`, `ENTRA_SPA_CLIENT_ID`, `ENTRA_API_SCOPE`, `ENTRA_ROLE_PREFIX=CCQ.`, `APP_BASE_URL`, `DATABASE_URL` (Key Vault reference to `database-url`), `FILESTORE_MODE=blob`, `BLOB_ACCOUNT_URL`, `BLOB_CONTAINER`, `MAIL_MODE=graph`, `NOTIFICATION_DISPATCH_INTERVAL_SECONDS=0`, `SF_MODE=live`, `SF_AUTH_FLOW=client_credentials`, `SF_LOGIN_URL`, `SF_CLIENT_ID`, `SF_CLIENT_SECRET` (Key Vault reference to `sf-client-secret`), `APPLICATIONINSIGHTS_CONNECTION_STRING` (set; nothing in the app reads it).

Added by the audit and **not yet applied**: `WEBSITES_CONTAINER_START_TIME_LIMIT=1800` (commit `000d2d7`). Until the Bicep is re-applied, App Service gives the container its default 230 seconds to answer; a migration that runs longer is killed and retried.

Never emitted for prod: `SEED_SYNTHETIC_DATA`, `MAIL_ALLOWLIST`, `MAIL_REDIRECT_TO`.

### 2.2 Start-up refusals

The app exits before listening and prints one of these to the Log stream. The first three prod rules are new in this audit (commits `79c1919`, `86459dc`): an environment that started before may now refuse.

| Log stream shows | Meaning | Fix |
|---|---|---|
| `[quoteflow-api] refusing to start` … `NODE_ENV: NODE_ENV=<x> is forbidden when APP_ENVIRONMENT=prod. Set NODE_ENV=production.` | **New.** `NODE_ENV` was lost or changed | Restore the setting |
| … `SF_MODE: SF_MODE=fake is forbidden when APP_ENVIRONMENT=prod: it serves the synthetic Salesforce fixture. Set SF_MODE=live.` | **New.** The Bicep default for `sfMode` is `fake` | Set `SF_MODE=live` and the `SF_*` settings |
| `[quoteflow-start] refusing to start` … `SEED_SYNTHETIC_DATA=true is forbidden when APP_ENVIRONMENT=prod. Remove the setting: synthetic data is for the test environment only.` | **New.** Someone added the setting by hand | Remove it |
| … `AUTH_MODE: AUTH_MODE=dev is forbidden when APP_ENVIRONMENT=prod` (also when `NODE_ENV=production`) | Dev sign-in on a real environment | `AUTH_MODE=entra` |
| … `MAIL_ALLOWLIST is for test only and is forbidden when APP_ENVIRONMENT=prod` (same for `MAIL_REDIRECT_TO`) | Test mail guard copied to prod | Remove both |
| … `SF_CLIENT_ID is required when SF_MODE=live and SF_AUTH_FLOW=client_credentials` (same for `SF_CLIENT_SECRET`) | Missing Salesforce setting | Add it |
| … `FILESTORE_MODE=local is forbidden when NODE_ENV=production…`, `MAIL_MODE=<x> is forbidden when NODE_ENV=production…`, `<KEY> is required when AUTH_MODE=entra` | Missing or wrong mode | Fix the named key |
| `[quoteflow-start] refusing to start` / `DATABASE_URL is not a postgres:// URL. If it is a Key Vault reference, it has not resolved…` | Key Vault reference unresolved | Grant the web app identity "Key Vault Secrets User", wait, restart. `03` B-22 notes a cached failure needed a `configreferences` refresh once. |
| `[quoteflow-start] refusing to start` / `database preparation failed: <ErrorName> (<SQLSTATE>) table_name=… constraint_name=…` | A migration or the config seed failed. The transaction rolled back. | Read the code and the object names; see section 6. **Do not restart in a loop.** |

## 3. Deploy steps, in order

Actions → **Deploy (production)** → **Run workflow** → pick `main` (or a `v*` tag on a commit that is on `main`) → approve when GitHub asks.

| # | Step (job step name) | Expected | If it fails |
|---|---|---|---|
| 1 | Check the target is production | No output | `the production environment's variables aren't set (resource group '…', app '…')`: fix pre-flight 3 |
| 2 | Check CI passed on this commit | No output | `no successful CI run for <sha>: deploy a commit CI has passed`: wait for CI, run again |
| 3 | Check the commit is on main | No output | `<sha> is not on main…`: the tag points at unmerged code. Stop. |
| 4 | Install, Build | Green | A build that passed CI should pass here |
| 5 | Package for App Service | `packaged <size> in .azure-deploy`, then the size of `quoteflow.zip` | `missing … run pnpm build first` |
| 6 | `azure/login` | Green | `AADSTS700213`: the federated credential subject does not match (`06` §5) |
| 7 | Fabric mirroring (stop if migrations change) | **Skipped** while the Fabric ids are empty | If it runs in prod today, pre-flight 4 was missed |
| 8 | Deploy | `az webapp deploy … --track-status false` returns after the upload. The app restarts now. | Upload errors fail here. `AuthorizationFailed`: the deploy identity lost Website Contributor |
| 9 | Smoke test and swap | Lines `waiting for quoteflow-prod on <sha> (n/90): …`, then `quoteflow-prod healthy on <sha>: {"status":"ok","version":"<sha>","db":"up",…}` | After 15 minutes: `quoteflow-prod did not report healthy in 15 minutes: check Log stream in the portal`. Go to section 6. |
| 10 | Fabric mirroring (start and wait) | Skipped | — |

**[manual] Watch the Log stream while step 9 waits** (portal → web app → Log stream). A good start prints, in order: `[quoteflow-start] migrations applied`, `[quoteflow-start] config seeded`, then a JSON line with `"msg":"Server listening at …"`. A `refusing to start` line names the problem (2.2). The pipeline only sees `/health`; it cannot read this.

The Salesforce sync starts 10 seconds after the server listens, then every 15 minutes.

## 4. Post-deploy smoke checks (10 minutes) **[manual]**

| # | Do | See |
|---|---|---|
| 1 | Open `https://quoteflow-prod.azurewebsites.net/api/v1/health` | `200`, `"status":"ok"`, `"version"` = the full SHA you deployed, `"db":"up"`. A `503` with `"db":"down"` means Postgres is unreachable. |
| 2 | Open `/api/v1/auth/config` | `"authMode":"entra"`, `"environment":"prod"` |
| 3 | Open `/` in a private window | The sign-in page, with **no** environment banner (any banner means `APP_ENVIRONMENT` is not `prod`) |
| 4 | Sign in | The home page (Command Center) loads. The role tabs match your groups. |
| 5 | Open `/quotes`, then one quote | The list loads; the quote page loads with its timeline |
| 6 | Open `/admin/integrations` | `salesforce`: mode `live`, health `ok`, last success within the last 15 minutes. `fabric`: mode `off`. |
| 7 | Open `/admin/audit` | Your own `sign_in` row (one per user per 8 hours) and a `view` row for the quote you opened. The request id is a UUID. |
| 8 | Open `/admin/settings` and `/admin/users` | Both load. Do not save anything. |
| 9 | Open `/api/v1/me` in a tab with no session | `401` problem JSON with `"code":"missing_token"` and a UUID `traceId` |
| 10 | Open `/assets/does-not-exist.js` | `404` problem JSON, not the page shell (commit `0f2877c`) |
| 11 | Open `/docs` | The app's own not-found page. Swagger UI must not appear in production. |
| 12 | Log stream | No `refusing to start`. A `"msg":"request completed"` line shows `"res":{"statusCode":200}` (not `"res":{}`): the logging fix is live. |

If 4 fails with "no CCQ role" (403), the user is not a direct member of an `SG-CCQ-*` group; the deploy is fine.

## 5. Verify the migrations applied

Expected count: the number of entries in `packages/db/migrations/meta/_journal.json`. At the time of writing that is **49** (`0000_baseline` to `0048_fb20_offer_letter`); the last entry's `when` is `1794865966183`. Count them for your commit with:

```bash
git show <sha>:packages/db/migrations/meta/_journal.json | grep -c '"tag"'
```

Then, connected to the `ccq` database:

```sql
select count(*) as applied, max(created_at) as last_when
from drizzle.__drizzle_migrations;
-- applied = the journal count; last_when = the "when" of the journal's last entry

select id, created_at, to_timestamp(created_at / 1000.0) as journal_time
from drizzle.__drizzle_migrations
order by created_at desc
limit 5;
```

Drizzle stores each migration's journal `when` in `created_at` and applies a file only if its `when` is later than the latest stored one. It never re-reads a file it has already passed.

**[manual] Getting a SQL session on prod.** The server admits only Azure services. A session from a laptop needs a temporary firewall rule for your IP and the admin password from Key Vault; remove the rule straight after (`06` §4 note; done once on 2026-11-12 per `03` B-22). Use `begin read only;` for every check. Without a session, the weaker evidence is the Log stream line `[quoteflow-start] migrations applied` plus `/health` on the new SHA: the app does not listen unless every pending migration succeeded.

## 6. Roll back

There is no slot to swap and no saved build. A rollback is a new deploy of older code:

1. Revert the bad commit(s) on `main` with a revert PR. Wait for CI (14 to 21 minutes).
2. Dispatch **Deploy (production)** on the new `main` commit. Or dispatch it on an older `v*` tag that is on `main` (the local clone had no `v*` tag on 2026-11-17).
3. Run the smoke checks again.

Plan for about 30 to 45 minutes end to end. **Migrations do not roll back.** The older code runs against the newer schema, so check this table first (classification from the audit's database review):

| Migration | On `main` since | Previous app version safe against it? |
|---|---|---|
| `0043_funding_help_text` | 2026-11-13 | Yes |
| `0044_fb15_intake_fixes` | 2026-11-13 | Yes |
| `0045_fb16_engineering_capacity` | 2026-11-15 | Yes |
| `0046_fb17_gate_decisions_holds` | 2026-11-15 | Yes |
| `0047_fb19_multi_item_quotes` | 2026-11-16 (PR #102, merge `a230943`) | **No.** `quote_item_id` is NOT NULL, a unique constraint and an index are gone, draft data moved into `data.items[0]`. |
| `0048_fb20_offer_letter` | 2026-11-16 | Yes |

**Rollback floor:** once `0047` is applied in prod, never deploy a build older than merge `a230943`. Below the floor the choices are fix forward, or restore the database.

Whether prod has already applied `0047` is not verified from the repo: run the section 5 query (49 applied means yes; the first prod deploy on 2026-11-12 carried 43). The audit branch itself adds no migration.

**Last resort: point-in-time restore.** It creates a new server, loses every write after the chosen time, needs the `database-url` secret repointed and a restart, and breaks the Fabric mirror once one exists (`docs/gate/runbook.md` §6). Decide it with the sponsor, not alone.

**If the app is crash-looping on a failed migration:** the migration's transaction rolled back, so the schema is as before. Deploy the previous good commit (above the floor) to get users back, then fix the migration in a new commit.

### 6.1 Checklist for every migration from here on (expand, then contract)

- [ ] It only adds: new tables, new nullable columns, new indexes. The old code must still run.
- [ ] No `NOT NULL` without a default, no dropped or renamed column, constraint or index, no moved data, in the same release as the code that needs it. Ship the add, then the code, then (a release later) the removal.
- [ ] A data backfill is idempotent and does not assume it runs once.
- [ ] It finishes well inside the start-up limit on a prod-sized table (230 s today, 1800 s once `000d2d7` is applied).
- [ ] Any `jsonb` or array column has its Fabric companion (`CLAUDE.md` rule 10).
- [ ] The PR says in one line whether the previous app version runs against it. Add the row to the table above.
- [ ] Never edit a migration file after it has merged to `main`.

## 7. Who to call

By role; names are in `docs/gate/runbook.md` §8 (several are still "TBD at M9" there).

| Problem | Role |
|---|---|
| App defect, deploy, config, first response | Embedded Intelligence builder (owner of this app) |
| Access requests, user coordination | Embedded Intelligence coordinator |
| Azure platform: resource group, Postgres, quota, restore | IT platform |
| Entra app registrations, roles, groups | IT identity |
| Salesforce integration user or External Client App | Salesforce admin |
| Pricing-history export file | IT owner of the legacy pricing export |
| Fabric workspace and mirror | Data and Analytics lead |
| Product decision or config value approval | Interim Knowledge Steward |
| Go / no-go on a restore or a long outage | Sponsor |

On-call hours are not agreed (`docs/gate/runbook.md` §9). The platform alerts email nobody: `alertEmails = []`.

## 8. What not to do

- **Do not re-apply the Bicep without `what-if`.** The `appsettings` resource replaces the whole set: a setting changed in the portal and missing from `main.prod.bicepparam` disappears, and the app restarts.
- **Do not pass `postgresAdminPassword` to an apply against the existing server.** It resets the password and breaks `database-url`.
- **Do not scale out** (more than one instance) or enable the slot before reading `04-needs-ben.md` N-15: every instance, and a slot, runs the four background jobs and re-creates the analytics views at start. Migrations are now serialized by an advisory lock, but that is the only part made safe.
- **Do not set `SEED_SYNTHETIC_DATA`** on prod. The app now refuses to start with it.
- **Do not run `pnpm db:reset`, `pnpm db:demo` or `pnpm db:seed --synthetic` with `DATABASE_URL` pointing at prod.** `db:reset` drops both schemas; its only guard is `NODE_ENV=production` in *your* shell.
- **Do not edit an applied migration.** Drizzle will not re-run it; the environments then differ silently. Write a new one.
- **Do not fix data with SQL** except as the last resort in `07-admin-support.md` §5. `audit_event` refuses UPDATE and DELETE by trigger.
- **Do not restart repeatedly** to clear a start-up failure. Read the Log stream line first.
- **Do not turn on email dispatch** (`NOTIFICATION_DISPATCH_INTERVAL_SECONDS` above 0) as part of a release. It is a separate change with its own backlog to clear (`04-needs-ben.md` N-15).
- **Do not deploy during a Salesforce full re-sync** or a pricing-history import: the restart cuts both off. The import rolls back; the sync leaves an `integration_run` row stuck on `running`.
- **Do not create a `v*` tag on an unmerged commit.** The workflow refuses it, but only after a reviewer has been asked to approve.

## 9. Where this differs from `docs/gate/runbook.md`

That file is a draft from before prod existed. These lines are out of date; nothing else in it is contradicted here.

| `docs/gate/runbook.md` | Now |
|---|---|
| line 3, line 19: prod "not deployed yet", "no prod workflow exists yet" | Deployed 2026-11-12; `.github/workflows/deploy-prod.yml` |
| line 19: names `psql-quoteflow-prod`, `kv-quoteflow-prod`, `stquoteflowprod`, VNet `10.60.0.0/24` | `…-ptpk` suffix, no VNet (`infra/main.prod.bicepparam` lines 15-17, 27) |
| line 29, line 31: deploy to the `staging` slot, roll back by swapping back | No slot (`main.prod.bicepparam` lines 35-36); section 6 above |
| line 112: the rate limit is per client IP | Per signed-in user, per address only for public routes and rejected sign-ins, API routes only (`apps/api/src/app.ts` lines 287-296) |
| line 119: no availability test or alert rules exist | They exist in `infra/modules/alerts.bicep`; they have no receivers. No app telemetry is still true. |
| line 110: log text `database preparation failed (<code>)` | `database preparation failed: <ErrorName> (<code>) <objects>` (`apps/api/src/azureStart.ts` line 71) |
