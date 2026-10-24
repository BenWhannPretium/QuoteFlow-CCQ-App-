# B-27 · Land QuoteFlow data in the Pretium Fabric tenant (L-8)

**Paste into Claude Code from the repo root.**

---

Read `CLAUDE.md`, `01-architecture.md` §6.1 (Fabric data landing) and §7, and `04-decisions-and-risks.md` L-8 and D-FB1 to D-FB5. **Decision L-8 (Oleg Yarovinski + Brennan Paul):** every piece of new data QuoteFlow creates must be stored in Pretium's Fabric tenant.

**How we meet it:** Azure Database for PostgreSQL stays the app's transactional store. **Fabric mirroring** continuously copies the CCQ database into a mirrored database in a D&A-owned Fabric workspace (OneLake, Delta format, near real time, no ETL code). That decision is D-FB1. If Oleg and Brennan meant "Fabric is the *only* store", stop and escalate: that's a re-platform (Fabric SQL database is SQL Server, not Postgres), not this step.

## Preconditions (from MF, see `02-schedule-and-meetings.md`)
- A Fabric workspace per environment (`QuoteFlow (CCQ) - test`, `QuoteFlow (CCQ) - prod`) on a **running** F-SKU capacity, owned by D&A. Mirroring stops when the capacity is paused.
- Fabric tenant settings on: *Service principals can use Fabric APIs* and *Users can access data stored in OneLake with apps external to Fabric*.
- The mirrored database is created by a **D&A service principal or service account, not a person**. Fabric can't change a mirrored database's owner; if the owner leaves, it must be recreated.
- The deploy identity `id-quoteflow-deploy` is a workspace **Contributor** (for the start/stop calls below).
- IT has approved moving test Postgres off Burstable (D-FB3).

## 1. Make the schema mirror-ready (code, Ben)
Fabric mirroring from Azure Postgres **drops columns of these types**: `json`, `jsonb`, `inet`, `cidr`, `interval`, all range types, `tsvector`/`tsquery`, `xml`, `bit`/`varbit`, geometric types, `pg_lsn`, `macaddr`. `numeric` over precision 38 lands as NULL. Views, materialized views, partitioned tables and `TRUNCATE` are not mirrored.

- **Text companions for `jsonb`.** For each `jsonb` column whose data D&A needs (default: all of them, about 24), add `<column>_json text` kept equal to `<column>::text` by a `BEFORE INSERT OR UPDATE` trigger. Use a trigger, not a generated column: Postgres 16 logical replication doesn't publish generated columns. One generic trigger function, one migration, a Drizzle `comment` on each companion ("Fabric copy of <column>; do not read in the app"). The app keeps reading and writing the `jsonb` column; nothing else changes.
  - `audit_event` is insert-only. The trigger is `BEFORE INSERT` there, so the append-only rule holds.
  - Backfill existing rows in the same migration (an `UPDATE … SET x = x` would fire UPDATE on `audit_event`; backfill the companion column directly with `before::text` etc. as the migration owner).
- **Guard test.** Add `packages/db/src/schema/fabricCompat.test.ts`. It walks the Drizzle schema and fails if a table has a column of an unsupported type without a `_json` text companion, or a `numeric` with precision > 38, or is partitioned. Every future migration then stays mirror-safe in CI (CLAUDE.md rule 10).
- **Analytics views.** `packages/db/sql/analytics/*.sql` won't mirror (they're views). Write a T-SQL version of each for the mirrored database's SQL analytics endpoint in `packages/db/sql/fabric/*.sql`, same names, same `COMMENT` text as a header comment. D&A owns running them in Fabric; we own keeping both in step (a test that checks every analytics view has a Fabric twin).
- Regenerate `docs/data-dictionary.md` (`pnpm db:dictionary`).

## 2. Prepare Postgres (IT + Ben; add to the Bicep in B-20 and the runbook `06`)
- Test: move `Standard_B1ms` (Burstable) to General Purpose (smallest that IT approves, e.g. `Standard_D2ds_v5`). Burstable is not supported.
- Both envs: system-assigned managed identity on the **server** (primary identity), `wal_level=logical`, `azure_cdc` allow-listed and in `shared_preload_libraries`, `max_worker_processes` + 3. These need a server restart: schedule it. The portal's *Fabric mirroring* page sets all of this; Bicep must set it too so a rebuild doesn't lose it.
- **Mirroring role.** An Entra-mapped Postgres role (`ccq_fabric_mirror`) with `azure_cdc_admin` and `CREATE` on the database. It must **own the mirrored tables** (a `CREATE PUBLICATION` requirement). Decide in the spike whether that means the migration owner role is granted to it, or table ownership moves. **Check RLS:** our tables use `FORCE ROW LEVEL SECURITY`, which applies to owners too. Prove the initial snapshot copies every row (count tie-out per table, below); if it doesn't, the mirroring role needs `BYPASSRLS` or a policy of its own. Never weaken the app role's policies to make mirroring work.
- Network: test uses public access + "Allow Azure services", so Fabric connects directly. Prod uses a private endpoint, so it needs a **VNet data gateway** (a delegated subnet in the CCQ VNet; it runs on the Fabric capacity). Add the subnet to `network.bicep`.

