// Diagnostic setting on the web app: container stdout/stderr (the API's pino JSON lines), the HTTP
// access log and the platform's container lifecycle log, sent to the Log Analytics workspace.
//
// Why: the API has no Application Insights SDK, so stdout is its only telemetry, and App Service keeps
// it in the file system only (appservice.bicep: 35 MB, 7 days). With this on, the lines are queryable in
// the workspace as AppServiceConsoleLogs (the JSON is in ResultDescription), AppServiceHTTPLogs and
// AppServicePlatformLogs; docs/audit/06-first-week.md has the queries. A log alert (for example on
// "refusing to start" or on the Fabric mirror warning) becomes possible once the data is there.
//
// Written 2026-11-17 (pre-release audit) and NOT yet applied anywhere: run what-if on test first.
// Ingestion is billed per GB by the workspace (PerGB2018); at this app's volume it is small.

@description('Name of the existing web app (Microsoft.Web/sites) in this resource group.')
param webAppName string
@description('Resource id of the Log Analytics workspace.')
param logAnalyticsId string

resource site 'Microsoft.Web/sites@2024-04-01' existing = {
  name: webAppName
}

resource toWorkspace 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: site
  properties: {
    workspaceId: logAnalyticsId
    logs: [
      { category: 'AppServiceConsoleLogs', enabled: true }
      { category: 'AppServiceHTTPLogs', enabled: true }
      { category: 'AppServicePlatformLogs', enabled: true }
    ]
  }
}
