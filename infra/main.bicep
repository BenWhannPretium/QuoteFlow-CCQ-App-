// QuoteFlow (CCQ) Azure environment, B-20 (+ the B-27 Fabric mirroring prerequisites).
// Resource-group scope: one deployment per environment (rg-ccq-test, rg-ccq-prod).
// Reproduces what runbook docs/build-guide/06-azure-entra-setup.md built for test, parameterised for
// prod (VNet, private endpoints, staging slot). How to deploy, and what stays manual: infra/README.md.
// No secret values live here: the Postgres admin password is a @secure() parameter given at deploy time
// (and only when creating a server); secrets themselves are set in Key Vault out of band.

targetScope = 'resourceGroup'

// ---------------------------------------------------------------------------------------------------
// Environment
@allowed(['test', 'prod'])
param environmentName string
param location string = resourceGroup().location
@description('IT tagging standard; costCenter still to confirm with IT.')
param tags object = {}

// ---------------------------------------------------------------------------------------------------
// Names (Postgres, Key Vault, storage and the web app must be globally unique)
param webAppName string
param appServicePlanName string
param postgresServerName string
param keyVaultName string
param storageAccountName string
param logAnalyticsName string
param appInsightsName string
param deployIdentityName string
param vnetName string = 'vnet-quoteflow-${environmentName}'

// ---------------------------------------------------------------------------------------------------
// Network and exposure (D-H2)
@description('Create the VNet, private endpoints and private DNS zones (prod). false = public endpoints (test, as built).')
param deployNetwork bool
@allowed(['public', 'private'])
@description('public = D-H2 option 1 (public endpoint + Entra sign-in + Conditional Access); private = option 2 (web app private endpoint, published by Entra Private Access).')
param exposure string = 'public'
param vnetAddressPrefix string = '10.60.0.0/24'
param appSubnetPrefix string = '10.60.0.0/26'
param privateEndpointSubnetPrefix string = '10.60.0.64/27'
@description('Fabric VNet data gateway subnet (B-27): 5 reserved IPs + 1 per gateway member + buffer; /27 is ample.')
param fabricGatewaySubnetPrefix string = '10.60.0.96/27'

// ---------------------------------------------------------------------------------------------------
// App Service
@description('Runbook: B1 on test. Prod: P1v3.')
param appServicePlanSku string
param enableStagingSlot bool

// ---------------------------------------------------------------------------------------------------
// PostgreSQL
@description('General Purpose in both envs: Fabric mirroring does not support Burstable. Test cost approval is D-FB3 (pending).')
param postgresSkuName string = 'Standard_D2ds_v5'
@allowed(['GeneralPurpose', 'MemoryOptimized'])
param postgresSkuTier string = 'GeneralPurpose'
param postgresStorageSizeGB int = 32
@minValue(7)
@maxValue(35)
param postgresBackupRetentionDays int
param postgresAdminLogin string = 'ccqadmin'
@secure()
@description('Give ONLY when the server is being created (a rebuild). Empty on an existing server, or the password changes and the database-url secret stops working.')
param postgresAdminPassword string = ''
param databaseName string = 'ccq'
@description('Existing name of the test "Allow Azure services" (0.0.0.0) firewall rule; ignored when deployNetwork = true.')
param postgresAllowAzureServicesRuleName string = 'AllowAllAzureServicesAndResourcesWithinAzureIps'
@description('Entra admins on the server: [{ objectId, principalName, principalType }]. Needed to map ccq_fabric_mirror (B-27).')
param postgresEntraAdmins array = []
param postgresAzureExtensions string = 'pg_trgm,pgcrypto,azure_cdc'
param postgresSharedPreloadLibraries string = 'pg_cron,pg_stat_statements,azure_cdc'
@description('Azure default 8; Fabric mirroring adds 3 per mirrored database, and azure_cdc\'s readiness check wants at least 13.')
param postgresMaxWorkerProcesses int = 16

// ---------------------------------------------------------------------------------------------------
// Key Vault
param keyVaultPurgeProtection bool
param databaseUrlSecretName string = 'database-url'

