using './main.bicep'

param teamIdentifier = 'team01'
param location = 'eastus2'
param appServicePlanSku = 'B1'
param handoffTableName = 'Handoffs'
param tags = {
  environment: 'capstone'
  owner: 'team01'
  application: 'incident-handoff-board'
}
