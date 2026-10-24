# 06: Entra and Azure Setup Runbook (Phase 1: Unlock the platform)

**Goal for the 1-hour session:** real Microsoft sign-in with the nine CCQ roles (B-26 added `CCQ.PricingLead`), and QuoteFlow running on an Azure **test** URL, deployed automatically from GitHub. Synthetic data only.

**Who does what.** Every step has an owner label:
- **[IT]**: Vincent Brown or the IT admin. Needs the Entra and Azure rights listed in §0.2.
- **[Dev]**: Ben (and any later developer).

**How the commands work.**
- Every **[IT]** command runs in **Azure Cloud Shell (Bash)**: portal.azure.com → the `>_` icon at the top → **Bash**. On first use choose **No storage account required**.
- Cloud Shell has the newest Azure CLI and is already signed in as you.
- Commands are copy-paste. Variables are set once at the top of each part. If Cloud Shell times out (20 minutes idle), paste that part's variable block again before carrying on.
- After most steps there's a **Check:** line: what you should see in the portal.

**Sources.** Microsoft Learn, read on 2026-10-19, and every command re-checked against its CLI or Graph reference page the same evening; links at the end. The CLI changes often, so if a flag is rejected, run the command with `--help` and use the new name.

---

## 0. Before the meeting

### 0.1 [Dev] Have these ready (10 minutes)
- [ ] The PR with this runbook is **merged to `main`**. It adds the deploy pipeline, the Azure start-up script and the Postgres fix this setup needs.
- [ ] You can open the repo's **Settings** on GitHub (you need repo admin) to add variables in Part C.
- [ ] This file open on screen to share.
- [ ] Your work email (UPN), so IT can add you to groups and make you an owner.

### 0.2 [IT] Rights needed (check before the meeting, or the session stalls)

| Where | Right | Why |
|---|---|---|
| Entra ID | **Cloud Application Administrator** or **Application Administrator** | Create the app registrations, grant admin consent, assign groups to roles |
| Entra ID | **Groups Administrator** or **User Administrator** (or owner of existing groups) | Create the `SG-CCQ-*` groups and add members |
| Entra licence | **Entra ID P1 or P2** in the tenant | Assigning **groups** to app roles needs P1/P2. Without it, assign people one by one (see A8). |
| Azure subscription | **Owner**, or **Contributor + User Access Administrator** | Create the resource group and resources, and grant roles to the app and to Ben |
| Azure subscription | Resource providers registered (step B1 does it) | First use of App Service, Postgres, Key Vault, Monitor in the subscription |

### 0.3 Names we'll use (agree at the start of the meeting, then don't change)

| Thing | Name | Note |
|---|---|---|
| Resource group | `rg-ccq-test` | |
| Region | `centralus` | Pretium HQ is US Central. Any US region works. |
| Web app | `app-quoteflow-test-<4 letters>` | **Must be unique across all of Azure** (it becomes `<name>.azurewebsites.net`). Pick it first, e.g. `app-quoteflow-test-ptpk`. |
| App Service plan | `asp-quoteflow-test` | Linux, B1 |
| PostgreSQL server | `psql-quoteflow-test-<same 4 letters>` | Must be unique across Azure |
| Database | `ccq` | |
| Key Vault | `kv-quoteflow-test-<4 letters>` | 3–24 characters, unique across Azure |
| Storage account | `stquoteflowtest<4 letters>` | Lower-case letters and digits only, 3–24, unique |
| App Insights / Log Analytics | `appi-quoteflow-test` / `log-quoteflow-test` | |
| Deploy identity | `id-quoteflow-deploy` | Used by GitHub Actions; no password |
| App registrations | `QuoteFlow-API`, `QuoteFlow-SPA` | |
| Groups | `SG-CCQ-KAM`, `SG-CCQ-SalesLeader`, `SG-CCQ-EngLead`, `SG-CCQ-Engineer`, `SG-CCQ-Pricing`, `SG-CCQ-PricingLead` (B-26), `SG-CCQ-Approver`, `SG-CCQ-Leadership`, `SG-CCQ-Admin` | `SG-CCQ-PostAward` later (P2) |

### 0.4 Running order for the hour

| Minutes | Who | What |
|---|---|---|
| 0–5 | IT + Dev | Agree names (§0.3). IT opens **two** Cloud Shell tabs. |
| 5–8 | IT | **Tab 2: start the PostgreSQL server first** (B2). It takes 5–10 minutes, so it runs while you do Entra. |
| 8–30 | IT | **Tab 1: Entra** (Part A) |
| 30–50 | IT | **Tab 2: the rest of Azure** (Part B) |
| 50–60 | Dev (+ IT watching) | **GitHub + first deploy + sign-in test** (Part C) |

---

## Part A. Microsoft Entra: sign-in and roles [IT]

What this creates:
- **QuoteFlow-API**: the app registration the server checks tokens against. It holds the **app roles** (`CCQ.KAM`, …) and the `access_as_user` scope.
- **QuoteFlow-SPA**: the app registration the browser signs in with.
- **Groups** assigned to the roles. Whoever is in `SG-CCQ-KAM` gets `CCQ.KAM` in their token, and so on.

### A1. [IT] Variables (Tab 1)

Replace the two values in `<…>`, then paste.

```bash
WEBAPP=<web app name from 0.3>          # e.g. app-quoteflow-test-ptpk
DEV_UPN=<Ben's sign-in email>           # e.g. ben.whann@pretiumpkg.com
APP_URL="https://$WEBAPP.azurewebsites.net"
TENANT_ID=$(az account show --query tenantId -o tsv)
DEV_OID=$(az ad user show --id "$DEV_UPN" --query id -o tsv)
echo "tenant=$TENANT_ID dev=$DEV_OID url=$APP_URL"
```
**Check:** all three values print. If `dev=` is empty, the email is wrong.

### A2. [IT] Create the API registration

