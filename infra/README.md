# QuoteFlow infrastructure (Bicep)

B-20: the Azure environments as code, so `rg-ccq-test` and `rg-ccq-prod` can be rebuilt from this
folder. It reproduces what runbook [`06-azure-entra-setup.md`](../docs/build-guide/06-azure-entra-setup.md)
built for test by CLI on 2026-10-21, parameterised for prod. It also carries the Fabric mirroring
prerequisites (B-27, [`01-architecture.md` §6.1](../docs/build-guide/01-architecture.md)) so a rebuild
doesn't lose them.

**Status (2026-10-26): written and compiled, not yet applied.** The first apply is a `what-if` against
`rg-ccq-test`, reviewed with IT (see [First apply against test](#first-apply-against-rg-ccq-test)).

## Files

| File                            | What it creates                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `main.bicep`                    | Resource-group-scope entry point. Wires the modules and builds the web app's settings (as runbook B6 sets them).                                                                                                                                                                                                                                                         |
| `main.test.bicepparam`          | `rg-ccq-test` values: public endpoints, B1 plan, no slot, Salesforce live, no synthetic seed.                                                                                                                                                                                                                                                                            |
| `main.prod.bicepparam`          | `rg-ccq-prod` values: VNet + private endpoints, P1v3 plan + `staging` slot, 35-day backups, purge protection.                                                                                                                                                                                                                                                            |
| `modules/network.bicep`         | Prod only. VNet with `snet-app` (App Service VNet integration, delegated to `Microsoft.Web/serverFarms`), `snet-pe` (private endpoints) and `snet-fabric-gw` (**Fabric VNet data gateway**, delegated to `Microsoft.PowerPlatform/vnetaccesslinks`). Private DNS zones for Postgres, Key Vault and Blob (and App Service when `exposure = private`), linked to the VNet. |
| `modules/privateEndpoint.bicep` | One private endpoint + its DNS zone group. Used for Postgres, Key Vault, Blob and (option 2) the web app.                                                                                                                                                                                                                                                                |
| `modules/monitoring.bicep`      | Log Analytics workspace + workspace-based Application Insights (B3).                                                                                                                                                                                                                                                                                                     |
| `modules/keyvault.bicep`        | Key Vault, RBAC mode, soft delete; purge protection on in prod (B4). No secret values.                                                                                                                                                                                                                                                                                   |
| `modules/storage.bicep`         | StorageV2 account + private `attachments` container (B5), the blob fallback until SharePoint (M7).                                                                                                                                                                                                                                                                       |
| `modules/postgres.bicep`        | PostgreSQL Flexible Server 16, **General Purpose** (`Standard_D2ds_v5`), **system-assigned identity**, Entra + password auth, database `ccq`, `require_secure_transport=on`, and the mirroring parameters below. Test: public access + the "Allow Azure services" rule. Prod: public access off, private endpoint.                                                       |
| `modules/appservice.bicep`      | Linux plan + web app: Node 22 (`NODE\|22-lts`), startup `node apps/api/dist/azureStart.js`, system-assigned identity, HTTPS only, TLS 1.2, FTPS off, HTTP/2, Always On, health check `/api/v1/health`, container logs to the file system (B6, B7). Staging slot in prod. Optional VNet integration and public access off (`exposure = private`).                         |
| `modules/deployIdentity.bicep`  | `id-quoteflow-deploy` (prod: `id-quoteflow-deploy-prod`) and its GitHub OIDC federated credentials, both subject formats (B8).                                                                                                                                                                                                                                           |
| `modules/rbac.bicep`            | The plain RBAC grants: web app (and slot) identity → Key Vault Secrets User + Storage Blob Data Contributor (B7); deploy identity → Website Contributor on the web app (B8); developers → RG roles and Key Vault Secrets Officer (B4, B9).                                                                                                                               |
| `modules/alerts.bicep`          | B-21 health alerts: standard availability test on `/api/v1/health`, optional email action group, metric alerts on the web app, plan and Postgres (see [Alerts](#alerts)).                                                                                                                                                                                                |

### App settings

Built in `main.bicep` from parameters, matching runbook B6: `NODE_ENV=production`,
`SCM_DO_BUILD_DURING_DEPLOYMENT=false`, `AUTH_MODE=entra`, `ENTRA_*`, `APP_BASE_URL`,
`DATABASE_URL` (Key Vault reference to secret `database-url`), `FILESTORE_MODE` + `BLOB_*` (or `SP_*`),
`MAIL_MODE=graph`, `NOTIFICATION_DISPATCH_INTERVAL_SECONDS`, `SF_*` (the consumer secret as a Key Vault
reference to `sf-client-secret`), `APPLICATIONINSIGHTS_CONNECTION_STRING`, `SEED_SYNTHETIC_DATA` (test
only, never emitted for prod), and `FABRIC_WORKSPACE_ID` / `FABRIC_MIRRORED_DB_ID` when given (B-27,
PR #32). `extraAppSettings` adds plain settings such as `LOG_LEVEL`. `PRICING_MODE` from the runbook is
dropped: B-15 removed it from `apps/api/src/config.ts`.

**The `appsettings` resource replaces the whole set.** A setting changed by hand in the portal and not
in the parameter file is removed by the next apply. Put every change in the parameter file.

### Fabric mirroring prerequisites (B-27)

| Prerequisite                                     | Where                                                                                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| General Purpose tier in both envs (no Burstable) | `postgresSkuTier = GeneralPurpose`, `postgresSkuName = Standard_D2ds_v5` (test is B1ms today; **D-FB3 cost approval pending**)               |
| Server system-assigned managed identity          | `identity: SystemAssigned` on the server; `postgresPrincipalId` output                                                                       |
| `wal_level=logical`                              | server parameter                                                                                                                             |
| `azure_cdc` allow-listed                         | `azure.extensions = pg_trgm,pgcrypto,azure_cdc` (`pg_trgm`, `pgcrypto`: migrations `0001` and later)                                         |
| `azure_cdc` preloaded                            | `shared_preload_libraries = pg_cron,pg_stat_statements,azure_cdc` (Azure's PG16 default plus `azure_cdc`)                                    |
| `max_worker_processes` + 3 per mirrored database | `16` (default 8). +3 gives 11, but `azure_cdc`'s readiness check flags anything under 13, so 16 leaves headroom.                             |
| Private endpoint needs a gateway (prod)          | `snet-fabric-gw`, delegated to `Microsoft.PowerPlatform/vnetaccesslinks` (`fabricGatewaySubnetId` output). Fabric creates the gateway in it. |
| Test: Fabric connects directly                   | public access + "Allow Azure services" rule                                                                                                  |

> **Restart required.** `wal_level`, `shared_preload_libraries` and `max_worker_processes` are static
> parameters: ARM saves the value, but it takes effect only after a **server restart**, which this
> template does not do. The SKU change from B1ms to D2ds_v5 also restarts the server. Schedule both with
> IT (a few minutes of downtime), then `az postgres flexible-server restart -g <rg> -n <server>`.

> **Check on the first apply:** the Learn parameter reference lists the allowed values of
> `shared_preload_libraries` without `azure_cdc` (the portal's _Fabric mirroring_ page sets it). If ARM
> rejects the value, set `postgresSharedPreloadLibraries` back to `pg_cron,pg_stat_statements`, apply, and
> run the portal's **Fabric mirroring → Get started → Prepare** workflow once (it also sets
> `azure.fabric_mirror_enabled` and restarts). Record the outcome here.

### Alerts

`modules/alerts.bicep` (B-21). Thresholds and severities are parameters of `main.bicep` (`alert*`,
`availability*`); the defaults are deliberately quiet so test doesn't page anyone for noise.

| Rule (name prefix = web app name) | Fires when                                                                                                                                                                                        | Severity |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `-health` (availability test)     | Standard test: `GET https://<app>.azurewebsites.net/api/v1/health` every 5 min from 5 US locations (3 on test), expects 200 and `"status":"ok"` (503 = database down), TLS cert valid for 7+ days | —        |
| `-availability`                   | 2 or more test locations fail in the same 5 minutes (`availabilityFailedLocations`)                                                                                                               | 1        |
| `-http5xx`                        | More than 10 HTTP 5xx in 15 minutes (`alertHttp5xxThreshold`)                                                                                                                                     | 1        |
| `-pg-down`                        | Postgres `is_db_alive` below 1                                                                                                                                                                    | 1        |
| `-plan-cpu`                       | App Service plan CPU average above 85% for 15 minutes                                                                                                                                             | 2        |
| `-pg-cpu`                         | Postgres CPU average above 85% for 15 minutes                                                                                                                                                     | 2        |
| `-pg-storage`                     | Postgres storage above 85% used (auto-grow is on: this means it isn't keeping up)                                                                                                                 | 2        |
| `-pg-failed-connections`          | More than 25 failed connections in 15 minutes (password reset, firewall, connection limit)                                                                                                        | 2        |
| `-pg-replication-lag`             | A logical replication slot holds more than 1 GiB of WAL for 30 minutes: the Fabric mirror (B-27) has stalled                                                                                      | 2        |

**Receivers.** Set `alertEmails` in the parameter file (e.g. `['<address IT gives>']`) and apply. That creates action group `ag-<web app>` (short name `qf-<env>`) and attaches it to
every rule. Empty (the default) creates no action group: the rules still evaluate and show in **Monitor →
Alerts**, they just notify nobody. Azure Monitor emails each address once to say it was added.

**Availability test and private exposure.** With `exposure = 'private'` (D-H2 option 2) the web app has no
public endpoint, so the test and its alert are not created; the 5xx and Postgres rules still are.

**Cost.** Standard availability tests are billed per run: 5 locations every 5 minutes is about 43,800
runs a month (3 locations: about 26,300). Check the Azure Monitor pricing page for the per-run price;
`availabilityFrequencySeconds = 900` cuts it to a third. Each metric alert rule costs about $0.10 a month.

**No log alert for the Fabric mirror check yet.** `fabricMirrorCheck` logs `fabric mirror unhealthy` (pino,
stdout), but the API has no Application Insights SDK or OpenTelemetry exporter, and App Service keeps
container stdout only in the file system Log stream. A scheduled-query rule would never match. Once B-21
adds the exporter (or a diagnostic setting sends `AppServiceConsoleLogs` to the workspace), add a
`Microsoft.Insights/scheduledQueryRules` rule on that message. Until then `-pg-replication-lag` covers the
most damaging failure (a stalled slot filling the disk), and the check's `integration_run` rows show the rest.

## Deploy

Needs the Azure CLI with Bicep **0.38 or later** (`az bicep upgrade`; Cloud Shell is current), signed in
as someone with Owner, or Contributor + User Access Administrator, on the resource group (role
assignments). Register the providers once per subscription: the runbook B1 list plus `Microsoft.Network`,
and `Microsoft.PowerPlatform` for the Fabric gateway (prod).

```bash
# 1. Always look first. Nothing changes.
az deployment group what-if -g rg-ccq-test --parameters infra/main.test.bicepparam

# 2. Apply only after the what-if is reviewed (with IT).
az deployment group create -g rg-ccq-test --parameters infra/main.test.bicepparam

# Prod: the first create needs the admin password (never in a file). Afterwards omit it.
PG_PASSWORD=$(openssl rand -hex 24)
az deployment group what-if -g rg-ccq-prod --parameters infra/main.prod.bicepparam postgresAdminPassword="$PG_PASSWORD"
az deployment group create   -g rg-ccq-prod --parameters infra/main.prod.bicepparam postgresAdminPassword="$PG_PASSWORD"
```

Local compile check (no Azure access needed): `bicep build infra/main.bicep` and
`bicep build-params infra/main.<env>.bicepparam`.

Every `'<confirm: …>'` in a parameter file is a value the repo doesn't record. They are deliberately
invalid names, so ARM refuses the deployment until they are replaced.

Never pass `postgresAdminPassword` against an existing server: it resets the admin password and the
`database-url` secret stops working (runbook §5, `28P01`).

## First apply against rg-ccq-test

Test was built by hand, so the first apply must be a **what-if reviewed for drift** against the CLI-built
resources. Before running it:

1. Replace the `<confirm: …>` values in `main.test.bicepparam` from `az resource list -g rg-ccq-test -o table`
   (Postgres, Key Vault and storage names; the runbook gave them a 4-letter suffix the repo doesn't
   record), `az postgres flexible-server firewall-rule list` (the CLI names the 0.0.0.0 rule
   `AllowAllAzureServicesAndResourcesWithinAzureIps_<timestamp>`) and the current `SF_CLIENT_ID` app setting.
2. Compare `az webapp config appsettings list -g rg-ccq-test -n quoteflow-test` with the parameter file,
   because the apply replaces the whole set. Anything added by hand since 2026-10-21 must go into the file.
3. Keep `manageRoleAssignments = false`: the runbook's grants already exist under random names and ARM
   refuses identical duplicates (`RoleAssignmentExists`).

Expected, intended differences in the what-if:

- Postgres SKU `Standard_B1ms`/Burstable → `Standard_D2ds_v5`/GeneralPurpose (**restart; needs D-FB3**).
- Postgres identity `SystemAssigned` added; Entra authentication enabled next to password auth; storage
  auto-grow on.
- Server parameters `wal_level`, `shared_preload_libraries`, `max_worker_processes`, `azure.extensions`
  (adds `azure_cdc`), `require_secure_transport` (**restart**).
- Tags `app`, `owner`, `env` added everywhere.
- App setting `PRICING_MODE` removed (no longer read by the app).

Anything else (a resource shown as **Create** that already exists, a delete, a changed setting value)
means a name or value in the parameter file is wrong: stop and fix the file.

Until D-FB3 is approved, run the what-if only. The template allows only General Purpose and Memory
Optimized, on purpose (mirroring), so it can't be applied to test with Burstable kept.

## What stays manual

- **Entra:** the `QuoteFlow-API` / `QuoteFlow-SPA` app registrations, app roles, groups, consent (runbook
  Part A). For prod, add the prod URL as an SPA redirect URI.
- **Secrets:** `database-url` and `sf-client-secret` values in Key Vault (B4, Part E). In prod the vault
  has no public access: set them from inside the VNet, or through a short-lived firewall exception agreed
  with IT.
- **Postgres:** the restart above; the Entra admin (`postgresEntraAdmins`, or the portal); the
  `ccq_fabric_mirror` role (`azure_cdc_admin`, `CREATE` on `ccq`, table ownership/RLS per B-27); the
  `ccq_app` / `ccq_migrator` roles are created by the app at start-up.
- **Fabric (D&A):** workspaces, the mirrored database (created by a D&A service principal), the VNet data
  gateway in `snet-fabric-gw` (its creator needs `subnets/join/action` on the VNet, e.g. Network
  Contributor), the deploy identity as workspace Contributor, Fabric security (B-27 §3).
- **GitHub:** the `test` / `production` environments, their variables and the production protection
  rule (runbook Part C, B-22).
- **IT approvals:** D-FB3 (test on General Purpose), D-H2 exposure (M8), naming/tagging standard and
  `costCenter`, VNet address space or hub spoke, private DNS zones in the hub or here.
- **Not yet in Bicep:** Easy Auth (the app validates Entra tokens itself, and the runbook didn't turn it
  on); a log alert for the Fabric mirror check (see [Alerts](#alerts)).

## Rough monthly cost (estimate)

US list prices for `centralus`, pay-as-you-go, rounded; **an estimate, not a quote**. Check the Azure
pricing calculator before asking for approval.

| Item                                           | Test                              | Prod                        |
| ---------------------------------------------- | --------------------------------- | --------------------------- |
| App Service plan                               | B1 ≈ $13                          | P1v3 ≈ $125 (slot included) |
| Postgres compute                               | D2ds_v5 ≈ $125 (B1ms today ≈ $13) | D2ds_v5 ≈ $125              |
| Postgres storage 32 GB + backups               | ≈ $5                              | ≈ $5–10 (35 days)           |
| Key Vault, Storage, App Insights/Log Analytics | ≈ $5–15 (by log volume)           | ≈ $10–30                    |
| Availability test + alert rules (B-21)         | per-run test price × ≈ 26,300     | per-run price × ≈ 43,800    |
| Private endpoints (3) + DNS zones              | —                                 | ≈ $25                       |
| **Total**                                      | **≈ $150–160**                    | **≈ $290–320**              |

The Fabric capacity and the VNet data gateway run on D&A's F-SKU capacity and aren't in this table.
