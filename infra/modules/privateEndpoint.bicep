// A private endpoint for one resource, registered in its private DNS zone.

param location string
param tags object
param name string
param subnetId string
param targetResourceId string
@description('Sub-resource: postgresqlServer, vault, blob or sites.')
param groupId string
param privateDnsZoneId string

resource pe 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    subnet: { id: subnetId }
    privateLinkServiceConnections: [
      {
        name: name
        properties: {
          privateLinkServiceId: targetResourceId
          groupIds: [groupId]
        }
      }
    ]
  }
}

resource dnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: pe
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: groupId
        properties: { privateDnsZoneId: privateDnsZoneId }
      }
    ]
  }
}