```bash
az ad app create --display-name "QuoteFlow-API" --sign-in-audience AzureADMyOrg --requested-access-token-version 2
API_APP_ID=$(az ad app list --display-name "QuoteFlow-API" --query "[0].appId" -o tsv)
API_OBJ_ID=$(az ad app list --display-name "QuoteFlow-API" --query "[0].id" -o tsv)
az ad app update --id $API_APP_ID --identifier-uris "api://$API_APP_ID"
az ad sp create --id $API_APP_ID          # the CLI does not create the enterprise app; this does
echo "API client id: $API_APP_ID"
```
- **What it does:** creates a single-tenant registration that issues **v2** access tokens (the API only accepts v2) and sets the Application ID URI to `api://<client id>`.
- **Check:** Entra admin center → **App registrations → QuoteFlow-API → Manifest** shows `"requestedAccessTokenVersion": 2`. **Expose an API** shows `api://<client id>`.

### A3. [IT] Add the `access_as_user` scope

```bash
SCOPE_ID=$(cat /proc/sys/kernel/random/uuid)
az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$API_OBJ_ID" \
  --headers "Content-Type=application/json" --body "{
  \"api\": { \"requestedAccessTokenVersion\": 2, \"oauth2PermissionScopes\": [{
    \"id\": \"$SCOPE_ID\", \"value\": \"access_as_user\", \"type\": \"User\", \"isEnabled\": true,
    \"adminConsentDisplayName\": \"Access QuoteFlow as the signed-in user\",
    \"adminConsentDescription\": \"Lets the QuoteFlow web app call the QuoteFlow API as the signed-in user.\",
    \"userConsentDisplayName\": \"Access QuoteFlow\",
    \"userConsentDescription\": \"Lets the QuoteFlow web app call QuoteFlow for you.\" }]}}"
```
**Check:** **QuoteFlow-API → Expose an API** lists `api://<id>/access_as_user`, state **Enabled**.

*Portal alternative:* **Expose an API → Add a scope**. Name `access_as_user`; who can consent **Admins and users**; fill the display names; state **Enabled**.

### A4. [IT] Create the app roles

```bash
uuid() { cat /proc/sys/kernel/random/uuid; }
cat > roles.json <<EOF
[
 {"allowedMemberTypes":["User"],"value":"CCQ.KAM","displayName":"CCQ KAM","description":"Key account manager: creates intakes, records outcomes","id":"$(uuid)","isEnabled":true},
 {"allowedMemberTypes":["User"],"value":"CCQ.SalesLeader","displayName":"CCQ Sales Leader","description":"G1 qualify decision, approves priority overrides","id":"$(uuid)","isEnabled":true},
 {"allowedMemberTypes":["User"],"value":"CCQ.EngLead","displayName":"CCQ Engineering Lead","description":"Owns the engineering queue and the G2 decision","id":"$(uuid)","isEnabled":true},
 {"allowedMemberTypes":["User"],"value":"CCQ.Engineer","displayName":"CCQ Engineer","description":"Engineering review on assigned quotes","id":"$(uuid)","isEnabled":true},
 {"allowedMemberTypes":["User"],"value":"CCQ.Pricing","displayName":"CCQ Pricing","description":"Quoting stage: price approval and references","id":"$(uuid)","isEnabled":true},
 {"allowedMemberTypes":["User"],"value":"CCQ.PricingLead","displayName":"CCQ Pricing Lead","description":"Pricing, plus assigns and reassigns pricers on the pricing queue","id":"$(uuid)","isEnabled":true},
 {"allowedMemberTypes":["User"],"value":"CCQ.Approver","displayName":"CCQ Approver","description":"Final Review (G4) approve or decline","id":"$(uuid)","isEnabled":true},
 {"allowedMemberTypes":["User"],"value":"CCQ.Leadership","displayName":"CCQ Leadership","description":"Read everything including analytics","id":"$(uuid)","isEnabled":true},
 {"allowedMemberTypes":["User"],"value":"CCQ.Admin","displayName":"CCQ Admin","description":"Manages QuoteFlow configuration","id":"$(uuid)","isEnabled":true},
 {"allowedMemberTypes":["User"],"value":"CCQ.PostAward","displayName":"CCQ Post-Award","description":"P2: read awarded quotes and the hand-off view","id":"$(uuid)","isEnabled":true}
]
EOF
az ad app update --id $API_APP_ID --app-roles @roles.json
az ad app show --id $API_APP_ID --query "appRoles[].value" -o tsv
```
- **Spelling matters.** The server reads the `roles` claim and only accepts values starting `CCQ.` exactly as above.
- `"User"` is what the portal calls **Users/Groups**.
- `CCQ.PostAward` is created now so nobody has to come back for it; it has no group yet.
- **Check:** the last command prints the ten values. **App roles** shows ten roles, all enabled.
- **Only for a new registration.** `--app-roles` replaces the whole list, and Entra refuses to change or drop a role that is enabled. To add a role to a registration that already has roles, use A4a.

### A4a. Adding a role to an existing registration (B-26: `CCQ.PricingLead`)

Anyone who owns **QuoteFlow-API** (Ben is an owner after A8) can do this; no IT ticket is needed for the role itself. Creating the security group may need a groups admin, depending on the tenant's settings.

**Portal (about 5 minutes):**
1. **Entra admin center → App registrations → All applications → QuoteFlow-API → App roles → + Create app role.**
2. **Display name** `CCQ Pricing Lead`. **Allowed member types** *Users/Groups*. **Value** `CCQ.PricingLead` (exact spelling and case). **Description** "Pricing, plus assigns and reassigns pricers on the pricing queue". Tick **Do you want to enable this app role?** → **Apply**.
3. **Groups → New group:** type *Security*, name `SG-CCQ-PricingLead`, add the pricing lead(s) as **direct** members → **Create**.
4. **Enterprise applications → QuoteFlow-API → Users and groups → + Add user/group:** pick `SG-CCQ-PricingLead` (or, without Entra ID P1/P2, the people themselves) → role **CCQ Pricing Lead** → **Assign**.
5. The user signs out and in again (the role arrives in a new token). The account menu then shows **Pricing Lead**, and the pricing queue shows the assign controls.