## 3. Create and secure the mirror (D&A, with Ben)
- Create *Mirrored Azure Database for PostgreSQL* in each workspace, Entra authentication as `ccq_fabric_mirror`. Mirror the tables in D-FB2 (default: all base tables in `public`, minus `__drizzle_migrations`; `sf_opportunity_snapshot` and `pricing_history_record` are not new data, so D&A decides). Keep the source schema hierarchy.
- **Permissions don't carry over.** Postgres RLS and grants don't apply in OneLake, so rule 2 (commercial fields) must be rebuilt in Fabric:
  - workspace roles: D&A engineers and the CCQ Admin only; no broad viewer access
  - downstream readers get data only through a curated layer (SQL endpoint views or a semantic model) that drops commercial columns (`01-architecture.md` §3.3) unless the reader is in the commercial groups (`SG-CCQ-Pricing`, `-PricingLead`, `-EngLead`, `-Approver`, `-Leadership`, `-Admin`). Use OneLake security / SQL granular permissions (`DENY SELECT` on columns) for the column rule, and RLS in the semantic model for KAM scope.
  - apply the Purview sensitivity label D&A uses for commercial data.
- Reads in Fabric are logged by Fabric/Purview, **not** in CCQ's `audit_event`. Record that as an accepted deviation from rule 3 at M8.

## 4. Keep it running through deploys and restores (code, Ben)
- **DDL breaks mirroring.** Fabric doesn't support `ALTER TABLE` on a mirrored table; the fix is stop + start (a full reseed, a few minutes at our volume: ~40 tables, ~32k SF snapshot rows). In `deploy.yml`, when `pnpm db:migrate` has pending migrations: call `stopMirroring` → migrate → `startMirroring` → poll `getMirroringStatus` until `Running` and `getTablesMirroringStatus` shows no errors (Fabric REST, `https://api.fabric.microsoft.com/v1/workspaces/{ws}/mirroredDatabases/{id}/…`, token for `https://api.fabric.microsoft.com/.default` via the OIDC deploy identity). New tables are picked up automatically when "mirror all data" is on. A failed restart fails the deploy job and alerts; the app itself keeps serving.
- Settings (not secrets): `FABRIC_WORKSPACE_ID`, `FABRIC_MIRRORED_DB_ID` per GitHub environment. Empty = skip the step (local, CI).
- **Health.** A scheduled job (`integration_run` source `fabric`) calls `getMirroringStatus` hourly and writes the result; Admin → Integrations shows it; a non-`Running` status alerts the owners (same path as the other integrations). Add `fabric` to the `integration_run.source` enum.
- Runbook (`06` + B-24): after a PITR restore, or before a major-version upgrade, mirroring must be reconfigured; with HA on (not MVP) on Postgres 16, a failover needs a manual restart.

## 5. Prove it (U5 tie-out)
- Per mirrored table: row count in Postgres = row count in Fabric (SQL endpoint), and a sample of 20 quotes matches field by field, including a `_json` companion parsed back.
- Latency: create a quote in test; it's visible in Fabric within the agreed time (D-FB4; Microsoft quotes near real time, expect minutes).
- A non-commercial Fabric reader cannot see commercial columns; a commercial reader can.

## Done when
- [ ] the guard test is in CI and passes; every `jsonb` column D&A needs has a `_json` companion, backfilled
- [ ] test Postgres is General Purpose with the mirroring parameters, set in Bicep (B-20) and runbook `06`
- [ ] the test mirror is `Running`, every table ties out, latency is measured
- [ ] commercial columns are hidden from non-commercial Fabric readers (tested both ways)
- [ ] `deploy.yml` stops/starts mirroring around migrations and was exercised once on test
- [ ] the hourly status check writes `integration_run` rows and alerts on failure
- [ ] Fabric T-SQL twins of the analytics views handed to D&A
- [ ] prod mirror running through the VNet data gateway (B-22), tied out at U5
- [ ] `01-architecture.md` §6.1, `03-build-steps.md` B-27 and `04` D-FB* updated with what was actually built
