# 07: Fabric Mirroring Setup Runbook (B-27, test environment)

**Goal:** a live, continuously updated copy of the QuoteFlow **test** database in Pretium's Fabric tenant (decision L-8), checked table by table, with QuoteFlow's deploy pipeline and health check wired to it. Postgres stays the app's own database; Fabric gets a read-only copy.

**What "mirroring" means here.** Fabric connects to our Azure Database for PostgreSQL server, copies every table once (the "snapshot"), then keeps copying each change within minutes. No code moves the data: an Azure extension on the database server (`azure_cdc`) sends the changes, and Fabric stores them as Delta tables in OneLake. People in Fabric read the copy through a **SQL analytics endpoint**. Nobody can write to it.

**Who does what.** Every step has an owner label:
- **[Fabric admin]**: whoever holds the **Fabric administrator** role in the tenant (D&A or IT). Needed once, for two tenant settings (Part A).
- **[D&A]**: Brennan Paul's team. Owns the Fabric capacity, the workspace and the mirrored database.
- **[IT]**: Vincent Brown or the Azure admin. Changes the Postgres server in the Azure portal.
- **[Dev]**: Ben. Runs the SQL checks, wires QuoteFlow up, records the results.

**No Cloud Shell, no terminal.** Everything happens in four web pages and one desktop app:
- the **Azure portal** (portal.azure.com)
- the **Fabric portal** (app.fabric.microsoft.com)
- **GitHub** in the browser
- **QuoteFlow** itself (Admin → Integrations)
- **Visual Studio Code with Microsoft's PostgreSQL extension** (or pgAdmin), only for Dev's SQL checks. Setup is in §0.5.

After most steps there's a **Check:** line saying what you should see.

**Sources.** Microsoft Learn, read on 2026-11-02; links at the end. Fabric's screens change often. If a button has a different name, the step's purpose and the Check line still tell you what to look for.

---

## 0. Before the session

### 0.1 Decisions that must be made first

| # | Decision | Why it blocks | Owner |
|---|---|---|---|
| 1 | **D-FB3: approve General Purpose compute for test Postgres.** | Fabric mirroring does **not** support the Burstable tier, and test runs on Burstable `Standard_B1ms` today. Step B1 moves it to General Purpose `Standard_D2ds_v5`, which costs more each month (estimate in `infra/README.md`). Scaling back to Burstable later stops mirroring. | Oliver Kade (cost) + Brennan Paul |
| 2 | **Fabric connects as the database's admin login.** See the box below. | Fabric only mirrors tables owned by the login it connects with. | IT + D&A sign-off |
| 3 | **D-FB2: what's mirrored.** This runbook turns on **Mirror all data**, which copies every table, including the Salesforce copy (`sf_opportunity_snapshot`), the legacy pricing import (`pricing_history_record`) and Drizzle's bookkeeping table (`drizzle.__drizzle_migrations`). | With **Mirror all data** on, tables that future migrations add are mirrored automatically. Picking tables by hand switches that off, so every new table would need a manual add in Fabric. The bookkeeping table holds only migration hashes and dates. | Brennan Paul |
| 4 | **D-FB4: workspace, capacity and the account that creates the mirror.** | The mirrored database **can't change owner**. If its creator's account is disabled, mirroring stops and the mirror has to be recreated. So it must be created by a D&A **service account** (a non-personal user account), not by a person. Until D-FB4 is decided, only D&A engineers and CCQ Admins get access, and there are no downstream readers. | Brennan Paul |

> **Why Fabric connects as the admin login (decision 2).** Microsoft requires the login Fabric uses to **own** every table it mirrors (a PostgreSQL publication rule). In QuoteFlow, every table is created by the migrations, which run as the server's admin login (`ccqadmin` if the server was built with runbook `06`). So that login owns every table today, and will own every table future migrations create.
>
> A separate login would need every table handed over to it with `ALTER TABLE … OWNER TO`. Each future migration would also need the same hand-over, or its new tables would fail to mirror. That's a code change, so it's not part of this runbook.
>
> **What this means in practice:**
> - The Fabric connection stores the admin password, encrypted by Fabric. Only the D&A service account that creates the connection can see or use it; don't share the connection.
> - Changing the admin password means updating the Fabric connection too (§6).
> - Step B6 gives the admin login the `REPLICATION` attribute and the `azure_cdc_admin` role. The app also connects as this login (`06` §6 deviation 3), so the app's login gains these rights.
>
> The follow-up, already a B-21 hardening item, is to split the app's login from the table owner. Mirroring can then move to a dedicated role.

### 0.2 Rights needed (check before the session)

