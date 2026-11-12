// rg-ccq-prod (B-22). IT created the group on 2026-11-12; this file was first applied the same day.
// Names follow test's pattern ('prod' for 'test', suffix 'ptpk'); all were free when checked.
// The Postgres admin password is NOT here: pass it on the command line on the create only
// (`postgresAdminPassword=$(openssl rand -hex 24)`), then store the connection string in Key Vault.
using './main.bicep'

param environmentName = 'prod'
param location = 'centralus'
param tags = {
  // costCenter: '<ask IT>' (IT left it blank on the resource group; add it here and re-apply, no downtime)
}

param webAppName = 'quoteflow-prod'
param appServicePlanName = 'asp-quoteflow-prod'
param postgresServerName = 'psql-quoteflow-prod-ptpk'
param keyVaultName = 'kv-quoteflow-prod-ptpk'
param storageAccountName = 'stquoteflowprodptpk'
param logAnalyticsName = 'log-quoteflow-prod'
param appInsightsName = 'appi-quoteflow-prod'
param deployIdentityName = 'id-quoteflow-deploy-prod'

// Prod network posture (Ben, 2026-11-12): the same as test. No VNet and no private endpoints: Postgres,
// Key Vault and Blob keep public endpoints, protected by their credentials, TLS and Entra/RBAC
// (Postgres also has the "Allow Azure services" rule). Fabric connects directly, so no VNet data
// gateway is needed either. To go private later, set deployNetwork = true and restore the subnet
// prefixes (the module defaults in main.bicep apply: 10.60.0.0/24), then follow infra/README.md.
param deployNetwork = false
// D-H2: 'public' = option 1 (public URL, Entra sign-in; Ben, 2026-11-12).
param exposure = 'public'

// Target: P1v3 + staging slot. Interim B1, no slot (Ben, 2026-11-12): the subscription's App Service
// quota in Central US is 0 for every tier above B1 (P1v3, P0v3, S1, P1v2: SubscriptionIsOverQuotaForSku
// on the first apply). When IT raises P1v3 (Quotas, provider App Service, Central US), restore P1v3 and
// enableStagingSlot = true and re-apply: an in-place scale-up with a brief restart.
param appServicePlanSku = 'B1'
param enableStagingSlot = false

param postgresSkuName = 'Standard_D2ds_v5'
param postgresSkuTier = 'GeneralPurpose'
param postgresStorageSizeGB = 32
param postgresBackupRetentionDays = 35
param postgresAdminLogin = 'ccqadmin'
param postgresEntraAdmins = []

param keyVaultPurgeProtection = true

// Same app registrations as test (decided 2026-11-02; add the prod URL as an SPA redirect URI). Prod
// honours only CCQ.* roles; test honours CCQ.Test.* (runbook A8a), so test grants never reach prod.
param entraApiClientId = 'ad1e0bca-1df0-476d-84a2-1af5840b9569' // gitleaks:allow (public Entra client id)
param entraSpaClientId = '033b5ed1-f56f-48c7-9c74-83089f6b311f' // gitleaks:allow (public Entra client id)
param entraRolePrefix = 'CCQ.'

// Blob until SharePoint is granted (M7); then 'sharepoint' with the site and drive ids.
param filestoreMode = 'blob'
// Email stays off until the shared mailbox exists (M7); then e.g. 60.
param notificationDispatchIntervalSeconds = 0

param sfMode = 'live'
param sfAuthFlow = 'client_credentials'
param sfLoginUrl = 'https://pretiumpkg.my.salesforce.com'
// The same connected app as test (Ben, 2026-11-12): same org, so the same consumer key; the secret goes in
// the prod vault as 'sf-client-secret'.
param sfClientId = '3MVG9WQsPp5nH_EpyovYhv7bEyY7Cr3g1GW4jMg747LVlaX1o_oszK.Np_bUA5wUgEqOe1lseDy9DFa5CKa3z' // gitleaks:allow (connected-app consumer key, an identifier; the secret is in Key Vault)
param sfClientSecretName = 'sf-client-secret'

param fabricWorkspaceId = ''
param fabricMirroredDbId = ''

// B-21 health alerts (infra/README.md "Alerts"). Prod: IT's on-call or shared mailbox (confirm with IT). Empty = rules fire into the portal only.
param alertEmails = []

param githubSubjects = [
  {
    name: 'github-production-env'
    subject: 'repo:BenWhannPretium/QuoteFlow-CCQ-App-:environment:production'
  }
  {
    name: 'github-production-env-v2'
    subject: 'repo:BenWhannPretium@343131032/QuoteFlow-CCQ-App-@1421100339:environment:production'
  }
]

param manageRoleAssignments = true
// Ben (2026-11-12): IT made him Owner of rg-ccq-prod, so no RG roles here; he needs Key Vault Secrets
// Officer to set 'database-url' and 'sf-client-secret' (README "What stays manual"). Other developers get
// Reader only in prod (06 §4): add them with developerRgRoles = ['Reader'] and officers off.
param developerObjectIds = ['63ab69fc-8689-4afb-924f-3d8a38b4bca0'] // Ben Whann (Entra object id)
param developerRgRoles = []
param developersAreKeyVaultOfficers = true