**CLI (appends, keeping the existing roles and their ids):**
```bash
uuid() { cat /proc/sys/kernel/random/uuid; }
az ad app show --id $API_APP_ID --query appRoles > roles-current.json
jq --arg id "$(uuid)" '. + [{"allowedMemberTypes":["User"],"value":"CCQ.PricingLead","displayName":"CCQ Pricing Lead","description":"Pricing, plus assigns and reassigns pricers on the pricing queue","id":$id,"isEnabled":true}]' roles-current.json > roles.json
az ad app update --id $API_APP_ID --app-roles @roles.json
az ad app show --id $API_APP_ID --query "appRoles[].value" -o tsv   # now includes CCQ.PricingLead
```
Then run the A8 loop with `R=PricingLead` only. The app needs no change: it accepts any `CCQ.` role it knows, and B-26 added `PricingLead` to the code.

### A5. [IT] Lock the API to assigned people only

```bash
az ad sp update --id $API_APP_ID --set appRoleAssignmentRequired=true
```
**Check:** **Enterprise applications → QuoteFlow-API → Properties → Assignment required?** = **Yes**. Only people with a CCQ role (through a group) can get a token for the API.

### A6. [IT] Create the SPA registration and its redirect URIs

```bash
az ad app create --display-name "QuoteFlow-SPA" --sign-in-audience AzureADMyOrg
SPA_APP_ID=$(az ad app list --display-name "QuoteFlow-SPA" --query "[0].appId" -o tsv)
SPA_OBJ_ID=$(az ad app list --display-name "QuoteFlow-SPA" --query "[0].id" -o tsv)
az ad sp create --id $SPA_APP_ID
az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$SPA_OBJ_ID" \
  --headers "Content-Type=application/json" \
  --body "{\"spa\":{\"redirectUris\":[\"$APP_URL\",\"http://localhost:5173\"]}}"
echo "SPA client id: $SPA_APP_ID"
```
- **The redirect URIs must be type "Single-page application"** (that's what `spa` means). The `web` type fails sign-in with a CORS error.
- They have **no trailing slash**, because the app sends its bare origin (`https://….azurewebsites.net`).
- `http://localhost:5173` lets Ben test real sign-in from his laptop.
- **Check:** **QuoteFlow-SPA → Authentication** lists both URIs under **Single-page application**.

### A7. [IT] Let the SPA call the API, and grant consent

1. **Pre-authorize the SPA on the API.** Users then never see a consent prompt for QuoteFlow:
   ```bash
   SCOPE_ID=$(az ad app show --id $API_APP_ID --query "api.oauth2PermissionScopes[?value=='access_as_user'].id | [0]" -o tsv)
   echo "scope=$SCOPE_ID"
   az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$API_OBJ_ID" \
     --headers "Content-Type=application/json" \
     --body "{\"api\":{\"preAuthorizedApplications\":[{\"appId\":\"$SPA_APP_ID\",\"delegatedPermissionIds\":[\"$SCOPE_ID\"]}]}}"
   ```
   Graph v1.0 calls the list `delegatedPermissionIds`; `permissionIds` is the old manifest name and is refused. *Portal alternative:* **QuoteFlow-API → Expose an API → Add a client application** → paste the SPA client id → tick the scope → **Add application**.
   **Check:** **QuoteFlow-API → Expose an API → Authorized client applications** lists the SPA's client id.
2. **[IT] Portal: add the permissions and grant admin consent.** Go to **App registrations → QuoteFlow-SPA → API permissions**.
   - **Add a permission → APIs my organization uses** (or **My APIs**) → **QuoteFlow-API** → **Delegated** → tick `access_as_user` → **Add permissions**.
   - Check that **Microsoft Graph → User.Read** is listed. If not: **Add a permission → Microsoft Graph → Delegated** → tick `openid`, `profile`, `offline_access`, `User.Read` → **Add permissions**.
   - Select **Grant admin consent for <Pretium>** → **Yes**.

   **Check:** every row shows a green tick, **Granted for <Pretium>**.

### A8. [IT] Groups, role assignments, and Ben's access

1. **Create the groups** (skip any that already exist) and **assign each to its role**:
   ```bash
   API_SP_ID=$(az ad sp show --id $API_APP_ID --query id -o tsv)
   for R in KAM SalesLeader EngLead Engineer Pricing PricingLead Approver Leadership Admin; do
     G="SG-CCQ-$R"
     GID=$(az ad group show --group "$G" --query id -o tsv 2>/dev/null) || GID=""
     [ -z "$GID" ] && GID=$(az ad group create --display-name "$G" --mail-nickname "$G" --query id -o tsv)
     ROLE_ID=$(az ad app show --id $API_APP_ID --query "appRoles[?value=='CCQ.$R'].id | [0]" -o tsv)
     az rest --method POST --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$API_SP_ID/appRoleAssignedTo" \
       --headers "Content-Type=application/json" \
       --body "{\"principalId\":\"$GID\",\"resourceId\":\"$API_SP_ID\",\"appRoleId\":\"$ROLE_ID\"}" > /dev/null \
       && echo "$G -> CCQ.$R assigned"
   done
   ```
   **Check:** **Enterprise applications → QuoteFlow-API → Users and groups** shows nine groups, each with its role.
   - **If the tenant has no Entra ID P1/P2:** the POST fails for groups. Assign **people** directly instead: **Users and groups → Add user/group** → pick the user → pick the role → **Assign**.
   - **Nested groups don't work.** Only *direct* members of an `SG-CCQ-*` group get the role.
2. **Put Ben in the groups he needs for testing.** One person can hold several roles, and the app shows role tabs. Admin is required; the others let him demo each screen.
   ```bash
   for R in Admin KAM SalesLeader EngLead Pricing PricingLead Approver Leadership; do
     az ad group member add --group "SG-CCQ-$R" --member-id $DEV_OID 2>/dev/null; echo "added to SG-CCQ-$R"
   done
   ```
   Ben is **not** added to `SG-CCQ-Engineer` on purpose: an Engineer can't see commercial numbers, and holding that role alongside the others would hide nothing but makes testing confusing. Add him if he needs to test the Engineer view.
3. **Make Ben an owner** of both registrations and the API's enterprise app. He can then add redirect URIs and assign UAT testers himself, without a ticket.
   ```bash
   az ad app owner add --id $API_APP_ID --owner-object-id $DEV_OID
   az ad app owner add --id $SPA_APP_ID --owner-object-id $DEV_OID
   az rest --method POST --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$API_SP_ID/owners/\$ref" \
     --headers "Content-Type=application/json" \
     --body "{\"@odata.id\":\"https://graph.microsoft.com/v1.0/directoryObjects/$DEV_OID\"}"
   ```
   **Check:** **Owners** on each lists Ben. "Already exists" errors are fine.

### A9. [IT → Dev] Hand over these three values (not secrets)

```bash
echo "ENTRA_TENANT_ID=$TENANT_ID"; echo "ENTRA_API_CLIENT_ID=$API_APP_ID"; echo "ENTRA_SPA_CLIENT_ID=$SPA_APP_ID"
```
Keep Tab 1 open: Part B step B6 uses these variables. If the tab was lost, set them again by hand.

---

## Part B. Azure: host the app [IT]

What this creates in `rg-ccq-test`:

| Resource | What it's for |
|---|---|
| PostgreSQL Flexible Server 16 (Burstable B1ms) | The app database |
| App Service plan (Linux B1) + web app (Node 22) | Runs the API, which also serves the web pages |
| Key Vault | Holds the database connection string. Later also the Salesforce key. |
| Storage account (private container) | Attachments until SharePoint is granted (M7) |
| Log Analytics + Application Insights | Monitoring (wired into the code later, B-21) |
| User-assigned identity `id-quoteflow-deploy` | Lets GitHub Actions deploy with no stored password (OIDC) |

### B1. [IT] Variables, providers, resource group (Tab 2)

Use the same suffix and web app name as Part A.

```bash
SUB_ID=$(az account show --query id -o tsv)      # check it's the right subscription: az account show -o table
RG=rg-ccq-test; LOC=centralus; SFX=<4 letters>
WEBAPP=<web app name from 0.3>
PLAN=asp-quoteflow-test; PG=psql-quoteflow-test-$SFX; KV=kv-quoteflow-test-$SFX
ST=stquoteflowtest$SFX; LAW=log-quoteflow-test; APPI=appi-quoteflow-test
DEV_UPN=<Ben's sign-in email>
DEV_OID=$(az ad user show --id "$DEV_UPN" --query id -o tsv)
GH_REPO=BenWhannPretium/QuoteFlow-CCQ-App-       # owner/repo exactly as on GitHub (case matters)

for ns in Microsoft.Web Microsoft.DBforPostgreSQL Microsoft.KeyVault Microsoft.Storage Microsoft.Insights Microsoft.OperationalInsights Microsoft.ManagedIdentity; do
  az provider register --namespace $ns
done
az group create --name $RG --location $LOC -o table
```
**Check:** the resource group shows `Succeeded`. Provider registration continues in the background.

### B2. [IT] PostgreSQL. **Start this first.** It takes 5–10 minutes.

```bash
PG_ADMIN=ccqadmin
PG_PASSWORD=$(openssl rand -hex 24)        # hex: safe inside a connection string, no escaping
az postgres flexible-server create --resource-group $RG --name $PG --location $LOC \
  --version 16 --tier Burstable --sku-name Standard_B1ms --storage-size 32 \
  --admin-user $PG_ADMIN --admin-password "$PG_PASSWORD" \
  --public-access 0.0.0.0 --yes
```
- **Leave this tab running and go to Part A in Tab 1.** Come back when it finishes.
- `--public-access 0.0.0.0` turns on **"Allow public access from any Azure service"**, so the web app can reach it. Learn notes this rule admits any Azure subscription, not only Pretium's. That's accepted for the **test** environment: there's a 48-character random password and TLS is required. Production moves to a private endpoint (M8).
- **Don't close Tab 2 before B4.** `$PG_PASSWORD` exists only in this shell, and B4 stores it in Key Vault. If you lose it, reset it with `az postgres flexible-server update -g $RG -n $PG --admin-password <new>`.

When it finishes:

```bash
az postgres flexible-server parameter set --resource-group $RG --server-name $PG \
  --name azure.extensions --value "pg_trgm,pgcrypto"
az postgres flexible-server db create --resource-group $RG --server-name $PG --name ccq
```
- **Why:** QuoteFlow's migrations need the `pg_trgm` (search) and `pgcrypto` extensions, and Azure only allows extensions on its allow-list.
- **Check:** portal → the server → **Server parameters** → `azure.extensions` shows both. **Databases** lists `ccq`. **Don't skip the `db create` line:** without it the app starts, signs in to Postgres and then stops with `database preparation failed (3D000)` (this happened on the first deploy). **Networking** shows "Allow public access from any Azure service" ticked.
- The admin login is **not** a superuser on Azure. The app handles this itself when it starts (it grants its login the `ccq_app` and `ccq_migrator` roles). Nobody needs to run SQL by hand.

### B3. [IT] Monitoring

```bash
az monitor log-analytics workspace create --resource-group $RG --workspace-name $LAW --location $LOC -o none
az monitor app-insights component create --app $APPI --location $LOC --resource-group $RG \
  --workspace $LAW --application-type web -o none
APPI_CS=$(az monitor app-insights component show --app $APPI -g $RG --query connectionString -o tsv)
```
If the CLI asks to install the `application-insights` extension, answer **Y**.

### B4. [IT] Key Vault, with the database connection string as a secret

```bash
az keyvault create --name $KV --resource-group $RG --location $LOC --enable-rbac-authorization true -o none
KV_ID=$(az keyvault show --name $KV --query id -o tsv)
ME=$(az ad signed-in-user show --query id -o tsv)
az role assignment create --role "Key Vault Secrets Officer" --assignee-object-id $ME  --assignee-principal-type User --scope $KV_ID -o none
az role assignment create --role "Key Vault Secrets Officer" --assignee-object-id $DEV_OID --assignee-principal-type User --scope $KV_ID -o none
DATABASE_URL="postgres://$PG_ADMIN:$PG_PASSWORD@$PG.postgres.database.azure.com:5432/ccq?sslmode=verify-full"
az keyvault secret set --vault-name $KV --name database-url --value "$DATABASE_URL" -o none && echo "secret stored"
```
- With RBAC, even a subscription Owner can't write a secret until they hold **Key Vault Secrets Officer** on the vault. That's why we grant it first.
- **If the secret command says `Forbidden`:** role assignments can take a few minutes to apply. Wait one minute and run the last line again.
- `sslmode=verify-full` means encrypted **and** the server certificate is checked.

### B5. [IT] Storage for attachments (until SharePoint, M7)

```bash
az storage account create --name $ST --resource-group $RG --location $LOC --sku Standard_LRS --kind StorageV2 \
  --allow-blob-public-access false --min-tls-version TLS1_2 -o none
az storage container-rm create --storage-account $ST --name attachments --resource-group $RG -o none
```
- The test app runs in production mode, which refuses to store files on the web server's disk.
- The container is private. The app gives each download a short-lived link.

### B6. [IT] The web app

You need `$TENANT_ID`, `$API_APP_ID` and `$SPA_APP_ID` from **A9**. Paste them here (or run this step in Tab 1):

```bash
TENANT_ID=<from A9>; API_APP_ID=<from A9>; SPA_APP_ID=<from A9>

az appservice plan create --name $PLAN --resource-group $RG --location $LOC --is-linux --sku B1 -o none
az webapp list-runtimes --os linux | grep -i node      # confirm NODE:22-lts is listed
az webapp create --name $WEBAPP --resource-group $RG --plan $PLAN --runtime "NODE:22-lts" \
  --assign-identity "[system]" -o none
az webapp update --name $WEBAPP --resource-group $RG --https-only true -o none
az webapp config set --name $WEBAPP --resource-group $RG \
  --startup-file "node apps/api/dist/azureStart.js" --always-on true --ftps-state Disabled \
  --min-tls-version 1.2 --http20-enabled true -o none
az webapp config set --name $WEBAPP --resource-group $RG --generic-configurations healthCheckPath=/api/v1/health -o none
```

Then the app settings. These are the app's configuration. None of them is a secret except `DATABASE_URL`, which points at Key Vault.

```bash
az webapp config appsettings set --name $WEBAPP --resource-group $RG -o none --settings \
  NODE_ENV=production \
  SCM_DO_BUILD_DURING_DEPLOYMENT=false \
  AUTH_MODE=entra \
  ENTRA_TENANT_ID=$TENANT_ID \
  ENTRA_API_CLIENT_ID=$API_APP_ID \
  ENTRA_API_AUDIENCE=api://$API_APP_ID \
  ENTRA_SPA_CLIENT_ID=$SPA_APP_ID \
  ENTRA_API_SCOPE=access_as_user \
  APP_BASE_URL=https://$WEBAPP.azurewebsites.net \
  "DATABASE_URL=@Microsoft.KeyVault(SecretUri=https://$KV.vault.azure.net/secrets/database-url/)" \
  FILESTORE_MODE=blob \
  BLOB_ACCOUNT_URL=https://$ST.blob.core.windows.net \
  BLOB_CONTAINER=attachments \
  MAIL_MODE=graph \
  NOTIFICATION_DISPATCH_INTERVAL_SECONDS=0 \
  SF_MODE=fake \
  PRICING_MODE=fake \
  SEED_SYNTHETIC_DATA=true \
  "APPLICATIONINSIGHTS_CONNECTION_STRING=$APPI_CS"
```

What the less obvious ones mean:
- `NODE_ENV=production`: the real production build path. It serves the web pages, refuses dev sign-in and refuses local files.
- `SCM_DO_BUILD_DURING_DEPLOYMENT=false`: GitHub builds the app. Azure must not try to rebuild it.
- `MAIL_MODE=graph` + `NOTIFICATION_DISPATCH_INTERVAL_SECONDS=0`: email is switched **off** until the mailbox exists (M7). In-app notifications still work.
- `SF_MODE=fake`, `PRICING_MODE=fake`, `SEED_SYNTHETIC_DATA=true`: **synthetic data only** until Salesforce (M3) and the production-data approval. Never set `SEED_SYNTHETIC_DATA` on production.
- `APPLICATIONINSIGHTS_CONNECTION_STRING`: kept ready. Telemetry from the code arrives with B-21; until then logs are in **Log stream**.

**Check:** web app → **Settings → Environment variables**: after the identity is granted in B7, `DATABASE_URL` shows a **green tick** (Key Vault reference resolved).

### B7. [IT] Give the web app's identity access to Key Vault and storage

```bash
APP_MI=$(az webapp identity show --name $WEBAPP --resource-group $RG --query principalId -o tsv)
ST_ID=$(az storage account show --name $ST --resource-group $RG --query id -o tsv)
az role assignment create --role "Key Vault Secrets User" --assignee-object-id $APP_MI --assignee-principal-type ServicePrincipal --scope $KV_ID -o none
az role assignment create --role "Storage Blob Data Contributor" --assignee-object-id $APP_MI --assignee-principal-type ServicePrincipal --scope $ST_ID -o none
az webapp log config --name $WEBAPP --resource-group $RG --docker-container-logging filesystem -o none
az webapp restart --name $WEBAPP --resource-group $RG
```
**Check:** **Environment variables → DATABASE_URL** shows **Key vault Reference** with a green tick. If it's red, wait two minutes and restart again; role assignments take a moment.

Until the first deploy (Part C) the site shows the default App Service page or a start-up error. That's expected.

### B8. [IT] The GitHub deploy identity (OIDC, no stored secrets)

```bash
az identity create --name id-quoteflow-deploy --resource-group $RG --location $LOC -o none
DEPLOY_CLIENT_ID=$(az identity show --name id-quoteflow-deploy -g $RG --query clientId -o tsv)
DEPLOY_PRINCIPAL=$(az identity show --name id-quoteflow-deploy -g $RG --query principalId -o tsv)
az identity federated-credential create --name github-test-env --identity-name id-quoteflow-deploy --resource-group $RG \
  --issuer "https://token.actions.githubusercontent.com" \
  --subject "repo:$GH_REPO:environment:test" \
  --audiences "api://AzureADTokenExchange"
# GitHub's immutable subject format (owner and repo ids). This repo presents this one; see the note below.
az identity federated-credential create --name github-test-env-v2 --identity-name id-quoteflow-deploy --resource-group $RG \
  --issuer "https://token.actions.githubusercontent.com" \
  --subject "repo:BenWhannPretium@343131032/QuoteFlow-CCQ-App-@1421100339:environment:test" \
  --audiences "api://AzureADTokenExchange"
WEBAPP_ID=$(az webapp show --name $WEBAPP --resource-group $RG --query id -o tsv)
az role assignment create --role "Website Contributor" --assignee-object-id $DEPLOY_PRINCIPAL \
  --assignee-principal-type ServicePrincipal --scope $WEBAPP_ID -o none
```
- **How it works:** GitHub proves to Azure that "this job runs in repo `BenWhannPretium/QuoteFlow-CCQ-App-`, environment `test`". Azure then lets that job, and only that job, deploy to **this one web app**.
- The **subject must match exactly**: owner and repo name with the same capitals, and no trailing slash on the issuer.
- **GitHub may send the immutable subject format** `repo:<owner>@<owner id>/<repo>@<repo id>:environment:test` instead of `repo:<owner>/<repo>:environment:test`. This repo does (found on the first deploy, 2026-10-21), so B8 creates both. For any other repo, run the first deploy, and if `azure/login` fails with AADSTS700213, copy the subject from the error message into a new credential.
- **If the repo moves to the Pretium GitHub org** (B-00), add a credential with the new name **and** the new ids (take the subject from the AADSTS700213 error).
- **Check:** **Managed Identities → id-quoteflow-deploy → Federated credentials** shows `github-test-env` and `github-test-env-v2`.

### B9. [IT] Ben's Azure access

```bash
RG_ID=$(az group show --name $RG --query id -o tsv)
az role assignment create --role "Reader"              --assignee-object-id $DEV_OID --assignee-principal-type User --scope $RG_ID -o none
az role assignment create --role "Website Contributor" --assignee-object-id $DEV_OID --assignee-principal-type User --scope $RG_ID -o none
az role assignment create --role "Monitoring Reader"   --assignee-object-id $DEV_OID --assignee-principal-type User --scope $RG_ID -o none
az role assignment create --role "Log Analytics Reader" --assignee-object-id $DEV_OID --assignee-principal-type User --scope $RG_ID -o none
```
Key Vault Secrets Officer was already granted in B4. §4 explains each grant.

### B10. [IT → Dev] Hand over

```bash
echo "AZURE_CLIENT_ID=$DEPLOY_CLIENT_ID"; echo "AZURE_TENANT_ID=$(az account show --query tenantId -o tsv)"
echo "AZURE_SUBSCRIPTION_ID=$SUB_ID"; echo "AZURE_RESOURCE_GROUP=$RG"; echo "AZURE_WEBAPP_NAME=$WEBAPP"
```
These are identifiers, not secrets.

---

## Part C. First deploy and sign-in [Dev]

### C1. [Dev] Add the GitHub variables

GitHub → repo → **Settings → Secrets and variables → Actions → Variables tab → New repository variable**. Add the five values from B10 with exactly these names:

| Name | Value |
|---|---|
| `AZURE_CLIENT_ID` | the deploy identity's client id |
| `AZURE_TENANT_ID` | tenant id |
| `AZURE_SUBSCRIPTION_ID` | subscription id |
| `AZURE_RESOURCE_GROUP` | `rg-ccq-test` |
| `AZURE_WEBAPP_NAME` | the web app name |

Use **Variables**, not **Secrets**: the workflow reads `vars.*`. The GitHub environment `test` is created automatically on the first run.

### C2. [Dev] Run the first deploy

1. GitHub → **Actions → Deploy (test) → Run workflow** (branch `main`) → **Run workflow**.
2. It installs, builds, packages, signs in to Azure with OIDC, deploys, then polls `/api/v1/health` for up to 5 minutes. It takes about 6–10 minutes.
3. While it runs, watch the app start in the portal: web app → **Monitoring → Log stream**. A good start shows these lines in order:
   - `[quoteflow-start] migrations applied`
   - `[quoteflow-start] config seeded (+ synthetic data)`
   - `Server listening at …`
4. **Check:** the job ends green with `healthy on <commit>: {"status":"ok","version":"<commit>",…,"db":"up"}`. The smoke test waits for **this** commit, because the old container keeps serving until the new one starts.

### C3. [Dev] Sign in

1. Open `https://<web app>.azurewebsites.net` in a private window → **Sign in** → your Pretium account.
2. You land on your role dashboard. The role tabs should show every group IT added you to.
3. Open **Admin**. If it loads, the `CCQ.Admin` role is working end to end.
4. **Negative test** (if a colleague is free): someone **not** in any `SG-CCQ-*` group should be refused at sign-in. "Assignment required" stops them before they reach the app.

**If something fails, see §5.** Most first-run problems are a typo in one app setting.

---

## Part D. Closing Phase 1 today [Dev]

### D1. Tick these off once C3 passes

In `05-path-to-mvp.md`:
- **Step 2 (M2):** every box, and "B-20 first deploy".
- **Step 1 (M1):** Oliver's approval covers **"Azure hosting approved"** and **"IT person who provisions it"**. The other three Step 1 items were not part of today's approval. Ask Oliver for each **by email today**; a one-line answer each is enough:
  - [ ] **Production-data path** (D-23), including the ~205 live SF records in Bailey's prototype: purge, or approve?
  - [ ] **Support model in principle** (D-17): "EI builds, IT hosts and supports"?
  - [ ] **Access pattern** (D-H2): is a public `*.azurewebsites.net` URL with Entra sign-in OK for **test**? (Production pattern decided at M8.)

In `03-build-steps.md`:
- **B-04:** tick "MSAL sign-in works against Entra". Note the tenant and the date.
- **B-20:** tick "`deploy.yml` deploys `main` to test via OIDC", "the DB migrates on deploy" and "smoke test passes against the test URL". **Leave the Bicep box open** and note the deviation: the test environment was built with the CLI script in this runbook, and Bicep (for prod, with a private endpoint and VNet) is still to do before B-22.

### D2. Record the values (not secrets) in `03` under B-20

Web app URL, resource group, tenant id, the API and SPA client ids, the deploy identity client id. **Never** the database password; it lives only in Key Vault.

### D3. Tell people
- Post the test URL to Bailey and Tre.
- The UAT cohort gets access later through the `SG-CCQ-*` groups (M9). Ben, as owner of the enterprise app, can now add test users himself.

---

## Part E. Deploying updates from now on [Dev]

**Normal path: nothing to do.** Every merge to `main` runs CI. When CI passes, **Deploy (test)** builds the same commit and deploys it. The site restarts, applies any new migrations and config seeds, and the job checks health.

| I want to… | Do this |
|---|---|
| Ship a change | Merge the PR to `main`. Watch **Actions → Deploy (test)**. |
| Re-deploy without a code change | **Actions → Deploy (test) → Run workflow**. |
| Roll back | Revert the bad commit on `main` (a revert PR). CI then deploys the reverted code. Migrations don't roll back automatically, so write a new migration if a schema change has to be undone. |
| See logs | Portal → web app → **Log stream**, or locally `az webapp log tail -n <webapp> -g rg-ccq-test`. |
| Change a setting (e.g. switch Salesforce live) | Portal → web app → **Environment variables** → edit → **Apply** (the app restarts). Put secrets such as `SF_CLIENT_SECRET` in Key Vault and reference them as in B6. |
| Connect Salesforce (client credentials) | In Cloud Shell: `read -rsp "Secret: " S; az keyvault secret set --vault-name $KV --name sf-client-secret --value "$S" -o none; unset S`. Then set `SF_MODE=live`, `SF_AUTH_FLOW=client_credentials`, `SF_LOGIN_URL=https://pretiumpkg.my.salesforce.com`, `SF_CLIENT_ID=<consumer key>` and `SF_CLIENT_SECRET=@Microsoft.KeyVault(SecretUri=https://$KV.vault.azure.net/secrets/sf-client-secret/)`. Check the green tick, then **Admin → Integrations → Sync now**. |
| Backfill after a Salesforce field-map change | **Admin → Integrations → Full re-sync** (confirm). It re-reads every opportunity and rewrites each copy, even ones Salesforce hasn't changed, so a newly mapped field fills in. About a minute for ~32,000 records; read-only toward Salesforce. |
| Restart | Portal → web app → **Restart**, or `az webapp restart -n <webapp> -g rg-ccq-test`. |
| Add a sign-in URL (e.g. a prod or custom domain) | **App registrations → QuoteFlow-SPA → Authentication → Add Redirect URI → Single-page application**. Ben can do this as owner. |
| Give a tester a role | Add them to the right `SG-CCQ-*` group (IT, or the group's owner). They sign out and back in to pick it up. |

**Local tools (optional).** Install the Azure CLI, then `az login`. With the B9 roles you can tail logs, restart, and change settings. You can't change role assignments or Entra; that stays with IT.

---

## 4. Permissions for developers (and why)

| Where | Grant | Lets the dev… | Who grants it |
|---|---|---|---|
| Entra: QuoteFlow-API and QuoteFlow-SPA app registrations | **Owner** | Edit redirect URIs, roles and scopes on these two apps only | IT (A8.3) |
| Entra: QuoteFlow-API **enterprise app** | **Owner** | Assign users and groups to CCQ roles for testing and UAT | IT (A8.3) |
| Entra groups | Membership of `SG-CCQ-Admin` (+ other roles to test) | Sign in with those roles | IT (A8.2) |
| Azure `rg-ccq-test` | **Reader** | See every resource | IT (B9) |
| Azure `rg-ccq-test` | **Website Contributor** | Restart, change app settings, read the log stream, deploy by hand | IT (B9) |
| Azure `rg-ccq-test` | **Monitoring Reader** + **Log Analytics Reader** | Query logs, Application Insights and metrics | IT (B9) |
| Key Vault `kv-quoteflow-test-*` | **Key Vault Secrets Officer** | Add or rotate secrets (Salesforce key, pricing password) | IT (B4) |
| GitHub repo | **Admin** | Add Actions variables and environments | Repo owner |
| **Not needed** | Subscription Owner/Contributor, Global Admin, Application Administrator, User Access Administrator | — | — |

Notes:
- **Postgres:** the dev doesn't need direct database access, because migrations and seeds run when the app starts. To connect with `psql` for troubleshooting, IT adds a firewall rule for the dev's IP (`az postgres flexible-server firewall-rule create …`); the password is in Key Vault. Keep this rare and remove the rule after.
- **Production** (B-22) gets a separate resource group. Devs get **Reader** there, and deploys need an approval (a GitHub environment protection rule on `production`).

---

## 5. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Sign-in page: **AADSTS50011** redirect URI mismatch | The SPA redirect URI differs from the site URL (trailing slash, http vs https, wrong name) | A6: the URI must be exactly `https://<webapp>.azurewebsites.net`, type **Single-page application** |
| Sign-in: "your administrator has not granted…" or "user not assigned" | User not in an `SG-CCQ-*` group (assignment required), or consent not granted | A8 membership. A7 step 2 **Grant admin consent**. Sign out fully and retry. |
| App says **no CCQ role** (403) after sign-in | The token has no `CCQ.*` role: user isn't a direct member of an assigned group, or the role value is misspelled | Check **Enterprise applications → QuoteFlow-API → Users and groups**. Check the app role values (A4). Sign out and in. |
| Every API call is 401 | `ENTRA_*` setting typo, or the API doesn't issue v2 tokens | Compare B6 settings with A9. `requestedAccessTokenVersion` must be `2` (A2). |
| Log stream: `refusing to start … Invalid configuration` | A missing or invalid app setting; the message names it | Fix that setting in **Environment variables** |
| Log stream: `DATABASE_URL is not a postgres:// URL`, or the setting shows a red cross | The Key Vault reference didn't resolve | B7 role assignment, wait 2 minutes, restart. Check the secret name `database-url`. |
| Log stream: `database preparation failed (28P01)` | Wrong password in the secret | Reset the password (B2 note) and update the secret (B4), then restart |
| Log stream: `database preparation failed (3D000)` | The `ccq` database doesn't exist (the B2 `db create` line was skipped) | Portal → the Postgres server → **Databases → + Add** → `ccq`. The app retries on its own every few minutes, or restart it. |
| Log stream: `database preparation failed (…)` with another code, before `migrations applied` | Usually `azure.extensions` not set (B2), the `ccq` database missing, or the server not reachable | Check B2 (parameter + database) and **Networking → Allow Azure services**, then restart |
| Log stream: TLS / certificate error to Postgres | The certificate check failed | Temporarily change `sslmode=verify-full` to `sslmode=require` in the secret and tell Ben (it's still encrypted) |
| Deploy job: `azure/login` fails with **AADSTS700213 / No matching federated identity record** | The subject doesn't match | The error shows the subject GitHub sent. Add a federated credential with exactly that subject (B8). For this repo it is `repo:BenWhannPretium@343131032/QuoteFlow-CCQ-App-@1421100339:environment:test` |
| Deploy job: `AuthorizationFailed` on deploy | The deploy identity lacks the role | B8 Website Contributor on the **web app**. Allow 2 minutes after granting. |
| Deploy job skipped | GitHub variables missing | C1 (the job runs only once `AZURE_WEBAPP_NAME` exists) |
| Health check times out but the logs look fine | First start of a cold B1 plan | Re-run the workflow. Check **Log stream** for `Server listening`. |
| Log stream: `Cannot find module '/home/site/wwwroot/apps/api/dist/azureStart.js'` | Normal **before the first deploy**: the site is empty | Ignore lines older than the deploy. After a deploy, it means the package didn't land: re-run the workflow. |
| Smoke test keeps printing `waiting for <sha>` while `/api/v1/health` answers with another `version` | The old container is still serving: the new one hasn't started yet (each start spends about 1½ minutes on certificates and unpacking `node_modules`) or it crashed | Read **Log stream** for the new start. It needs `Server listening`; a `refusing to start` line names the problem. |
| Deploy step: "site failed to start within 10 mins", but **Log stream** shows the new container `Server listening` | Azure's start tracker misread a site that was crash-looping before the deploy (seen once, 2026-10-21, right after the `3D000` fix) | Re-run the workflow once the site is stable. |

---

## 6. Deviations from the plan (record in `03` under B-20)

1. **The test environment is built with this CLI runbook, not Bicep.** It's faster to do live with IT. Bicep for production (private endpoint, VNet, staging slot) is still open in B-20.
2. **Postgres uses public access with "Allow Azure services"** in test. Production uses a private endpoint (M8 decision).
3. **The app connects as the Postgres admin login.** It switches to the `ccq_app` role for every request (RLS applies), but a separate low-privilege login is a B-21 hardening item.
4. **Attachments go to Blob storage, and email dispatch is off**, until SharePoint and the mailbox are granted (M7).
5. **Application Insights exists, but the code doesn't send telemetry yet** (B-21). Logs come from App Service.

## Sources (Microsoft Learn, read 2026-10-19)

- Register an app: https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app
- Expose a web API (scopes, authorized clients): https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-configure-app-expose-web-apis
- App manifest (Microsoft Graph format; `api.requestedAccessTokenVersion`, `spa.redirectUris`, `preAuthorizedApplications`): https://learn.microsoft.com/en-us/entra/identity-platform/reference-microsoft-graph-app-manifest
- App roles and the roles claim: https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps
- Assign users and groups (P1/P2 for groups, no nesting): https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/assign-user-or-group-access-portal
- Service principals are separate when created by CLI or Graph: https://learn.microsoft.com/en-us/entra/identity-platform/app-objects-and-service-principals
- Access token claims (v2 `aud` = API client id, `iss` …/v2.0): https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference
- SPA redirect URIs: https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri
- Admin roles for app tasks: https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/delegate-app-roles
- `az ad app`: https://learn.microsoft.com/en-us/cli/azure/ad/app
- Deploy to App Service with GitHub Actions (OIDC, Website Contributor): https://learn.microsoft.com/en-us/azure/app-service/deploy-github-actions
- Federated credential on a user-assigned identity: https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-create-trust-user-assigned-managed-identity
- Node on App Service Linux (`PORT`, startup command): https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs?pivots=platform-linux
- Zip deploy (no build by default; 2 GB limit): https://learn.microsoft.com/en-us/azure/app-service/deploy-zip
- Health check: https://learn.microsoft.com/en-us/azure/app-service/monitor-instances-health-check
- Key Vault references in app settings: https://learn.microsoft.com/en-us/azure/app-service/app-service-key-vault-references
- PostgreSQL Flexible Server create, firewall, extensions: https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/quickstart-create-server · https://learn.microsoft.com/en-us/azure/postgresql/extensions/how-to-allow-extensions
- PostgreSQL admin is not a superuser: https://learn.microsoft.com/en-us/azure/postgresql/security/security-manage-database-users
- Website Contributor role: https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/web-and-mobile#website-contributor
