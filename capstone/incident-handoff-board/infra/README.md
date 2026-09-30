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

## Pipeline

`/.github/workflows/capstone-incident-handoff-deploy.yml` is manual-only and
defaults to **no Azure writes**.

- **Trigger:** `workflow_dispatch`
- **Input:** `mode` = `what-if` (default) or `deploy`
- **Jobs:**
  - `configuration` checks `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
    `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, and `TEAM_ID`. When any
    are missing, it writes `Azure deployment NOT performed: required OIDC
    variables are not configured` and the environment-gated job is skipped.
  - `deploy` is protected by the `capstone-incident-handoff` environment,
    builds and lints Bicep, logs into Azure with OIDC, and always runs
    `az deployment group what-if`.
- **Gates:** the environment gate and OIDC variables are required before any
  Azure call. `mode: deploy` is required before `az deployment group create`,
  `az webapp deploy`, and live smoke verification can run.
- **Artifacts:** deploy mode packages `package.json`, `package-lock.json`,
  `src/`, and `public/` into a zip and uploads it as the
  `capstone-incident-handoff-package` workflow artifact before `az webapp deploy`.
- **Failure / rollback:** if deploy mode fails after the app deployment step
  starts, the workflow writes rollback instructions to the step summary:
  redeploy the prior successful zip package with `az webapp deploy`, or rerun
  `az deployment group create` from the previous known-good commit.

For this PR's evidence, the deploy target was **LOCAL**: Azure was not used,
no workflow run reached the protected environment, and nothing has been run in
Azure.

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
workflow run or Azure command output proves it. If a live deploy fails after
uploading the application package, follow the workflow summary rollback
instructions and redeploy the previous known-good artifact or commit.