| Who | Where | Right | Why |
|---|---|---|---|
| Fabric admin | Fabric tenant | **Fabric administrator** | Turn on two tenant settings (A2) |
| D&A | Fabric capacity | **Capacity admin or contributor** on a **running** F-SKU capacity | Put the workspace on it (A3) |
| D&A service account | Fabric workspace | **Admin** or **Member** (it is Admin if it creates the workspace) | Only Admin or Member can create a mirrored database. Contributor can't: creation needs the "Reshare" permission to give the Postgres server access to the mirror. |
| IT | Azure, the test Postgres server | **Contributor** (or Owner) on the server or `rg-ccq-test` | Scale compute, enable the server identity, run the Fabric mirroring page, add and remove firewall rules |
| IT (optional) | Entra ID | **Groups Administrator**, or owner of the group used in A2 | Only if the tenant setting in A2 is limited to a security group |
| Dev | Key Vault `kv-quoteflow-test-*` | **Key Vault Secrets Officer** (granted in `06` B4) | Read the admin password from the `database-url` secret |
| Dev | Azure `rg-ccq-test` | **Website Contributor** (granted in `06` B9) | Add two app settings (E2) |
| Dev | GitHub repo | **Admin** | Add two environment variables (E1) |

### 0.3 Names and values (fill in at the start, then don't change)

| Thing | Value | Where to find it |
|---|---|---|
| Resource group | `rg-ccq-test` | |
| Postgres server | `psql-quoteflow-test-<4 letters>` | Azure portal → resource group → the **Azure Database for PostgreSQL flexible server** |
| Server address | `<server>.postgres.database.azure.com` | The server's **Overview** → **Server name** |
| Database | `ccq` | |
| Admin login | `ccqadmin` (check) | The server's **Overview** → **Administrator login** |
| Web app | `quoteflow-test` | `03-build-steps.md` B-20 |
| Deploy identity | `id-quoteflow-deploy` | `06` B8 |
| Key Vault | `kv-quoteflow-test-<4 letters>` | Azure portal → resource group |
| Fabric workspace | `QuoteFlow (CCQ) - test` | D&A may use their own naming standard |
| Mirrored database | `ccq_test_mirror` | Letters, digits and underscores only, to be safe |
| Fabric connection | `ccq-test-postgres` | |

### 0.4 Running order, and the two short outages

| Order | Who | What | Roughly |
|---|---|---|---|
| Any day before | Fabric admin, D&A | **Part A**: tenant settings, workspace, access. A tenant setting can take up to 15 minutes to apply, so do this first. | 30 min |
| 1 | IT | **B1–B3**: scale up, server identity, Fabric mirroring page. **Each of B1 and B3 restarts the database: QuoteFlow test is down for a few minutes each time.** Tell Bailey and Tre beforehand. | 30–45 min |
| 2 | IT + Dev | **B4–B8**: firewall rule for Dev, SQL grants and checks | 20 min |
| 3 | D&A (service account) + Dev | **Part C**: create the mirror, watch the first copy | 20 min |
| 4 | Dev | **Part D**: prove it (row counts, a JSON column, latency) | 30 min |
| 5 | Dev | **Part E**: turn on QuoteFlow's deploy and health hooks | 15 min |
| 6 | IT + Dev | **Part F**: remove the firewall rule, update the docs | 10 min |

> **Freeze schema changes from Part C until E1 is done.** Don't merge a PR that adds a migration (`packages/db/migrations/`) to `main` in that window. Fabric mirroring doesn't support most structural changes to a mirrored table. From E1 on, the deploy pipeline stops mirroring before such a deploy and restarts it afterwards. If one slips through, see §6, "A table shows Failed".

### 0.5 [Dev] Install the SQL tool (10 minutes, once)

1. Install **Visual Studio Code** from code.visualstudio.com.
2. In VS Code, open **Extensions** (the four-squares icon on the left). Search **PostgreSQL**, pick the one published by **Microsoft**, and select **Install**.
3. That's all for now. B5 connects it.

pgAdmin (pgadmin.org) works just as well, if you prefer it.

---

## Part A. Fabric: tenant settings, workspace, access [Fabric admin, D&A]

### A1. [D&A] Make sure the Fabric capacity is running

Azure portal → search **Microsoft Fabric** → open the capacity D&A will use → **Overview**.
- **Check:** the status is **Active**. If it's **Paused**, select **Resume**.
- **Why it matters:** a paused or deleted capacity stops mirroring. Resuming it doesn't restart mirroring by itself; §6 says what to do.

### A2. [Fabric admin] Turn on two tenant settings

