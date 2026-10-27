// Key Vault in RBAC mode (runbook 06 B4). Secret VALUES are never in Bicep: IT sets them out of band
// (`database-url`, later `sf-client-secret`, ...). Access is granted by role assignments in rbac.bicep.

param location string
param tags object
param name string
param tenantId string = subscription().tenantId
@description('Purge protection cannot be turned off once on. Off in test (as the runbook built it), on in prod.')
param enablePurgeProtection bool
@description('Prod: Disabled (reached through the private endpoint). Test: Enabled (as built).')
@allowed(['Enabled', 'Disabled'])
param publicNetworkAccess string

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    tenantId: tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    // ARM refuses `false` once purge protection is on, so omit it rather than send false.
    enablePurgeProtection: enablePurgeProtection ? true : null
    publicNetworkAccess: publicNetworkAccess
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: publicNetworkAccess == 'Enabled' ? 'Allow' : 'Deny'
    }
  }
}

output id string = kv.id
output name string = kv.name
output vaultUri string = kv.properties.vaultUri
