// B-21 health alerts: a standard availability test on /api/v1/health, an optional email action group,
// and metric alerts on the web app, its plan and Postgres. What each alert means and how to add
// receivers: infra/README.md "Alerts".
//
// With no email receivers there is no action group: the rules still exist and fire into the portal
// (Monitor → Alerts), they just notify nobody.
//
// Not here: a log alert on the B-27 "fabric mirror unhealthy" message. The API logs with pino to stdout,
// which App Service keeps in the file system Log stream; nothing sends it to App Insights or Log
// Analytics yet, so a scheduled-query rule would never match. See infra/README.md.

param location string
param tags object
@description('Prefix for alert and test names, e.g. quoteflow-test.')
param namePrefix string
@description('Action group short name (at most 12 characters; the sender name on notifications).')
@maxLength(12)
param actionGroupShortName string
param appInsightsId string
param webAppId string
param appServicePlanId string
param postgresServerId string

@description('Run the availability test. false when the web app has no public endpoint (exposure = private): the test agents could not reach it.')
param enableAvailabilityTest bool
@description('Full URL the availability test requests.')
param healthUrl string
@description('Availability test agent locations (population tags). At least 3; ARM recommends 5.')
@minLength(3)
param availabilityLocations array
@description('Seconds between test runs from each location: 300, 600 or 900.')
@allowed([300, 600, 900])
param availabilityFrequencySeconds int
@description('Alert when at least this many locations fail in the same 5 minutes.')
@minValue(1)
param availabilityFailedLocations int

@description('Email addresses for the action group. Empty = no action group; alerts still fire into the portal.')
param alertEmails array
@description('Severity of the availability, 5xx and database-down alerts (0 critical … 4 verbose).')
@minValue(0)
@maxValue(4)
param criticalSeverity int
@description('Severity of the capacity alerts (CPU, storage, failed connections, replication lag).')
@minValue(0)
@maxValue(4)
param warningSeverity int

@description('HTTP 5xx responses from the web app within 15 minutes.')
param http5xxThreshold int
@description('App Service plan average CPU % over 15 minutes.')
param appServiceCpuPercent int
@description('Postgres average CPU % over 15 minutes.')
param postgresCpuPercent int
@description('Postgres maximum storage used %.')
param postgresStoragePercent int
@description('Failed Postgres connections within 15 minutes.')
param postgresFailedConnections int
@description('Maximum logical replication slot lag in bytes (B-27 mirroring holds a slot; a stalled mirror makes WAL pile up).')
param postgresReplicationLagBytes int

var hasActionGroup = !empty(alertEmails)
var actions = hasActionGroup ? [{ actionGroupId: actionGroup.id }] : []
var webTestName = '${namePrefix}-health'

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = if (hasActionGroup) {
  name: 'ag-${namePrefix}'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: actionGroupShortName
    enabled: true
    emailReceivers: [
      for (email, i) in alertEmails: {
        name: 'email-${i}'
        emailAddress: email
        useCommonAlertSchema: true
      }
    ]
  }
}

resource webTest 'Microsoft.Insights/webtests@2022-06-15' = if (enableAvailabilityTest) {
  name: webTestName
  location: location
  // The hidden-link tag ties the test to the Application Insights resource (required).
  tags: union(tags, { 'hidden-link:${appInsightsId}': 'Resource' })
  kind: 'standard'
  properties: {
    SyntheticMonitorId: webTestName
    Name: webTestName
    Description: 'GET /api/v1/health: 200 and "status":"ok" (503 = database down).'
    Enabled: true
    Kind: 'standard'
    Frequency: availabilityFrequencySeconds
    Timeout: 30
    RetryEnabled: true
    Locations: [for id in availabilityLocations: { Id: id }]
    Request: {
      RequestUrl: healthUrl
      HttpVerb: 'GET'
      FollowRedirects: false
      ParseDependentRequests: false
    }
    ValidationRules: {
      ExpectedHttpStatusCode: 200
      SSLCheck: true
      SSLCertRemainingLifetimeCheck: 7
      ContentValidation: {
        ContentMatch: '"status":"ok"'
        IgnoreCase: false
        PassIfTextFound: true
      }
    }
  }
}

