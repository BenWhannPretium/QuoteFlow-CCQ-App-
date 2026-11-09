// rg-ccq-test: the environment runbook 06 built by CLI on 2026-10-21 (values in 03-build-steps.md B-20).
// The runbook's 4-letter suffix, the CLI-named firewall rule and SF_CLIENT_ID were read from the live
// resources on 2026-11-09 (`az resource list -g rg-ccq-test`, firewall-rule list, appsettings list).
// No secrets here. Do NOT pass postgresAdminPassword for test: the server exists.
using './main.bicep'

param environmentName = 'test'
param location = 'centralus'
param tags = {
  // costCenter: '<ask IT>'
}

param webAppName = 'quoteflow-test'
param appServicePlanName = 'asp-quoteflow-test'
param postgresServerName = 'psql-quoteflow-test-ptpk'
param keyVaultName = 'kv-quoteflow-test-ptpk'
param storageAccountName = 'stquoteflowtestptpk'
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
param postgresAllowAzureServicesRuleName = 'AllowAllAzureServicesAndResourcesWithinAzureIps_2026-10-19_21-53-20'
param postgresEntraAdmins = []

param keyVaultPurgeProtection = false

param entraApiClientId = 'ad1e0bca-1df0-476d-84a2-1af5840b9569' // gitleaks:allow (public Entra client id)
param entraSpaClientId = '033b5ed1-f56f-48c7-9c74-83089f6b311f' // gitleaks:allow (public Entra client id)
// Target 'CCQ.Test.' (runbook A8a). Kept at 'CCQ.' until the CCQ.Test.* roles and SG-CCQ-Test-* groups
// exist and are populated: switching first refuses every test user (403, no CCQ role).
param entraRolePrefix = 'CCQ.'

// Blob, so test's files never land in prod's SharePoint. If test moves to SharePoint, give it its own
// test site or library (sharePointSiteId / sharePointDriveId), never prod's.
param filestoreMode = 'blob'
param notificationDispatchIntervalSeconds = 0
// Mail guard: test holds real Salesforce data, so Graph mail reaches only these addresses; everyone
// else's copy goes to mailRedirectTo, or is dropped when that is empty. Fill both before turning on
// email (notificationDispatchIntervalSeconds > 0) for UAT.
param mailAllowlist = []
param mailRedirectTo = ''

// Salesforce live since 2026-10-24 (03 B-06): client credentials against the production org.
param sfMode = 'live'
param sfAuthFlow = 'client_credentials'
param sfLoginUrl = 'https://pretiumpkg.my.salesforce.com'
param sfClientId = '3MVG9WQsPp5nH_EpyovYhv7bEyY7Cr3g1GW4jMg747LVlaX1o_oszK.Np_bUA5wUgEqOe1lseDy9DFa5CKa3z' // gitleaks:allow (connected-app consumer key, an identifier; the secret is in Key Vault)
param sfClientSecretName = 'sf-client-secret'
// The test database was recreated on production data on 2026-10-24: no synthetic seed.
param seedSyntheticData = false

param fabricWorkspaceId = ''
param fabricMirroredDbId = ''

// B-21 health alerts (infra/README.md "Alerts"). Test: quiet defaults. Add an address to be emailed; empty = rules fire into the portal only.
param alertEmails = []
// Three locations (the minimum) to keep test's per-run cost down; prod uses main.bicep's five.
param availabilityLocations = ['us-il-ch1-azr', 'us-fl-mia-edge', 'us-tx-sn1-azr']

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
