targetScope = 'resourceGroup'

@description('Workshop team identifier used for resource naming and tagging.')
@minLength(2)
@maxLength(32)
param teamIdentifier string

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('App Service plan SKU for the capstone handoff board.')
param appServicePlanSku string = 'B1'

@description('Azure Table Storage table used by the incident handoff board.')
@minLength(3)
@maxLength(63)
param handoffTableName string = 'Handoffs'

@description('Additional tags applied to every resource.')
param tags object = {}

var uniqueSuffix = uniqueString(resourceGroup().id, teamIdentifier, 'handoff')
var storageAccountName = 'st${uniqueSuffix}'
var logAnalyticsName = 'log-handoff-${uniqueSuffix}'
var applicationInsightsName = 'appi-handoff-${uniqueSuffix}'
var appServicePlanName = 'plan-handoff-${uniqueSuffix}'
var webAppName = 'app-handoff-${uniqueSuffix}'
var commonTags = union(tags, {
  workload: 'capstone-incident-handoff-board'
  team: teamIdentifier
  managedBy: 'bicep'
})

module storage 'br/public:avm/res/storage/storage-account:0.33.1' = {
  name: 'storage'
  params: {
    name: storageAccountName
    location: location
    skuName: 'Standard_LRS'
    kind: 'StorageV2'
    allowBlobPublicAccess: false
    allowCrossTenantReplication: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    supportsHttpsTrafficOnly: true
    tableServices: {
      tables: [
        {
          name: handoffTableName
        }
      ]
    }
    tags: commonTags
  }
}

module logAnalytics 'br/public:avm/res/operational-insights/workspace:0.16.1' = {
  name: 'log-analytics'
  params: {
    name: logAnalyticsName
    location: location
    skuName: 'PerGB2018'
    dataRetention: 30
    dailyQuotaGb: '1'
    features: {
      disableLocalAuth: true
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    tags: commonTags
  }
}

module applicationInsights 'br/public:avm/res/insights/component:0.8.0' = {
  name: 'application-insights'
  params: {
    name: applicationInsightsName
    location: location
    applicationType: 'web'
    workspaceResourceId: logAnalytics.outputs.resourceId
    retentionInDays: 30
    tags: commonTags
  }
}

module appServicePlan 'br/public:avm/res/web/serverfarm:0.7.0' = {
  name: 'app-service-plan'
  params: {
    name: appServicePlanName
    location: location
    kind: 'linux'
    reserved: true
    skuName: appServicePlanSku
    skuCapacity: 1
    zoneRedundant: false
    tags: commonTags
  }
}

module webApp 'br/public:avm/res/web/site:0.24.0' = {
  name: 'web-app'
  params: {
    name: webAppName
    location: location
    kind: 'app,linux'
    serverFarmResourceId: appServicePlan.outputs.resourceId
    httpsOnly: true
    clientAffinityEnabled: false
    managedIdentities: {
      systemAssigned: true
    }
    publicNetworkAccess: 'Enabled'
    siteConfig: {
      alwaysOn: true
      ftpsState: 'Disabled'
      http20Enabled: true
      linuxFxVersion: 'NODE|22-lts'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      use32BitWorkerProcess: false
      webSocketsEnabled: false
    }
    configs: [
      {
        name: 'appsettings'
        applicationInsightResourceId: applicationInsights.outputs.resourceId
        retainCurrentAppSettings: false
        properties: {
          NODE_ENV: 'production'
          PORT: '8080'
          WEBSITE_NODE_DEFAULT_VERSION: '~22'
          ENABLE_ORYX_BUILD: 'true'
          SCM_DO_BUILD_DURING_DEPLOYMENT: 'true'
          STORAGE_BACKEND: 'azure'
          AZURE_STORAGE_ACCOUNT_URL: 'https://${storage.outputs.name}.table.${environment().suffixes.storage}'
          AZURE_STORAGE_TABLE_NAME: handoffTableName
        }
      }
    ]
    basicPublishingCredentialsPolicies: [
      {
        name: 'ftp'
        allow: false
      }
      {
        name: 'scm'
        allow: false
      }
    ]
    diagnosticSettings: [
      {
        name: 'send-to-log-analytics'
        workspaceResourceId: logAnalytics.outputs.resourceId
      }
    ]
    tags: commonTags
  }
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2025-06-01' existing = {
  name: storageAccountName
}

var storageTableDataContributorRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
)

resource storageTableDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, webAppName, storageTableDataContributorRoleDefinitionId)
  scope: storageAccount
  properties: {
    roleDefinitionId: storageTableDataContributorRoleDefinitionId
    principalId: webApp.outputs.systemAssignedMIPrincipalId!
    principalType: 'ServicePrincipal'
    description: 'Allows the capstone incident handoff board to read and write Azure Table Storage.'
  }
}

@description('Name of the deployed App Service web app.')
output appName string = webApp.outputs.name

@description('HTTPS URL of the deployed incident handoff board.')
output appUrl string = 'https://${webApp.outputs.defaultHostname}'

@description('Resource ID of the deployed web app.')
output appResourceId string = webApp.outputs.resourceId

@description('Deployment identifier used for evidence collection.')
output deploymentIdentifier string = deployment().name