resource availabilityAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (enableAvailabilityTest) {
  name: '${namePrefix}-availability'
  location: 'global'
  tags: tags
  properties: {
    description: 'The /api/v1/health availability test failed from ${availabilityFailedLocations} or more locations.'
    severity: criticalSeverity
    enabled: true
    scopes: [webTest.id, appInsightsId]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.WebtestLocationAvailabilityCriteria'
      webTestId: webTest.id
      componentId: appInsightsId
      failedLocationCount: availabilityFailedLocations
    }
    autoMitigate: true
    actions: actions
  }
}

// Static-threshold metric alerts on one resource each.
var metricRules = [
  {
    name: '${namePrefix}-http5xx'
    description: 'The web app returned more than ${http5xxThreshold} HTTP 5xx responses in 15 minutes.'
    severity: criticalSeverity
    scope: webAppId
    namespace: 'Microsoft.Web/sites'
    metric: 'Http5xx'
    aggregation: 'Total'
    operator: 'GreaterThan'
    threshold: http5xxThreshold
    window: 'PT15M'
    frequency: 'PT5M'
  }
  {
    name: '${namePrefix}-plan-cpu'
    description: 'App Service plan CPU averaged above ${appServiceCpuPercent}% for 15 minutes.'
    severity: warningSeverity
    scope: appServicePlanId
    namespace: 'Microsoft.Web/serverfarms'
    metric: 'CpuPercentage'
    aggregation: 'Average'
    operator: 'GreaterThan'
    threshold: appServiceCpuPercent
    window: 'PT15M'
    frequency: 'PT5M'
  }
  {
    name: '${namePrefix}-pg-down'
    description: 'Postgres reported the database as not alive.'
    severity: criticalSeverity
    scope: postgresServerId
    namespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
    metric: 'is_db_alive'
    aggregation: 'Minimum'
    operator: 'LessThan'
    threshold: 1
    window: 'PT5M'
    frequency: 'PT1M'
  }
  {
    name: '${namePrefix}-pg-cpu'
    description: 'Postgres CPU averaged above ${postgresCpuPercent}% for 15 minutes.'
    severity: warningSeverity
    scope: postgresServerId
    namespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
    metric: 'cpu_percent'
    aggregation: 'Average'
    operator: 'GreaterThan'
    threshold: postgresCpuPercent
    window: 'PT15M'
    frequency: 'PT5M'
  }
  {
    name: '${namePrefix}-pg-storage'
    description: 'Postgres storage is above ${postgresStoragePercent}% used (storage auto-grow is on; check it is growing).'
    severity: warningSeverity
    scope: postgresServerId
    namespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
    metric: 'storage_percent'
    aggregation: 'Maximum'
    operator: 'GreaterThan'
    threshold: postgresStoragePercent
    window: 'PT15M'
    frequency: 'PT5M'
  }
  {
    name: '${namePrefix}-pg-failed-connections'
    description: 'More than ${postgresFailedConnections} failed Postgres connections in 15 minutes (wrong password after a reset, firewall, or exhausted connections).'
    severity: warningSeverity
    scope: postgresServerId
    namespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
    metric: 'connections_failed'
    aggregation: 'Total'
    operator: 'GreaterThan'
    threshold: postgresFailedConnections
    window: 'PT15M'
    frequency: 'PT5M'
  }
  {
    name: '${namePrefix}-pg-replication-lag'
    description: 'A logical replication slot lags by more than ${postgresReplicationLagBytes} bytes: the Fabric mirror (B-27) may be stalled and WAL is accumulating.'
    severity: warningSeverity
    scope: postgresServerId
    namespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
    metric: 'logical_replication_delay_in_bytes'
    aggregation: 'Maximum'
    operator: 'GreaterThan'
    threshold: postgresReplicationLagBytes
    window: 'PT30M'
    frequency: 'PT5M'
  }
]

resource metricAlerts 'Microsoft.Insights/metricAlerts@2018-03-01' = [
  for rule in metricRules: {
    name: rule.name
    location: 'global'
    tags: tags
    properties: {
      description: rule.description
      severity: rule.severity
      enabled: true
      scopes: [rule.scope]
      evaluationFrequency: rule.frequency
      windowSize: rule.window
      criteria: {
        'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
        allOf: [
          {
            criterionType: 'StaticThresholdCriterion'
            name: rule.metric
            metricNamespace: rule.namespace
            metricName: rule.metric
            timeAggregation: rule.aggregation
            operator: rule.operator
            threshold: rule.threshold
          }
        ]
      }
      autoMitigate: true
      actions: actions
    }
  }
]

output actionGroupId string = hasActionGroup ? actionGroup.id : ''
output webTestId string = enableAvailabilityTest ? webTest.id : ''
