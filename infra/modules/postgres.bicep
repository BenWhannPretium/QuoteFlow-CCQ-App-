// Azure Database for PostgreSQL Flexible Server 16 + database `ccq` (runbook 06 B2), with the Fabric
// mirroring prerequisites (B-27, 01-architecture.md §6.1):
//   - General Purpose tier (Burstable is not supported by mirroring; D-FB3 approves the cost for test)
//   - a system-assigned managed identity on the server (azure_cdc writes to OneLake with it)
//   - wal_level=logical, azure_cdc allow-listed and preloaded, max_worker_processes raised
// wal_level, shared_preload_libraries and max_worker_processes are STATIC parameters: ARM stores the new
// value but it takes effect only after a server restart, which this template does not do. Schedule the
// restart with IT (infra/README.md). A SKU change (B1ms -> D2ds_v5) also restarts the server.

param location string
param tags object
param name string
param skuName string
@allowed(['GeneralPurpose', 'MemoryOptimized'])
param skuTier string
param storageSizeGB int
param backupRetentionDays int
param administratorLogin string
@secure()
@description('Only needed to CREATE a server. Leave empty on an existing one: a value here resets the admin password and breaks the database-url secret.')
param administratorLoginPassword string
param databaseName string
@description('Test: Enabled + the "Allow Azure services" rule (as built). Prod: Disabled, private endpoint.')
@allowed(['Enabled', 'Disabled'])
param publicNetworkAccess string
@description('Name of the 0.0.0.0 firewall rule. The CLI names it AllowAllAzureServicesAndResourcesWithinAzureIps_<timestamp>; use the existing name on test so no duplicate is created. Empty = no rule.')
param allowAzureServicesRuleName string
@description('Entra admins: [{ objectId, principalName, principalType: User|Group|ServicePrincipal }].')
param entraAdmins array
@description('Comma list for azure.extensions. pg_trgm + pgcrypto (migrations 0001+) and azure_cdc (Fabric).')
param azureExtensions string
@description('Azure default for PG16 is pg_cron,pg_stat_statements; azure_cdc is added for mirroring.')
param sharedPreloadLibraries string
@description('Default 8. Mirroring needs +3 per mirrored database; azure_cdc\'s readiness check wants >= 13.')
param maxWorkerProcesses int

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuTier
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    version: '16'
    administratorLogin: administratorLogin
    // Omitted when empty, so an apply against an existing server keeps its password.
    administratorLoginPassword: empty(administratorLoginPassword) ? null : administratorLoginPassword
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Enabled'
      tenantId: subscription().tenantId
    }
    storage: {
      storageSizeGB: storageSizeGB
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: backupRetentionDays
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: publicNetworkAccess
    }
  }
}

// Server parameters. One at a time: the service rejects concurrent configuration updates.
var parameters = [
  { name: 'azure.extensions', value: azureExtensions }
  { name: 'require_secure_transport', value: 'on' }
  { name: 'wal_level', value: 'logical' }
  { name: 'shared_preload_libraries', value: sharedPreloadLibraries }
  { name: 'max_worker_processes', value: string(maxWorkerProcesses) }
]

@batchSize(1)
resource config 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = [
  for p in parameters: {
    parent: server
    name: p.name
    properties: {
      value: p.value
      source: 'user-override'
    }
  }
]

resource db 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: server
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
  dependsOn: [config]
}

resource allowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = if (publicNetworkAccess == 'Enabled' && !empty(allowAzureServicesRuleName)) {
  parent: server
  name: empty(allowAzureServicesRuleName) ? 'unused' : allowAzureServicesRuleName
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
  dependsOn: [db]
}

@batchSize(1)
resource admins 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = [
  for a in entraAdmins: {
    parent: server
    name: a.objectId
    properties: {
      principalName: a.principalName
      principalType: a.principalType
      tenantId: subscription().tenantId
    }
    dependsOn: [db]
  }
]

output id string = server.id
output name string = server.name
output fqdn string = server.properties.fullyQualifiedDomainName
output principalId string = server.identity.principalId
