# QuoteFlow runbook and support model

**Status: DRAFT, 2026-10-27.** B-21 "runbook draft" for **M9 (Mon Nov 2)** and the B-24 "runbook + support model" item. It covers the **test** environment as built today and what is known about **prod**, which is not deployed yet (B-22). Command-level detail lives in [`06-azure-entra-setup.md`](../build-guide/06-azure-entra-setup.md) and [`infra/README.md`](../../infra/README.md); this page links to them instead of repeating them.

Owner: Ben Whann (Embedded Intelligence). Reviewers at M9: Oliver Kade, Chris O'Brien, Tim Webb, Alicia Avellaneda-Cruz, Darren Miller.

---

## 1. What QuoteFlow is, in one paragraph

One Azure App Service (Linux, Node 22) runs the Fastify API, which also serves the React SPA and runs the background jobs. Data is in Azure Database for PostgreSQL Flexible Server 16, with row-level security. Secrets are Key Vault references. Sign-in is Microsoft Entra ID only; roles come from `SG-CCQ-*` groups. Salesforce is read-only. Pricing history is an imported Excel export. Attachments go to SharePoint (or Blob until M7). Email goes through Microsoft Graph. A Fabric mirror copies the database to the D&A tenant (L-8). Full design: [`01-architecture.md`](../build-guide/01-architecture.md).

## 2. Environments and URLs

