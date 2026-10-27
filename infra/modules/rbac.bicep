// The plain Azure RBAC grants the runbook (06 B4, B7, B8, B9) makes by hand.
// Assignment names are deterministic GUIDs. On an environment built by the CLI the same grants already
// exist under random names, and ARM refuses a second identical assignment (RoleAssignmentExists), so
// main.bicep skips this module when manageRoleAssignments = false (the test default for now).

param keyVaultName string
param storageAccountName string
param webAppName string
@description('Web app system-assigned identity (and the staging slot\'s, prod).')
param appPrincipalIds array
param deployPrincipalId string
@description('Object ids of developers (runbook 06 B4/B9). Granted developerRgRoles on the RG and Secrets Officer on the vault.')
param developerObjectIds array
@description('Built-in role names from the map below, granted to each developer on the resource group.')
param developerRgRoles array
param developersAreKeyVaultOfficers bool

// Built-in role definition ids (the same in every tenant).
var roles = {
  Reader: 'acdd72a7-3385-48ef-bd42-f606fba81ae7'
  WebsiteContributor: 'de139f84-1756-47ae-9be6-808fbbe84772'
  MonitoringReader: '43d0d8ad-25c7-4714-9337-8ba259a9fe05'
  LogAnalyticsReader: '73c42c96-874c-492b-b04d-ab87d138a893'
  KeyVaultSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
  KeyVaultSecretsOfficer: 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
  StorageBlobDataContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
}

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource st 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource site 'Microsoft.Web/sites@2024-04-01' existing = {
  name: webAppName
}

// B7: the app reads Key Vault references and writes attachments with its managed identity.
resource appKv 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for (p, i) in appPrincipalIds: {
    scope: kv
    name: guid(kv.id, webAppName, string(i), roles.KeyVaultSecretsUser)
    properties: {
      principalId: p
      principalType: 'ServicePrincipal'
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.KeyVaultSecretsUser)
    }
  }
]

resource appBlob 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for (p, i) in appPrincipalIds: {
    scope: st
    name: guid(st.id, webAppName, string(i), roles.StorageBlobDataContributor)
    properties: {
      principalId: p
      principalType: 'ServicePrincipal'
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.StorageBlobDataContributor)
    }
  }
]

// B8: GitHub Actions may deploy to this one web app (and its slots), nothing else.
resource deploy 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: site
  name: guid(site.id, 'deploy-identity', roles.WebsiteContributor)
  properties: {
    principalId: deployPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.WebsiteContributor)
  }
}

// B4: developers add and rotate secrets.
resource devKv 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for d in (developersAreKeyVaultOfficers ? developerObjectIds : []): {
    scope: kv
    name: guid(kv.id, d, roles.KeyVaultSecretsOfficer)
    properties: {
      principalId: d
      principalType: 'User'
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.KeyVaultSecretsOfficer)
    }
  }
]

// B9: developers' resource-group roles (test: Reader, Website Contributor, Monitoring Reader, Log
// Analytics Reader; prod: Reader only, 06 §4).
var devGrants = flatten(map(developerObjectIds, d => map(developerRgRoles, r => { principalId: d, role: r })))

resource devRg 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for g in devGrants: {
    name: guid(resourceGroup().id, g.principalId, roles[g.role])
    properties: {
      principalId: g.principalId
      principalType: 'User'
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles[g.role])
    }
  }
]
