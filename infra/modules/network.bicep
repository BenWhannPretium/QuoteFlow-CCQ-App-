// B-20 network (prod). A VNet with three subnets and the private DNS zones the private endpoints use.
//   snet-app        App Service regional VNet integration (delegated to Microsoft.Web/serverFarms)
//   snet-pe         private endpoints: Postgres, Key Vault, Blob (and the web app when exposure = private)
//   snet-fabric-gw  Fabric VNet data gateway (B-27), delegated to Microsoft.PowerPlatform/vnetaccesslinks.
//                   Mirroring reaches the private Postgres through it. Fabric creates the gateway itself.
// If IT wants a spoke peered to the hub instead of a stand-alone VNet, or keeps the private DNS zones
// in the hub, this module changes: confirm before the first prod apply (infra/README.md).

param location string
param tags object
param vnetName string
param addressPrefix string
param appSubnetPrefix string
param privateEndpointSubnetPrefix string
param fabricGatewaySubnetPrefix string
@description('Also create the App Service private DNS zone (exposure = private, D-H2 option 2).')
param includeWebAppZone bool

var zoneNames = union(
  [
    'privatelink.postgres.database.azure.com'
    'privatelink.vaultcore.azure.net'
    'privatelink.blob.${environment().suffixes.storage}'
  ],
  includeWebAppZone ? ['privatelink.azurewebsites.net'] : []
)

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: vnetName
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [addressPrefix]
    }
    subnets: [
      {
        name: 'snet-app'
        properties: {
          addressPrefix: appSubnetPrefix
          delegations: [
            {
              name: 'appservice'
              properties: { serviceName: 'Microsoft.Web/serverFarms' }
            }
          ]
        }
      }
      {
        name: 'snet-pe'
        properties: {
          addressPrefix: privateEndpointSubnetPrefix
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
      {
        name: 'snet-fabric-gw'
        properties: {
          addressPrefix: fabricGatewaySubnetPrefix
          delegations: [
            {
              name: 'fabric-vnet-gateway'
              properties: { serviceName: 'Microsoft.PowerPlatform/vnetaccesslinks' }
            }
          ]
        }
      }
    ]
  }
}

resource zones 'Microsoft.Network/privateDnsZones@2020-06-01' = [
  for zone in zoneNames: {
    name: zone
    location: 'global'
    tags: tags
  }
]

resource links 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = [
  for (zone, i) in zoneNames: {
    parent: zones[i]
    name: '${vnetName}-link'
    location: 'global'
    tags: tags
    properties: {
      registrationEnabled: false
      virtualNetwork: { id: vnet.id }
    }
  }
]

output vnetId string = vnet.id
output appSubnetId string = '${vnet.id}/subnets/snet-app'
output privateEndpointSubnetId string = '${vnet.id}/subnets/snet-pe'
output fabricGatewaySubnetId string = '${vnet.id}/subnets/snet-fabric-gw'
output postgresZoneId string = zones[0].id
output keyVaultZoneId string = zones[1].id
output blobZoneId string = zones[2].id
output webAppZoneId string = includeWebAppZone ? zones[3].id : ''
