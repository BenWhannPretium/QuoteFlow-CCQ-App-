// App Service plan (Linux) + web app on Node 22 (runbook 06 B6), plus a staging slot in prod.
// The API serves the built SPA; GitHub Actions zip-deploys the package (deploy.yml), so Azure must not
// build (SCM_DO_BUILD_DURING_DEPLOYMENT=false, set by main.bicep).
//
// NOTE: the appsettings resource REPLACES the whole set. A setting changed by hand in the portal and not
// carried in the parameter file is removed on the next apply. Run what-if first (infra/README.md).

param location string
param tags object
param planName string
param planSkuName string
param webAppName string
@description('Name/value map. Secrets appear only as @Microsoft.KeyVault(...) references.')
param appSettings object
param enableStagingSlot bool
@description('Regional VNet integration subnet (prod). Empty = none (test).')
param vnetIntegrationSubnetId string
@description('Public (D-H2 option 1) or private (option 2: private endpoint, published by Entra Private Access).')
@allowed(['public', 'private'])
param exposure string

var siteConfig = {
  linuxFxVersion: 'NODE|22-lts'
  appCommandLine: 'node apps/api/dist/azureStart.js'
  alwaysOn: true
  ftpsState: 'Disabled'
  minTlsVersion: '1.2'
  http20Enabled: true
  healthCheckPath: '/api/v1/health'
  vnetRouteAllEnabled: !empty(vnetIntegrationSubnetId)
}

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: planName
  location: location
  tags: tags
  kind: 'linux'
  sku: { name: planSkuName }
  properties: {
    reserved: true
  }
}

resource site 'Microsoft.Web/sites@2024-04-01' = {
  name: webAppName
  location: location
  tags: tags
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    publicNetworkAccess: exposure == 'private' ? 'Disabled' : 'Enabled'
    virtualNetworkSubnetId: empty(vnetIntegrationSubnetId) ? null : vnetIntegrationSubnetId
    siteConfig: siteConfig
  }
}

resource settings 'Microsoft.Web/sites/config@2024-04-01' = {
  parent: site
  name: 'appsettings'
  properties: appSettings
}

// `az webapp log config --docker-container-logging filesystem` (runbook 06 B7): container stdout to the
// Log stream.
resource logs 'Microsoft.Web/sites/config@2024-04-01' = {
  parent: site
  name: 'logs'
  properties: {
    httpLogs: {
      fileSystem: {
        enabled: true
        retentionInMb: 35
        retentionInDays: 7
      }
    }
  }
}

resource slot 'Microsoft.Web/sites/slots@2024-04-01' = if (enableStagingSlot) {
  parent: site
  name: 'staging'
  location: location
  tags: tags
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    publicNetworkAccess: exposure == 'private' ? 'Disabled' : 'Enabled'
    virtualNetworkSubnetId: empty(vnetIntegrationSubnetId) ? null : vnetIntegrationSubnetId
    siteConfig: siteConfig
  }
}

resource slotSettings 'Microsoft.Web/sites/slots/config@2024-04-01' = if (enableStagingSlot) {
  parent: slot
  name: 'appsettings'
  // Same settings as production, APP_BASE_URL included: a swap moves non-sticky settings with the code,
  // and links in email must always point at the production URL.
  properties: appSettings
}

output id string = site.id
output planId string = plan.id
output name string = site.name
output defaultHostName string = site.properties.defaultHostName
output principalId string = site.identity.principalId
output slotPrincipalId string = enableStagingSlot ? slot!.identity.principalId : ''
