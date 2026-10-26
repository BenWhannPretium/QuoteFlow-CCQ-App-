// rg-ccq-test: the environment runbook 06 built by CLI on 2026-10-21 (values in 03-build-steps.md B-20).
// Every '<confirm: ...>' is a value the runbook left to the session (a 4-letter suffix, a CLI-generated
// name) and the repo doesn't record. They are deliberately invalid resource names, so ARM refuses the
// deployment until IT replaces them with what exists: `az resource list -g rg-ccq-test -o table`.
// No secrets here. Do NOT pass postgresAdminPassword for test: the server exists.
using './main.bicep'

param environmentName = 'test'
param location = 'centralus'
param tags = {
  // costCenter: '<ask IT>'
}

param webAppName = 'quoteflow-test'
param appServicePlanName = 'asp-quoteflow-test'
param postgresServerName = '<confirm: psql-quoteflow-test-xxxx>'
param keyVaultName = '<confirm: kv-quoteflow-test-xxxx>'
param storageAccountName = '<confirm: stquoteflowtestxxxx>'
param logAnalyticsName = 'log-quoteflow-test'
param appInsightsName = 'appi-quoteflow-test'
param deployIdentityName = 'id-quoteflow-deploy'

// Test: public endpoints, "Allow Azure services" on Postgres (06 §6 deviation 2). Fabric connects directly.
param deployNetwork = false
param exposure = 'public'

param appServicePlanSku = 'B1'
param enableStagingSlot = false

// D-FB3 (pending cost approval): B1ms -> General Purpose. Applying this restarts the server.
param postgresSkuName = 'Standard_D2ds_v5'
param postgresSkuTier = 'GeneralPurpose'
param postgresStorageSizeGB = 32
param postgresBackupRetentionDays = 7
param postgresAdminLogin = 'ccqadmin'
param postgresAllowAzureServicesRuleName = '<confirm: az postgres flexible-server firewall-rule list>'
param postgresEntraAdmins = []

param keyVaultPurgeProtection = false

param entraApiClientId = 'ad1e0bca-1df0-476d-84a2-1af5840b9569' // gitleaks:allow (public Entra client id)
param entraSpaClientId = '033b5ed1-f56f-48c7-9c74-83089f6b311f' // gitleaks:allow (public Entra client id)

param filestoreMode = 'blob'
param notificationDispatchIntervalSeconds = 0

// Salesforce live since 2026-10-24 (03 B-06): client credentials against the production org.
param sfMode = 'live'
param sfAuthFlow = 'client_credentials'
param sfLoginUrl = 'https://pretiumpkg.my.salesforce.com'
param sfClientId = '<confirm: SF_CLIENT_ID from the current app settings>'
param sfClientSecretName = 'sf-client-secret'
// The test database was recreated on production data on 2026-10-24: no synthetic seed.
param seedSyntheticData = false

param fabricWorkspaceId = ''
param fabricMirroredDbId = ''

// 06 B8: both subject formats (GitHub sends the immutable one for this repo).
param githubSubjects = [
  {
    name: 'github-test-env'
    subject: 'repo:BenWhannPretium/QuoteFlow-CCQ-App-:environment:test'
  }
  {
    name: 'github-test-env-v2'
    subject: 'repo:BenWhannPretium@343131032/QuoteFlow-CCQ-App-@1421100339:environment:test'
  }
]

// The runbook made these grants by hand under random names; ARM would refuse duplicates. Keep false
// until IT removes them (or for good on test). A rebuild into an empty RG sets it to true.
param manageRoleAssignments = false
param developerObjectIds = []
param developerRgRoles = ['Reader', 'WebsiteContributor', 'MonitoringReader', 'LogAnalyticsReader']
param developersAreKeyVaultOfficers = true