| Env | URL | Azure | Data | Deploys | Status |
|---|---|---|---|---|---|
| local | `http://localhost:5173` (web), `:3000` (API) | Docker Postgres (`docker compose up -d db`) | Synthetic only (`pnpm db:seed --synthetic`) | — | Working |
| test | `https://quoteflow-test.azurewebsites.net` | RG `rg-ccq-test`, web app `quoteflow-test`, region `centralus`, plan B1, Postgres Burstable B1ms, tenant `c99a7bb3-6a70-46a9-8a73-d46790d6cd5b` | Production Salesforce org (since 2026-10-24); synthetic seed off | Automatic on merge to `main` (`.github/workflows/deploy.yml`, OIDC) | Running since 2026-10-21. Built by CLI (`06`), not Bicep. |
| prod | **TBD** (proposed web app name `quoteflow-prod`, so `https://quoteflow-prod.azurewebsites.net` unless a custom domain is chosen) | RG `rg-ccq-prod` (proposed names in `infra/main.prod.bicepparam`: `psql-quoteflow-prod`, `kv-quoteflow-prod`, `stquoteflowprod`, VNet `10.60.0.0/24`) | Approved production data (B-22) | **TBD**: no prod workflow exists yet. Plan: manual approval on the GitHub `production` environment, deploy to the `staging` slot, swap (`01` §8, B-22 prompt). | Not deployed. Owner: Ben + IT (Tim Webb / Chris O'Brien). |

Identifiers that are not secrets (client ids, deploy identity) are recorded in `03-build-steps.md` under B-20. Test's Postgres, Key Vault and storage names carry a 4-letter suffix the repo does not record (`infra/README.md`); read them with `az resource list -g rg-ccq-test -o table`.

Health: `GET /api/v1/health` returns version (the commit) and DB status. It answers **503** with `db: down` when Postgres is unreachable, so the App Service health check fails over.

## 3. Deploy, roll back, restart

| Task | Test (today) | Prod (planned) |
|---|---|---|
| Deploy | Merge to `main`. CI runs; when it passes, **Deploy (test)** builds the same commit, deploys it, waits up to 10 min for `/api/v1/health` to report that commit with `db: up`. Migrations and config seeds run when the app starts (`apps/api/src/azureStart.ts`). See `06` Part C and Part E. | **TBD (B-22).** GitHub `production` environment with a protection rule; deploy to the `staging` slot; smoke; swap. Separate deploy identity `id-quoteflow-deploy-prod` (Bicep). |
| Re-deploy, no code change | **Actions → Deploy (test) → Run workflow** (`06` Part E). | TBD |
| Roll back | Revert the bad commit on `main` (a revert PR); CI redeploys. **Migrations don't roll back**: write a new migration to undo a schema change (`06` Part E). | Swap the slot back (B-21 prompt). Same migration caveat: a swap back runs old code on the new schema. TBD with IT. |
| Restart | Portal → web app → **Restart**, or `az webapp restart -n quoteflow-test -g rg-ccq-test`. | Same, on `rg-ccq-prod`. |
| Logs | Portal → **Log stream**, or `az webapp log tail` (`06` Part E). Logs carry ids, codes and counts, never prices, tokens or file names. | Same. App Insights telemetry is **not wired yet** (`06` §6 deviation 5); owner Ben (B-21). |
| Fabric mirror around a deploy | Automatic once `FABRIC_WORKSPACE_ID` / `FABRIC_MIRRORED_DB_ID` are set on the GitHub `test` environment: a deploy that changes `packages/db/migrations` stops mirroring first, then starts it and waits for `Running` (also when the deploy fails). See §5.6. | Same, on the `production` environment. |

## 4. Changing configuration: where each kind lives

| Kind of change | Where | Who | Takes effect | Audit |
|---|---|---|---|---|
| Business rules: value lists, reason codes, stage/gate/outcome labels and help text, gate required-field rules, app settings (validity days, aging buckets, warnings, override approvers, G4 tiers, pass-through, Legal triggers, escalation routes…), scoring model versions, user data scope | **Admin console** (`/admin`). Each write needs a change reason (≥ 5 characters) and names the row version it was edited from (stale → 409). | Admin (`config.manage`): Ben, Tre, Bailey as interim Knowledge Steward. Leadership reads (`config.read`). Approval of values: Bailey (interim) until D-02 names a Knowledge Steward. | At once on the instance that made it; other instances within `CONFIG_CACHE_SECONDS` (60). A new scoring version rescores open quotes in the background. | `audit_event` `config_change`, shown in **Admin → Decision log**. |
| Who decides a gate (`gate.G*.decide`) and every other permission | **Code**: `packages/domain/src/policy/matrix.ts`, then a deploy and re-seed. | Ben, after a business decision. | Next deploy. | Git history + PR. Making the `role_permission` table the control is open (`03` B-19). |
| A person's role | **Entra group** membership (`SG-CCQ-*`). | IT, or the enterprise app's owner (Ben is owner for test, `06` §4). | The user signs out and in. | Entra audit. |
| Modes, intervals and limits: `SF_MODE`, `SF_AUTH_FLOW`, `FILESTORE_MODE`, `MAIL_MODE`, `MAIL_FROM`, `NOTIFICATION_DISPATCH_INTERVAL_SECONDS`, `SF_SYNC_INTERVAL_MINUTES`, `VALIDITY_EXPIRY_INTERVAL_HOURS`, `FABRIC_CHECK_INTERVAL_MINUTES`, `RATE_LIMIT_MAX`, `CONFIG_CACHE_SECONDS`, `FABRIC_*`, `SP_*`, `BLOB_*`, `ENTRA_*` | **App Service app settings** (portal → Environment variables → Apply; the app restarts). The API refuses to start on an invalid value and names it in Log stream. | Ben (Website Contributor on `rg-ccq-test`) or IT. | After the restart. | Azure activity log. |
| After Bicep is applied | Put every app-setting change in `infra/main.<env>.bicepparam`. **An apply replaces the whole set**, so a portal-only change is lost on the next apply (`infra/README.md`). | Ben + IT review. | Next apply. | Git + ARM deployment history. |
| Secrets: `database-url`, `sf-client-secret` (and Graph client secret if ever used) | **Key Vault**, referenced from app settings as `@Microsoft.KeyVault(SecretUri=…)`. Never in app settings or the repo. | Ben (Key Vault Secrets Officer on test) or IT. Rotation command: `06` Part E "Connect Salesforce". | Restart the app after rotating; check the green tick on the setting. | Key Vault logs. |

## 5. Integrations

Every integration writes an `integration_run` row. **Admin → Integrations** (`/admin/integrations`) shows each source's mode, last run, last success, failures in 24 h and last error code. Failures raise in-app alerts to Admins only.

### 5.1 Salesforce (read-only)
- **How:** External Client App, OAuth client credentials, read-only integration user (Rachel Dew). `SF_MODE=live`, `SF_AUTH_FLOW=client_credentials`, `SF_LOGIN_URL=https://pretiumpkg.my.salesforce.com`, `SF_CLIENT_SECRET` from Key Vault (`06` Part E).
- **Schedule:** delta sync 10 s after start, then every `SF_SYNC_INTERVAL_MINUTES` (15). Advisory lock, so one instance runs it.
- **Run now:** Admin → Integrations → **Sync Salesforce now**.
- **Full re-sync:** Admin → Integrations → **Full re-sync** (confirm), or `POST /api/v1/admin/salesforce/sync?full=true`. It ignores the watermark and rewrites every snapshot. Run it after a field-map change. About a minute for ~32,000 records. It skips the deletion check.
- **When Salesforce is down:** search and detail fall back to the stored snapshot with a `liveError`; nothing blocks.
- **Contacts:** Rachel Dew (app, user, permission set); Zac Cairns / Graham Parle (field meanings).

### 5.2 Pricing history (import, no live connection)
- **How:** Admin → Integrations → **Pricing history** → **Check file** (writes nothing, reports per sheet) → **Import**. `.xlsx` with ERF / BPR / SPR sheets from Cory McGahan. Re-import is idempotent (changed rows update, new rows add, nothing is deleted). One `integration_run` and one audit row per import.
- **Status:** imported only into a scratch database (47,284 records). **Not yet imported in test** (B-15). Prod import is part of B-22.
- **Never** commit the file (`.gitignore` refuses `*.xlsx` except `*.synthetic.xlsx`).
- **Contacts:** Cory McGahan (export), Gemma Cebolla (who may see it).

### 5.3 Attachments (SharePoint, Blob fallback)
- **Mode:** `FILESTORE_MODE` = `sharepoint` | `blob` | `local` (production refuses `local`). Test runs `blob` (`06` B6) until M7.
- **SharePoint (after M7):** set `SP_SITE_ID`, `SP_DRIVE_ID`; `Sites.Selected` (write) on that site only; run `SP_LIVE_TEST=1` once. Site, library and folder convention: **TBD at M7** (IT M365 admin, Bailey).
- **Switching modes doesn't migrate files.** A file in the other store answers **503 `storage_unavailable`** until switched back or migrated.
- Removed files move to `CCQ/_removed/…`; nothing is hard-deleted. Retention for `_removed` and `_drafts`: **TBD** (IT).

### 5.4 Email (Microsoft Graph)
- **Mode:** `MAIL_MODE=graph` (production refuses anything else), `MAIL_FROM` (default `ccq-noreply@pretiumpkg.com`, IT names it at M7). Dispatcher every `NOTIFICATION_DISPATCH_INTERVAL_SECONDS` (60; **0 on test = email off**).
- **Turn email off app-wide** without a restart: Admin → App settings → `email_notifications_enabled` = false (in-app alerts continue).
- **Failures:** 3 tries (now, +1 min, +5 min); then `failed_at` is set and each Admin gets one in-app alert per run.
- **Open:** shared mailbox, `Mail.Send` and the Exchange application access policy (M7). One real send still to prove (B-18).

### 5.5 Microsoft Entra
- App registrations `QuoteFlow-API` and `QuoteFlow-SPA`, nine `CCQ.*` app roles, `SG-CCQ-*` groups (`06` Part A). Adding a prod URL: `06` Part E "Add a sign-in URL".

### 5.6 Fabric mirror (L-8, B-27)
- **Not running yet.** Waits on MF decisions (D-FB2 to D-FB5), test Postgres leaving Burstable (D-FB3) and the D&A workspace.
- **Status by hand:** `FABRIC_WORKSPACE_ID=… FABRIC_MIRRORED_DB_ID=… scripts/fabric-mirroring.sh status` (also `tables`, `stop`, `start`, `wait [seconds]`). Needs `az` signed in as an identity with Contributor on the workspace. Prints statuses and table names only.
- **Hourly check:** `apps/api/src/jobs/fabricMirrorCheck.ts` runs every `FABRIC_CHECK_INTERVAL_MINUTES` (60) once both `FABRIC_*` app settings are set. It writes `integration_run` (source `fabric`), shows under Admin → Integrations → **fabric**, and alerts Admins when the mirror becomes unhealthy (not every hour while it stays so).
- **Stopped mirror:** `scripts/fabric-mirroring.sh start && scripts/fabric-mirroring.sh wait`. A start reseeds every table, so no data is lost.
- **Contacts:** Brennan Paul (workspace, capacity, Fabric security), IT (server restart window, prod VNet data gateway).

### 5.7 Scheduled jobs (all in-process, advisory-locked)

| Job | Interval setting (default) | Off when |
|---|---|---|
| Salesforce delta sync | `SF_SYNC_INTERVAL_MINUTES` (15) | 0 |
| Validity expiry and warning | `VALIDITY_EXPIRY_INTERVAL_HOURS` (24) | 0 |
| Notification dispatch (email, 7:00 AM Central G1 digest) | `NOTIFICATION_DISPATCH_INTERVAL_SECONDS` (60) | 0 |
| Fabric mirror check | `FABRIC_CHECK_INTERVAL_MINUTES` (60) | 0, or `FABRIC_*` not set |

## 6. Backups and restore (PITR)

- **Backups:** Azure Database for PostgreSQL automatic backups with point-in-time restore. Prod: 35 days (`infra/main.prod.bicepparam`, not yet applied). Test: Bicep sets 7 days but test was built by CLI; actual retention **TBD** (Ben to read it with `az postgres flexible-server show`). Geo-redundant backup is off.
- **Restore:** a PITR restore creates a **new server** (`az postgres flexible-server restore --resource-group <rg> --name <new-server> --source-server <server> --restore-time <UTC ISO time>`; check `--help`, the CLI changes). Then update the `database-url` secret in Key Vault to the new server, restart the app, and check `/api/v1/health` shows `db: up`. The `ccq_app` / `ccq_migrator` roles are created by the app at start-up (`infra/README.md`). If the restored server needs the firewall rule or the `azure.extensions` parameter, set them as in `06` B2.
- **PITR breaks the Fabric mirror.** After a PITR restore (or a major-version upgrade), D&A must reconfigure mirroring on the new server (`01` §6.1, `06` Part E). Tell Brennan Paul before restoring.
- **Restore test:** quarterly (`01` §9). Owner: **TBD** (IT, agree at M9).
- **Audit retention:** ≥ 7 years for `audit_event`, to confirm with IT / Legal (`01` §9). Owner: **TBD**.

## 7. Common incidents

Each row: symptom → what to check → fix. Command detail for Azure is in `06` §5.

| Incident | Symptom | Check | Fix |
|---|---|---|---|
| **Database down or unreachable** | `/api/v1/health` 503 with `db: down`; App Service health check failing; users see errors. Log stream: `database preparation failed (<code>)`. | Postgres server state in the portal; the SQLSTATE code in Log stream: `28P01` wrong password, `3D000` no `ccq` database, other codes before `migrations applied` → `azure.extensions` or networking. | `06` §5 rows for each code. Start the server if stopped. Restart the app after fixing. Data loss → §6 restore. |
| **Salesforce auth failure** | Admin → Integrations shows Salesforce `failed` runs with an error code; Admins get an in-app `integration.failed` alert; intake search shows snapshot results with a live-search error. Or the app refuses to start with `SF_MODE=live` and a missing id/secret or a `login`/`test.salesforce.com` URL. | `SF_CLIENT_SECRET` setting shows a green tick (Key Vault reference resolved); secret not expired or rotated in Salesforce; External Client App and integration user still active. | Rotate the consumer secret in Key Vault (`06` Part E), restart, **Sync Salesforce now**. App or user problem → Rachel Dew. The app keeps working on the snapshot meanwhile. |
| **429 rate limit** | Users get HTTP 429 (Too Many Requests). Most likely many users behind one office NAT, or a load test. | The limiter allows `RATE_LIMIT_MAX` (300) requests per minute **per client IP**, not per user (`apps/api/src/app.ts`; B-21 finding). | Short term: raise `RATE_LIMIT_MAX` in app settings (restart). Fix: key the limiter on the signed-in user (B-21 target 300/min per user), **in progress** (see `backlog.md`). Salesforce `REQUEST_LIMIT_EXCEEDED` and Graph 429 are retried by the connectors with backoff. |
| **Fabric mirror stopped or table failed** | Admin → Integrations → **fabric** unhealthy; Admins alerted. | `scripts/fabric-mirroring.sh status` and `tables`. Fabric capacity paused? A migration deployed without stop/start? A PITR restore? | `scripts/fabric-mirroring.sh start && scripts/fabric-mirroring.sh wait`. A failed table after a migration: stop, then start. Capacity paused or PITR → Brennan Paul / D&A. The app is unaffected (it never reads Fabric). |
| **Deploy stuck or failed** | Smoke step prints `waiting for <sha>` while `/health` reports another version; "site failed to start within 10 mins"; `azure/login` fails with `AADSTS700213`; `AuthorizationFailed`; job skipped. | Log stream for the new container's start (`Server listening` or `refusing to start …`). GitHub variables present. | `06` §5 rows: re-run when the site is stable; add the federated credential for the exact subject; grant Website Contributor; add the C1 variables. If migrations changed and the deploy failed, check the mirror restarted (§5.6). |
| **Key Vault reference unresolved** | Log stream: `DATABASE_URL is not a postgres:// URL`; the setting shows a red cross in Environment variables. | Web app identity has the Key Vault role (`06` B7); secret name is exactly `database-url` (or `sf-client-secret`). | Grant the role, wait 2 minutes, restart (`06` §5). |
| **User can't sign in or sees "no CCQ role"** | `AADSTS50011`, "user not assigned", or 403 "no CCQ role". | Group membership, assignment, redirect URI, `ENTRA_*` settings. | `06` §5 sign-in rows. Access requests → §8. |
| **Email not arriving** | Notification rows with `failed_at`; Admin in-app alert. | `MAIL_MODE`, dispatch interval (0 = off), `email_notifications_enabled`, the user's opt-out, `Mail.Send` policy. | Fix the setting or the Graph grant (IT M365 admin). In-app alerts are unaffected. |

**Monitoring gap:** no App Insights telemetry, availability test, alert rules or action group exist yet (`06` §6 deviation 5; `infra/README.md`). Until B-21 adds them, the signals are the App Service health check, Log stream and the in-app Admin alerts above. Owner: Ben.

## 8. Support model

**Decision:** **EI supports** QuoteFlow (Ben, 2026-10-21; `05` Step 1). This replaces the proposed "EI builds, IT hosts and supports". `04` D-17 still shows the support model as open; confirm and close it at M9 (owner: Darren + Oliver Kade).

| Area | Who | Status |
|---|---|---|
| App defects, deploys, config changes, integrations, first response | Embedded Intelligence: Ben Whann (builder) | Decided (EI supports) |
| Coordination, access requests, UAT logistics | Tre Curry | As today |
| Product decisions, config value approval (interim Knowledge Steward) | Bailey Schmitt | Interim until D-02 names a Process Owner / Knowledge Steward |
| Azure platform (resource groups, Postgres restarts, networking, prod approvals) | IT: Tim Webb / Chris O'Brien *(confirm roles at M9)* | **TBD at M9** |
| Entra app registrations, groups | IT: Vincent Brown *(role per `02`, confirm)* | As built at M2 |
| Salesforce integration user and app | Rachel Dew | As today |
| Pricing-history export | Cory McGahan | As today |
| Fabric workspace and mirror | Brennan Paul (D&A) | **TBD at MF** |
| **On-call** | **TBD** (owner: Darren + Oliver Kade, M9) | Open |
| **Hypercare** | **TBD at M9.** Proposed in the B-24 prompt: 2 weeks after go-live, daily check of alerts, feedback triage 3× a week. | Proposed, not agreed |
| Escalation | Ben → Tre → Darren Miller (sponsor). Platform: Oliver Kade (VP IT). | Draft; confirm at M9 |
| Service hours | Business hours, best effort, single region (`01` §9) | NFR, not an SLA |

**Access requests.** Roles come only from Entra groups `SG-CCQ-*`. During UAT, ask Tre Curry (`docs/uat/README.md`). After go-live: the IT help desk, or the link in app setting `role_change_request_url` once IT provides one (null today). Data scope (own / region / accounts) is set by an Admin in **Admin → Users and scope**.

**How users report problems.** **Report an issue** (user menu and every page footer) creates a `feedback` record with page, quote and build context. Admins triage at **Admin → Feedback**; `pnpm uat:defects` renders the defect log (git-ignored, shared on SharePoint).

## 9. Open items for M9

- [ ] On-call names and hours (Darren, Oliver Kade)
- [ ] Hypercare window and cadence
- [ ] Prod deploy approvers (GitHub `production` environment reviewers)
- [ ] Backup / restore owner and the quarterly restore test
- [ ] Production-data approval in writing (D-23; B-22 precondition)
- [ ] Production exposure pattern (D-H2, M8)
- [ ] Audit retention ≥ 7 years confirmed with IT / Legal
- [ ] `role_change_request_url` from IT
- [ ] Alerts: who receives App Insights alerts once B-21 adds them
