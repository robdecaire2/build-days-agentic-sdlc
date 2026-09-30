# Incident handoff board infrastructure

This resource-group-scoped Bicep deployment creates a dedicated Linux App
Service deployment for `capstone/incident-handoff-board/`, plus Azure Table
Storage and monitoring resources. Resource names derive from
`uniqueString(resourceGroup().id, teamIdentifier, 'handoff')`, which keeps the
capstone deployment distinct from the workshop app when both share a resource
group.

## Pinned Azure Verified Modules

| Resource | Module | Version |
|---|---|---:|
| Storage account and table | `avm/res/storage/storage-account` | `0.33.1` |
| Log Analytics workspace | `avm/res/operational-insights/workspace` | `0.16.1` |
| Application Insights | `avm/res/insights/component` | `0.8.0` |
| App Service plan | `avm/res/web/serverfarm` | `0.7.0` |
| Linux web app | `avm/res/web/site` | `0.24.0` |

## Runtime configuration

- App Service runtime: `NODE|22-lts`
- Table name: `Handoffs`
- Managed identity only for Azure Table Storage access
- Storage shared-key access disabled
- App settings:
  - `NODE_ENV=production`
  - `PORT=8080`
  - `STORAGE_BACKEND=azure`
  - `AZURE_STORAGE_ACCOUNT_URL`
  - `AZURE_STORAGE_TABLE_NAME=Handoffs`
  - `SCM_DO_BUILD_DURING_DEPLOYMENT=true`

## Native Bicep exception

The role assignment is intentionally composed as a native
`Microsoft.Authorization/roleAssignments` resource. This matches the root
`infra/README.md` exception: the storage AVM cannot consume the web app system
identity without creating a circular dependency, so the web app receives only
the `Storage Table Data Contributor` data-plane role at the storage account
scope.

## Validate

```powershell
az bicep build --file .\capstone\incident-handoff-board\infra\main.bicep
az bicep lint --file .\capstone\incident-handoff-board\infra\main.bicep
az deployment group validate `
  --resource-group <team-resource-group> `
  --template-file .\capstone\incident-handoff-board\infra\main.bicep `
  --parameters .\capstone\incident-handoff-board\infra\main.example.bicepparam `
  teamIdentifier=<team-id>
az deployment group what-if `
  --name capstone-handoff-preview `
  --resource-group <team-resource-group> `
  --template-file .\capstone\incident-handoff-board\infra\main.bicep `
  --parameters .\capstone\incident-handoff-board\infra\main.example.bicepparam `
  teamIdentifier=<team-id>
```

`validate` and `what-if` require GitHub OIDC or another approved Azure login
for the assigned team resource group. Nothing has been deployed unless a real
workflow run or Azure command output proves it.