// ---------------------------------------------------------------------------------------------------
// App settings (not secrets; secrets are Key Vault secret NAMES turned into references)
param entraTenantId string = subscription().tenantId
param entraApiClientId string
param entraSpaClientId string
param entraApiScope string = 'access_as_user'
@description('Public URL users reach the app on. Default: the azurewebsites.net host.')
param appBaseUrl string = 'https://${webAppName}.azurewebsites.net'
@allowed(['blob', 'sharepoint'])
param filestoreMode string = 'blob'
param blobContainerName string = 'attachments'
@description('sharepoint mode: the CCQ site and drive ids (M7).')
param sharePointSiteId string = ''
param sharePointDriveId string = ''
param mailFrom string = ''
@description('0 = email dispatch off until the shared mailbox exists (M7).')
param notificationDispatchIntervalSeconds int = 0
@allowed(['fake', 'live'])
param sfMode string = 'fake'
@allowed(['jwt', 'client_credentials'])
param sfAuthFlow string = 'client_credentials'
param sfLoginUrl string = ''
@description('External Client App consumer key. Not a secret.')
param sfClientId string = ''
@description('Key Vault secret name of the Salesforce consumer secret (client_credentials).')
param sfClientSecretName string = ''
@description('Test only. Ignored on prod (never seed synthetic data there).')
param seedSyntheticData bool = false
@description('B-27 (PR #32): Fabric workspace and mirrored database ids. Empty = not set.')
param fabricWorkspaceId string = ''
param fabricMirroredDbId string = ''
@description('Any further plain app settings (e.g. LOG_LEVEL). Must not contain secret values.')
param extraAppSettings object = {}

// ---------------------------------------------------------------------------------------------------
// Identities and access
@description('[{ name, subject }] federated credentials on the deploy identity.')
param githubSubjects array
@description('false while the CLI-made role assignments still exist (test today): see rbac.bicep.')
param manageRoleAssignments bool = true
param developerObjectIds array = []
param developerRgRoles array = []
param developersAreKeyVaultOfficers bool = false

// ===================================================================================================

var allTags = union(
  {
    app: 'quoteflow'
    owner: 'embedded-intelligence'
    env: environmentName
  },
  tags
)
var publicAccess = deployNetwork ? 'Disabled' : 'Enabled'

module network 'modules/network.bicep' = if (deployNetwork) {
  name: 'network'
  params: {
    location: location
    tags: allTags
    vnetName: vnetName
    addressPrefix: vnetAddressPrefix
    appSubnetPrefix: appSubnetPrefix
    privateEndpointSubnetPrefix: privateEndpointSubnetPrefix
    fabricGatewaySubnetPrefix: fabricGatewaySubnetPrefix
    includeWebAppZone: exposure == 'private'
  }
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    location: location
    tags: allTags
    logAnalyticsName: logAnalyticsName
    appInsightsName: appInsightsName
  }
}

module keyVault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: {
    location: location
    tags: allTags
    name: keyVaultName
    enablePurgeProtection: keyVaultPurgeProtection
    publicNetworkAccess: publicAccess
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    location: location
    tags: allTags
    name: storageAccountName
    containerName: blobContainerName
    publicNetworkAccess: publicAccess
  }
}

module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  params: {
    location: location
    tags: allTags
    name: postgresServerName
    skuName: postgresSkuName
    skuTier: postgresSkuTier
    storageSizeGB: postgresStorageSizeGB
    backupRetentionDays: postgresBackupRetentionDays
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    databaseName: databaseName
    publicNetworkAccess: publicAccess
    allowAzureServicesRuleName: deployNetwork ? '' : postgresAllowAzureServicesRuleName
    entraAdmins: postgresEntraAdmins
    azureExtensions: postgresAzureExtensions
    sharedPreloadLibraries: postgresSharedPreloadLibraries
    maxWorkerProcesses: postgresMaxWorkerProcesses
  }
}

// Private endpoints (prod).
module pePostgres 'modules/privateEndpoint.bicep' = if (deployNetwork) {
  name: 'pe-postgres'
  params: {
    location: location
    tags: allTags
    name: 'pe-${postgresServerName}'
    subnetId: network!.outputs.privateEndpointSubnetId
    targetResourceId: postgres.outputs.id
    groupId: 'postgresqlServer'
    privateDnsZoneId: network!.outputs.postgresZoneId
  }
}

module peKeyVault 'modules/privateEndpoint.bicep' = if (deployNetwork) {
  name: 'pe-keyvault'
  params: {
    location: location
    tags: allTags
    name: 'pe-${keyVaultName}'
    subnetId: network!.outputs.privateEndpointSubnetId
    targetResourceId: keyVault.outputs.id
    groupId: 'vault'
    privateDnsZoneId: network!.outputs.keyVaultZoneId
  }
}

module peBlob 'modules/privateEndpoint.bicep' = if (deployNetwork) {
  name: 'pe-blob'
  params: {
    location: location
    tags: allTags
    name: 'pe-${storageAccountName}-blob'
    subnetId: network!.outputs.privateEndpointSubnetId
    targetResourceId: storage.outputs.id
    groupId: 'blob'
    privateDnsZoneId: network!.outputs.blobZoneId
  }
}

