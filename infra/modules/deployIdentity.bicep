// User-assigned identity GitHub Actions signs in as with OIDC (runbook 06 B8). No password or secret.
// Its role (Website Contributor on the web app) is granted in rbac.bicep.

param location string
param tags object
param name string
@description('[{ name, subject }]: one federated credential per GitHub subject, e.g. repo:<owner>/<repo>:environment:test.')
param githubSubjects array

resource id 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: name
  location: location
  tags: tags
}

// Federated credentials on one identity must be written one at a time.
@batchSize(1)
resource fic 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = [
  for s in githubSubjects: {
    parent: id
    name: s.name
    properties: {
      issuer: 'https://token.actions.githubusercontent.com'
      subject: s.subject
      audiences: ['api://AzureADTokenExchange']
    }
  }
]

output principalId string = id.properties.principalId
output clientId string = id.properties.clientId
