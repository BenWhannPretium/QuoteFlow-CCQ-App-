// rg-ccq-prod (B-22). Nothing exists yet. Names follow the runbook's pattern and must be globally
// unique: confirm with IT (naming standard) before the first apply. Every '<confirm: ...>' is a
// deliberately invalid value ARM refuses until it is replaced.
// The Postgres admin password is NOT here: pass it on the command line on the create only
// (`postgresAdminPassword=$(openssl rand -hex 24)`), then store the connection string in Key Vault.
using './main.bicep'

param environmentName = 'prod'
param location = 'centralus'
param tags = {
  // costCenter: '<ask IT>'
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

param appServicePlanSku = 'P1v3'
param enableStagingSlot = true

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
param sfClientId = '<confirm: SF_CLIENT_ID>'
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
// Developers get Reader only in prod (06 §4). Fill object ids (e.g. Ben's) before the apply.
param developerObjectIds = []
param developerRgRoles = ['Reader']
param developersAreKeyVaultOfficers = false