// App settings, as runbook 06 B6 sets them (PRICING_MODE dropped: B-15 removed it from config.ts).
var kvRef = '@Microsoft.KeyVault(SecretUri=${keyVault.outputs.vaultUri}secrets/'
var baseSettings = {
  NODE_ENV: 'production'
  SCM_DO_BUILD_DURING_DEPLOYMENT: 'false'
  AUTH_MODE: 'entra'
  ENTRA_TENANT_ID: entraTenantId
  ENTRA_API_CLIENT_ID: entraApiClientId
  ENTRA_API_AUDIENCE: 'api://${entraApiClientId}'
  ENTRA_SPA_CLIENT_ID: entraSpaClientId
  ENTRA_API_SCOPE: entraApiScope
  APP_BASE_URL: appBaseUrl
  DATABASE_URL: '${kvRef}${databaseUrlSecretName}/)'
  FILESTORE_MODE: filestoreMode
  MAIL_MODE: 'graph'
  NOTIFICATION_DISPATCH_INTERVAL_SECONDS: string(notificationDispatchIntervalSeconds)
  SF_MODE: sfMode
  APPLICATIONINSIGHTS_CONNECTION_STRING: monitoring.outputs.appInsightsConnectionString
}
var blobSettings = filestoreMode == 'blob'
  ? {
      BLOB_ACCOUNT_URL: 'https://${storageAccountName}.blob.${environment().suffixes.storage}'
      BLOB_CONTAINER: blobContainerName
    }
  : {
      SP_SITE_ID: sharePointSiteId
      SP_DRIVE_ID: sharePointDriveId
    }
var sfSettings = sfMode == 'live'
  ? union(
      {
        SF_AUTH_FLOW: sfAuthFlow
        SF_LOGIN_URL: sfLoginUrl
        SF_CLIENT_ID: sfClientId
      },
      empty(sfClientSecretName) ? {} : { SF_CLIENT_SECRET: '${kvRef}${sfClientSecretName}/)' }
    )
  : {}
var optionalSettings = union(
  empty(mailFrom) ? {} : { MAIL_FROM: mailFrom },
  environmentName == 'test' ? { SEED_SYNTHETIC_DATA: seedSyntheticData ? 'true' : 'false' } : {},
  empty(fabricWorkspaceId) ? {} : { FABRIC_WORKSPACE_ID: fabricWorkspaceId },
  empty(fabricMirroredDbId) ? {} : { FABRIC_MIRRORED_DB_ID: fabricMirroredDbId }
)

module app 'modules/appservice.bicep' = {
  name: 'appservice'
  params: {
    location: location
    tags: allTags
    planName: appServicePlanName
    planSkuName: appServicePlanSku
    webAppName: webAppName
    appSettings: union(baseSettings, blobSettings, sfSettings, optionalSettings, extraAppSettings)
    enableStagingSlot: enableStagingSlot
    vnetIntegrationSubnetId: deployNetwork ? network!.outputs.appSubnetId : ''
    exposure: exposure
  }
}

module peWebApp 'modules/privateEndpoint.bicep' = if (deployNetwork && exposure == 'private') {
  name: 'pe-webapp'
  params: {
    location: location
    tags: allTags
    name: 'pe-${webAppName}'
    subnetId: network!.outputs.privateEndpointSubnetId
    targetResourceId: app.outputs.id
    groupId: 'sites'
    privateDnsZoneId: network!.outputs.webAppZoneId
  }
}

module deployIdentity 'modules/deployIdentity.bicep' = {
  name: 'deploy-identity'
  params: {
    location: location
    tags: allTags
    name: deployIdentityName
    githubSubjects: githubSubjects
  }
}

module rbac 'modules/rbac.bicep' = if (manageRoleAssignments) {
  name: 'rbac'
  params: {
    keyVaultName: keyVault.outputs.name
    storageAccountName: storage.outputs.name
    webAppName: app.outputs.name
    appPrincipalIds: enableStagingSlot
      ? [app.outputs.principalId, app.outputs.slotPrincipalId]
      : [app.outputs.principalId]
    deployPrincipalId: deployIdentity.outputs.principalId
    developerObjectIds: developerObjectIds
    developerRgRoles: developerRgRoles
    developersAreKeyVaultOfficers: developersAreKeyVaultOfficers
  }
}

// ---------------------------------------------------------------------------------------------------
output webAppName string = app.outputs.name
output webAppUrl string = 'https://${app.outputs.defaultHostName}'
output postgresFqdn string = postgres.outputs.fqdn
@description('Object id of the Postgres server\'s system-assigned identity (Fabric mirroring writes to OneLake as it).')
output postgresPrincipalId string = postgres.outputs.principalId
output keyVaultUri string = keyVault.outputs.vaultUri
output deployIdentityClientId string = deployIdentity.outputs.clientId
output fabricGatewaySubnetId string = deployNetwork ? network!.outputs.fabricGatewaySubnetId : ''