1. Fabric portal → **OneLake catalog** → **Govern** tab → **Configurations** → **Tenant settings**. (If you don't see **Govern**, use the **Settings** gear → **Admin portal** → **Tenant settings**.)
2. Under **Developer settings**, open **Service principals can call Fabric public APIs**. Some Microsoft pages still use its old name, "Service principals can use Fabric APIs".
   - Make sure it is **Enabled**.
   - If it's enabled only for **specific security groups**, three identities must be **direct** members of one of those groups. In the **Entra admin center → Groups → the group → Members → + Add members**, search each by name:
     - the Postgres server (its identity has the server's name; it exists only after **B2**, so add it then),
     - `id-quoteflow-deploy`,
     - `quoteflow-test` (the web app's identity).
3. Under **OneLake settings**, make sure **Users can access data stored in OneLake with apps external to Fabric** is **Enabled**. If it's off, the tables never reach "Replicating".
4. Select **Apply** on each setting you changed.

**Check:** both settings show **Enabled**. Changes can take **up to 15 minutes** to apply across the tenant.

### A3. [D&A, signed in as the service account] Create the workspace

1. Fabric portal → **Workspaces** → **+ New workspace**.
2. **Name** `QuoteFlow (CCQ) - test`. Expand **Advanced** → **Workspace type**: **Fabric** (not a trial), and pick the capacity from A1.
3. Select **Apply**.

**Check:** the workspace opens. The service account is its **Admin** (the creator always is).

### A4. [D&A] Give access to the workspace

In the workspace, select **Manage access** (sometimes under **…**) → **Add people or groups**. Add each row below with its role, then select **Add**.

| Who | Role | Why |
|---|---|---|
| D&A engineers (their group) | **Admin** or **Member**, as D&A decides | Run and secure the mirror |
| Ben (CCQ Admin and developer) | **Contributor** | Watch replication, stop and start it if needed, run the tie-out queries |
| `id-quoteflow-deploy` (the GitHub deploy identity) | **Contributor** | The deploy pipeline stops and starts mirroring around schema changes. Stop and start need **read and write** permission on the mirrored database, and Contributor gives that. |
| `quoteflow-test` (the web app's identity) | **Viewer** | QuoteFlow's hourly health check reads the mirroring status, which needs **read** permission. |

- **Don't add** the Postgres server's identity here. Fabric gives it **Read and Write** on the mirrored database by itself in C3.
- **No one else** gets access until D-FB4 is decided. Workspace roles are the only access control on the copy: none of QuoteFlow's Postgres permissions or row-level security carry over to Fabric.
- If a managed identity doesn't show up when you search, the tenant setting from A2 hasn't applied yet. Wait 15 minutes and try again.

**Check:** **Manage access** lists every row above with the right role.

---

## Part B. Prepare the Postgres server [IT, then Dev]

### B1. [IT] Move the server to General Purpose (restart 1)

**Only after D-FB3 is approved.**

1. Azure portal → the Postgres server → **Settings → Compute + storage**.
2. **Compute tier:** **General Purpose**. **Compute size:** **Standard_D2ds_v5** (2 vCores, 8 GiB). Leave storage as it is.
3. Select **Save**. The server restarts, so QuoteFlow test is down for a few minutes.

**Check:** **Overview** shows **General Purpose, D2ds_v5** and status **Ready**. QuoteFlow loads again; if it doesn't after 5 minutes, restart the web app.

### B2. [IT] Turn on the server's own identity

1. The Postgres server → **Security → Identity**.
2. **System assigned managed identity:** **On** → **Save**.

**Check:** the page shows an **Object (principal) ID**.

- **Leave it on, forever.** Microsoft: if this identity is switched off and on again after mirroring starts, mirroring fails. The server writes to OneLake as this identity.
- If A2 used a security group, add this identity (search the server's name) to that group now.

### B3. [IT] Run the Fabric mirroring page (restart 2)

This one page does the rest of the server setup for you: it sets `wal_level = logical`, loads the `azure_cdc` extension, raises `max_worker_processes`, and registers the extension in the database you pick.

1. The Postgres server → in the left menu, type `Fabric` in the search box → open **Fabric mirroring**.
2. Select **Get started**. The page lists the prerequisites. The managed identity row should already be green after B2.
3. Under the databases, tick **`ccq` only**.
4. Select **Prepare**. A **Restart server** box appears. Select **Restart**. QuoteFlow test is down for a few minutes again.

**Check:** when the restart finishes, the **Fabric mirroring** page says the server is ready for mirroring. **Overview** shows **Ready**.

### B4. [IT] Let Dev's computer reach the database (temporary)

1. The Postgres server → **Settings → Networking**.
2. Select **+ Add current client IP address** **on Dev's computer**, or type Dev's public IP address as both start and end. Name the rule `tmp-dev-fabric-setup`.
3. **Don't touch** the existing rules, and leave **Allow public access from any Azure service within Azure to this server** ticked: QuoteFlow and Fabric both connect through it.
4. Select **Save**.

**Check:** the rule is in the list. Rule changes can take up to 5 minutes to apply. Part F removes it.

### B5. [Dev] Connect VS Code to the database

1. **Get the password.** Azure portal → the Key Vault → **Objects → Secrets** → `database-url` → the current version → **Show Secret Value**.
   - It looks like `postgres://ccqadmin:<password>@<server>.postgres.database.azure.com:5432/ccq?sslmode=verify-full`.
   - The password is the part between `ccqadmin:` and `@`.
   - Copy only the password. Don't paste it anywhere except the connection dialog.
2. In VS Code, open the **PostgreSQL** icon on the left → **Add Connection** (the **+**). Fill in:
   - **Server name:** `<server>.postgres.database.azure.com`
   - **Authentication type:** **Password**
   - **User name:** `ccqadmin`
   - **Password:** the password from step 1
   - **Database name:** `ccq`
   - **SSL mode:** **require**
3. Select **Connect**, then right-click the connection → **New Query**.

**Check:** `SELECT current_user, current_database();` returns `ccqadmin | ccq`.

### B6. [Dev] Give the admin login what mirroring needs

Run these in the `ccq` database **one line at a time** (select a line, then run it), so one refusal doesn't stop the others:

```sql
ALTER ROLE ccqadmin WITH REPLICATION;       -- the admin login has LOGIN, CREATEDB, CREATEROLE but not REPLICATION
GRANT azure_cdc_admin TO ccqadmin;          -- manages the azure_cdc replication (this role exists only after B3)
GRANT CREATE ON DATABASE ccq TO ccqadmin;   -- lets it create the publication in ccq
```

These are what Microsoft's mirroring tutorial grants to the login Fabric connects as.

**Check:** each line succeeds.
- **`GRANT azure_cdc_admin` says the role doesn't exist:** B3 didn't finish, or you're connected to the wrong database (it must be `ccq`).
- **`ALTER ROLE` says `permission denied to alter role`:** standard PostgreSQL 16 refuses this, although Microsoft documents that the Azure admin login can run it. Note the error and carry on with the other two lines; Microsoft's instructions for an Entra login grant only those two, without `REPLICATION`. If C2 later shows **"Internal error"**, this refusal is the first thing to raise with Microsoft support.

### B7. [Dev] Check the server is ready

```sql
SELECT * FROM azure_cdc.check_prerequisites();
```

**Check:** `status` is **OK**.

| If `data` shows | Fix |
|---|---|
| `IDENTITY_NOT_CONFIGURED` | B2 didn't apply. Check **Security → Identity** is **On**. |
| `USER_NOT_CDC_ADMIN` or `NO_CREATE_PRIVILEGE_ON_DATABASE` | Re-run B6. |
| `MAX_WORKER_PROCESSES_TOO_LOW` | **[IT]** **Settings → Server parameters** → `max_worker_processes` = **16** (the value in our Bicep) → **Save** → **Overview → Restart**. Then run this check again. |
| `SERVER_IN_RECOVERY` | You're connected to a replica. Test has none, so check the server name. |

### B8. [Dev] Check every table can be mirrored

```sql
SELECT mirroring_status, count(*) AS tables
FROM azure_cdc.get_all_tables_mirror_status()
GROUP BY mirroring_status;

SELECT table_schema, table_name, mirroring_status, mirroring_data
FROM azure_cdc.get_all_tables_mirror_status()
WHERE mirroring_status <> 'OK'
ORDER BY table_schema, table_name;
```

**Check:**
- **No `ERROR` rows.** An `ERROR` with `NOT_TABLE_OWNER` means a table isn't owned by `ccqadmin`. **Stop and tell Ben's team before Part C.**
- **`WARNING` rows are expected,** each with `UNSUPPORTED_DATA_TYPE`. These are the tables with `jsonb` or array columns. Every one must appear in `packages/db/src/fabric.ts`: `FABRIC_JSON_COMPANIONS`, plus `audit_event`, whose copies are in `audit_event_fabric`.
  - Fabric skips those columns. It mirrors their text copies instead (`<column>_json`), which QuoteFlow keeps in step (migration 0022).
- A `WARNING` with **`NO_INDEX_FULL_IDENTITY`** means a table has no primary key. QuoteFlow shouldn't have any. Note the table and tell Ben's team; it still mirrors, just less efficiently.

Also note the server parameters for the record (Part F), from the portal → **Settings → Server parameters**:
- `wal_level` (should be `logical`)
- `shared_preload_libraries` (should include `azure_cdc`)
- `max_worker_processes` (13 or more)
- `azure.extensions` (should still include `pg_trgm` and `pgcrypto`, which QuoteFlow needs, plus `azure_cdc`; the portal may show them in capitals)
- `azure.fabric_mirror_enabled` (should be `on`)

---

## Part C. Create the mirror [D&A as the service account, Dev watching]

### C1. [D&A] Start a new mirrored database

1. Fabric portal, signed in as the **D&A service account** → the workspace `QuoteFlow (CCQ) - test`.
2. Select **+ New item** → **Mirrored Azure Database for PostgreSQL**. It's in the **Data Warehouse** group; the filter box finds it if you type `PostgreSQL`.

### C2. [D&A] Connect to the test database

1. Choose **Azure Database for PostgreSQL** as a new source, and fill in:

   | Field | Value |
   |---|---|
   | **Server** | `<server>.postgres.database.azure.com` |
   | **Database** | `ccq` |
   | **Connection** | **Create new connection** |
   | **Connection name** | `ccq-test-postgres` |
   | **Data gateway** | **None**. Test allows Azure services through its firewall, so Fabric connects directly. Production will need a VNet data gateway (§7). |
   | **Authentication kind** | **Basic** (PostgreSQL authentication) |
   | **Username** | `ccqadmin` |
   | **Password** | the admin password (B5 step 1) |
   | **Use encrypted connection** | leave **ticked** |
   | **This connection can be used with on-premises data gateway and VNET data gateway** | leave **unticked** |

2. **Entering the password.** Whoever holds Key Vault access (Ben or IT) types or pastes it straight into this field on the service account's screen. Or send it once through Pretium's approved secret-sharing tool. Never send it by chat or email, and never read it aloud.
3. Select **Connect**.

**Check:** Fabric moves on to choosing the data.
- An **"Internal error"** here means a Part B step is missing, usually B6. Microsoft's docs list this as the symptom of any missed security step.
- A connection or time-out error usually means the server's address is wrong. Or **Allow public access from any Azure service** was unticked in **Networking**.

### C3. [D&A] Choose the data and start mirroring

1. Leave **Mirror all data** **on** (decision 3 in §0.1). New tables created by future migrations are then mirrored automatically.
2. Fabric shows notes on some tables about **unsupported data types**: the `jsonb` and array columns found in B8. That's expected. Microsoft's limitations page says those columns are skipped and the table is still mirrored; D3 proves it.
3. Select **Mirror database**. When Fabric asks for a name, enter `ccq_test_mirror`.

**Check:** after 2–5 minutes, select **Monitor replication**.
- The status becomes **Running**.
- Each table appears with a status. They show **Snapshotting** first, then **Replicating**.
- A date appears in **Last refresh** once a table's first copy is done. If the list is empty, wait a few seconds and refresh.

### C4. [D&A] Check the server's permission on the mirror (don't change it)

In the workspace, on the mirrored database select **…** → **Manage permissions**.

**Check:** the Postgres server (listed under its server name) has **Read** and **Write**. Fabric added it in C3.
- **Never remove it.** Without it, no new data reaches Fabric. If it's ever removed, add it back here with Read and Write (§6).

### C5. [D&A → Dev] Hand over the two IDs (not secrets)

Open the **mirrored database** item itself, not the SQL analytics endpoint next to it, which has a different ID. Its browser address looks like `…/groups/<workspace ID>/…/<mirrored database ID>…`:
- **Workspace ID:** the first long ID, the one right after `/groups/`.
- **Mirrored database ID:** the second long ID.

Both look like `1a2b3c4d-1111-2222-3333-444455556666`. Send both to Ben.

---

## Part D. Prove it works [Dev]

### D1. [Dev] Postgres side: the copy is flowing

In VS Code (B5):

```sql
SELECT active, snapshot_done, snapshot_progress_percentage FROM azure_cdc.tracked_publications;
SELECT slot_name, active FROM pg_replication_slots;
```

**Check:** one row in each, with `active` = **true**. `snapshot_done` = **true** once the first copy has finished.

### D2. [Dev] Row counts match, table by table (the U5 tie-out)

The counts are compared while QuoteFlow is running, so a busy table (`integration_run`, `audit_event`, `notification`) can be a few rows apart. Fabric is a few minutes behind. If one differs, run both sides again a few minutes later.

1. **Postgres counts.** Run in VS Code and keep the result:
   ```sql
   SELECT table_schema, table_name,
          (xpath('/row/n/text()',
                 query_to_xml(format('SELECT count(*) AS n FROM %I.%I', table_schema, table_name),
                              false, true, '')))[1]::text::bigint AS row_count
   FROM information_schema.tables
   WHERE table_schema IN ('public', 'drizzle') AND table_type = 'BASE TABLE'
   ORDER BY table_schema, table_name;
   ```
2. **Make the Fabric query.** This query writes the matching T-SQL for you. Run it in VS Code and copy the single text value it returns:
   ```sql
   SELECT string_agg(
            format('SELECT %L AS table_schema, %L AS table_name, COUNT_BIG(*) AS row_count FROM [%s].[%s]',
                   table_schema, table_name, table_schema, table_name),
            E'\nUNION ALL\n' ORDER BY table_schema, table_name)
          || E'\nORDER BY table_schema, table_name;'
   FROM information_schema.tables
   WHERE table_schema IN ('public', 'drizzle') AND table_type = 'BASE TABLE';
   ```
3. **Fabric counts.** In the workspace, open the **SQL analytics endpoint** (it has the mirror's name) → **New SQL query** → paste → **Run**.
4. Compare the two lists.

**Check:**
- **Same tables on both sides.** Fabric keeps the Postgres schemas, so tables appear as `public.<table>` and `drizzle.__drizzle_migrations`.
- **Same counts.**
- If a table is missing in Fabric right after the first copy, wait a few minutes and run again: the SQL endpoint can lag the copy briefly.
- If a table is still missing or short after 15 minutes, look at its status in **Monitor replication** and see §6.

> **Why counts are trustworthy here.** Postgres row-level security also applies to the table owner, because QuoteFlow forces it. The admin login sees every row only because it inherits the `ccq_migrator` role, whose policies allow everything (`06` B2; `packages/db/src/migrate.ts`). Matching counts prove that Fabric's first copy got every row too.

### D3. [Dev] A JSON column arrived as text

In the Fabric query window:

```sql
SELECT TOP 5 id, counts_json FROM [public].[integration_run] ORDER BY started_at DESC;
```

**Check:**
- `counts_json` holds JSON text (it starts with `{`), the same counters QuoteFlow shows in **Admin → Integrations**.
- `integration_run` has **no** `counts` column in Fabric: the `jsonb` original is skipped, and the text copy is what D&A reads.

### D4. [Dev] Measure how far behind Fabric is

1. Note the time. In QuoteFlow test, select **Report an issue** and send: type **An idea**, severity **Sev-4: cosmetic**, description `Fabric latency test - please ignore`.
2. In Fabric, run this every minute until the new row appears:
   ```sql
   SELECT TOP 3 id, created_at, type, severity FROM [public].[feedback] ORDER BY created_at DESC;
   ```
3. Record the minutes it took. The target is **15 minutes** (D-FB4, proposed). Microsoft describes mirroring as near real time.
4. In QuoteFlow, **Admin → Feedback**: set the test report to **Won't fix**.

**Check:** the row appears within the target. Write the measured time in `03-build-steps.md` under B-27.

---

## Part E. Turn on QuoteFlow's hooks [Dev]

QuoteFlow already has the code (B-27, PR #32). It only needs the two IDs from C5.

### E1. [Dev] GitHub: the deploy pipeline

GitHub → the repo → **Settings → Environments → `test` → Environment variables → Add environment variable**. Add these two:

| Name | Value |
|---|---|
| `FABRIC_WORKSPACE_ID` | the workspace ID (C5) |
| `FABRIC_MIRRORED_DB_ID` | the mirrored database ID (C5) |

**What changes:** from now on, when a deploy brings a new migration, **Deploy (test)** does three things:
- it stops mirroring before deploying;
- it starts mirroring again after the smoke test (or after a failed deploy);
- it waits until mirroring is **Running** and no table is **Failed** or **Stopped**.

Starting again copies every table from scratch, so nothing is lost. Deploys without migrations don't touch mirroring. This ends the schema-change freeze from §0.4.

### E2. [Dev] Azure: the hourly health check

Azure portal → web app `quoteflow-test` → **Settings → Environment variables → App settings → + Add**. Add the same two names and values as E1, then **Apply** → **Confirm**. The app restarts.

> **Bicep note.** When the Bicep in `infra/` is applied, it replaces the whole set of app settings. Before that first apply, put these two IDs in `infra/main.test.bicepparam` (`fabricWorkspaceId`, `fabricMirroredDbId`), or the apply removes them.

### E3. [Dev] Check both hooks

1. **Health check.** About 5 minutes after the restart, open QuoteFlow → **Admin → Integrations**.
   - **Check:** a **fabric** run shows **succeeded**, with table counts. After that it runs every hour.
   - A **failed** run with `Fabric API unavailable (…)` means the web app's identity can't read the mirror. Check A2 and the **Viewer** row in A4.
2. **Deploy hooks.** The first deploy that brings a migration is the real test. Open that run in **Actions → Deploy (test)**.
   - **Check:** **Fabric mirroring (stop if migrations change)** printed `stop requested`, and **Fabric mirroring (start and wait until Running)** ended with `mirroring Running; every table replicating or snapshotting`. Tick B-27's "exercised once on test" box then.
   - If the stop step fails with an authorization error, nothing was deployed and mirroring wasn't touched. Fix the deploy identity's **Contributor** role (A4) and A2, then re-run the workflow.

---

## Part F. Close out [IT, Dev]

### F1. [IT] Remove the temporary firewall rule

The Postgres server → **Settings → Networking** → delete `tmp-dev-fabric-setup` → **Save**. Leave every other rule as it was.

### F2. [Dev] Record and tick

- **`03-build-steps.md` B-27:** tick "the test mirror is `Running`, every table ties out, latency is measured". Write down the date, the measured latency, and the workspace and mirrored database IDs (identifiers, not secrets). Tick "test Postgres is General Purpose with the mirroring parameters". Note the deviation: it was set by the portal's Fabric mirroring page; the Bicep in `infra/` matches but isn't applied yet.
- **`infra/README.md`**, under "Check on the first apply": record the server parameter values from B8. The Bicep sets `max_worker_processes = 16` and `shared_preload_libraries = pg_cron,pg_stat_statements,azure_cdc`. If the portal set something different, note it, so the first apply's what-if is understood.
- **`04-decisions-and-risks.md`:** mark D-FB3 decided, with the date. Record decisions 2–4 from §0.1 as made.
- **`06` §6:** add the deviation "Fabric connects as the admin login" (§0.1).

### F3. Tell people

Brennan Paul and Oleg Yarovinski: the test mirror is running, with the tie-out result and measured latency. D&A can start on the curated layer: the T-SQL twins of the analytics views are in `packages/db/sql/fabric/`.

---

## 6. Day-to-day and when things go wrong

| Situation | What happens | What to do |
|---|---|---|
| A deploy brings a migration | The pipeline stops mirroring, deploys, starts it again, and waits (E1) | Nothing. Watch the two Fabric steps in the run. |
| **A table shows Failed** in Monitor replication | Usually a structural change reached the table while mirroring ran (a migration deployed without the stop step, or before E1). Microsoft supports adding, renaming and dropping a column, and changing the primary key, while mirroring runs; other changes can fail a table. | Fabric → the mirrored database → **Stop replication**, then start it again (**Start replication**, or **Mirror database**). Every table is copied again from scratch. Then repeat D2. |
| The Fabric capacity was **paused** (or resumed) | Mirroring stops, and doesn't restart on its own when the capacity comes back | Resume the capacity (A1), then **Stop replication** and start it again |
| The capacity is **overloaded** | Mirroring pauses | It carries on by itself when the overload ends. If it happens often, D&A sizes the capacity up. |
| QuoteFlow **Admin → Integrations** shows a failed **fabric** run | Admins get one in-app alert when the mirror **becomes** unhealthy | Read the reason on the run, then this table. QuoteFlow keeps working either way. |
| The **admin password is reset** | The app and Fabric both lose access | Update the `database-url` secret (`06` B4) and restart the web app. In Fabric, **Settings (gear) → Manage connections and gateways** → `ccq-test-postgres` → edit the credentials (the connection's owner does this). |
| Someone **switched the server identity off and on** | Mirroring fails (Microsoft) | Stop replication and start it again. If it still fails, delete the mirrored database and redo Part C. |
| The server's permission on the mirror was removed | No new data reaches Fabric | C4: **Manage permissions** → add the server's name with **Read** and **Write** |
| A **point-in-time restore** of the server | The restored server isn't mirrored | Redo Parts B and C on the restored server (Microsoft: mirroring must be reconfigured) |
| A **major version upgrade** (16 → 17) | Not supported while mirroring | Stop replication first, upgrade, then start it again |
| A **failover** (high availability is **off** in test today) | On PostgreSQL 16, mirroring doesn't follow a failover | Restart mirroring by hand after any failover. PostgreSQL 17 and later follow it automatically. |
| The **service account** that created the mirror is disabled | Mirroring stops. A mirrored database can't change owner. | Create a new mirrored database (Part C) with a working service account, then update the two IDs (E1, E2) |
| Someone wants to **remove a table** from the mirror | Microsoft: its data is deleted from OneLake | Don't, without a D-FB2 decision |
| Someone runs **`TRUNCATE`** on a table | Not supported for mirrored tables | Never `TRUNCATE` QuoteFlow tables (CLAUDE.md rule 10) |
| C2 shows **"Internal error"** | A Part B security step is missing | Re-run B6, B7 and B8 |
| A table isn't listed, or `NOT_TABLE_OWNER` | The table isn't owned by `ccqadmin` | Tell Ben's team. Don't change ownership by hand: migrations expect `ccqadmin` to own every table. |
| Tables never get past Initialized / "Tables Cannot Reach Replicating Status" | The OneLake tenant setting is off | A2 step 3 |
| A managed identity can't be found in **Manage access** | The service-principal tenant setting isn't on (or not applied yet), or the identity isn't in the allowed group | A2 step 2, then wait 15 minutes |

**More checks on the Postgres side** (VS Code, as in B5):
- `SELECT * FROM azure_cdc.get_health_status('', '');` lists server-wide mirroring errors. `CDC_ERR_SYS_ONELAKE_PERMISSION_DENIED` usually means the server's permission on the mirror is gone (C4) or a tenant setting is off (A2).
- `SELECT * FROM azure_cdc.tracked_batches ORDER BY completed_batch_id DESC LIMIT 5;` shows whether new change batches are still being sent.

## 7. Production (later, B-22)

The same steps, with three differences:
- **Network.** Prod Postgres has no public access (private endpoint), so Fabric can't connect directly. D&A creates a **VNet data gateway** in the subnet `snet-fabric-gw` that the Bicep provides (`infra/modules/network.bicep`), and picks it in C2's **Data gateway** field. Its creator needs permission to join that subnet, for example **Network Contributor** on the VNet.
- **Names.** A separate workspace (`QuoteFlow (CCQ) - prod`), and the prod deploy identity `id-quoteflow-deploy-prod`. The variables go on the GitHub **production** environment.
- **Timing** is decision D-FB5.

A prod runbook section will be written once the gateway is agreed.

## Sources (Microsoft Learn, read 2026-11-02)

- Tutorial: mirroring Azure Database for PostgreSQL (prerequisites, database role, table ownership, creating the mirror): https://learn.microsoft.com/en-us/fabric/mirroring/azure-database-postgresql-tutorial
- Postgres side: the Fabric mirroring page, parameters, monitoring functions, eligible tables: https://learn.microsoft.com/en-us/azure/postgresql/integration/concepts-fabric-mirroring
- Limitations (Burstable not supported, DDL, `TRUNCATE`, PITR, major version upgrade, HA, unsupported types, Admin/Member to create): https://learn.microsoft.com/en-us/fabric/mirroring/azure-database-postgresql-limitations
- Troubleshooting (status codes, `check_prerequisites`, supported DDL, capacity changes, server identity): https://learn.microsoft.com/en-us/fabric/mirroring/azure-database-postgresql-troubleshoot
- FAQ (stop and start re-copies every table; removing a table deletes its data): https://learn.microsoft.com/en-us/fabric/mirroring/azure-database-postgresql-mirroring-faq
- Mirroring REST API (status, start, stop): https://learn.microsoft.com/en-us/fabric/mirroring/mirrored-database-rest-api · Start Mirroring needs read and write: https://learn.microsoft.com/en-us/rest/api/fabric/mirroreddatabase/mirroring/start-mirroring · Get Tables Mirroring Status needs read: https://learn.microsoft.com/en-us/rest/api/fabric/mirroreddatabase/mirroring/get-tables-mirroring-status
- Share a mirrored database and manage permissions (the server identity's Read and Write): https://learn.microsoft.com/en-us/fabric/mirroring/share-and-manage-permissions
- Mirrored databases can't change owner: https://learn.microsoft.com/en-us/fabric/fundamentals/item-ownership-take-over
- Tenant settings (where they are, up to 15 minutes to apply): https://learn.microsoft.com/en-us/fabric/admin/about-tenant-settings · Developer settings: https://learn.microsoft.com/en-us/fabric/admin/service-admin-portal-developer
- Workspaces: create https://learn.microsoft.com/en-us/fabric/fundamentals/create-workspaces · give access https://learn.microsoft.com/en-us/fabric/fundamentals/give-access-workspaces · roles https://learn.microsoft.com/en-us/fabric/fundamentals/roles-workspaces · find the workspace ID https://learn.microsoft.com/en-us/fabric/admin/portal-workspace
- Postgres server identity (portal steps): https://learn.microsoft.com/en-us/azure/postgresql/security/security-configure-managed-identities-system-assigned
- Scale compute (restart): https://learn.microsoft.com/en-us/azure/postgresql/scale/how-to-scale-compute · Manage the server in the portal: https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/how-to-manage-server-portal
- Firewall rules (add current client IP; "Allow Azure services"): https://learn.microsoft.com/en-us/azure/postgresql/network/how-to-networking-servers-deployed-public-access-add-firewall-rules
- The admin login's attributes and `azure_pg_admin`: https://learn.microsoft.com/en-us/azure/postgresql/security/security-manage-database-users · `ALTER ROLE <admin> WITH REPLICATION`: https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-logical
