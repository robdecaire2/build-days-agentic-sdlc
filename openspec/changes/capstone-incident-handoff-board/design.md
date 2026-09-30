## Context

Root `DESIGN.md` requires: repository as system of record, inward dependency direction (contracts <- API <- adapters), executable constraints, least-privilege workflows, AVM + OIDC, honest evidence. The feedback app (`src/**`) is an architectural reference only and MUST NOT be modified. `capstone/AGENTS.md` assigns one subtree to the app and requires capstone-named root-level workflow files, recorded here.

## Decisions

1. **Plain JavaScript (ESM, JSDoc), Node 22, Express 5.** Rationale: smallest toolchain within the time box, no build step, independent `package.json`. Alternative: TypeScript + React like the reference app (rejected: build step and client bundling add risk without serving the brief). Node 22 matches the App Service runtime.
2. **Vanilla-JS UI served as static files** from `public/`, with `mountBoard(root, { fetch })` so UI tests run in jsdom against a mocked API. Alternative React: rejected as above.
3. **Hand-written validation** in `src/contract/handoff.js` (no schema library): three short fields. Contract depends on nothing.
4. **Storage port** (`src/storage/port.js`, documented by JSDoc): `create(handoff)`, `get(id)`, `list()`, `update(id, mutator)` (mutator receives current, returns next; adapter applies it atomically for its medium, returns `null` for unknown id), `ping()` (throws when unusable). Adapters: memory (tests), file (local durable, JSON, serialized writes), Azure Table (deployed; ETag-checked replace with retry; `DefaultAzureCredential` = managed identity). Storage selected by `STORAGE_BACKEND=memory|file|azure`.
5. **Error contract**: `{ "error": { "code", "message", "details?" } }`; codes `validation_failed` (400), `not_found` (404), `already_acknowledged` (409), `storage_unavailable` (503).
6. **Planned defect (brief-mandated).** The brief requires a repeated-acknowledgement defect to be found *after* the minimum workflow is integrated and fixed from a bug issue in a fresh session. The minimum (Task 1 `acknowledge()` transition) therefore implements only the `open -> acknowledged` transition and does not yet guard against an already-acknowledged handoff; Task 2 does not add that guard. This is a disclosed, scoped gap, not an accident: the requirement and scenarios for repeated acknowledgement are in the spec, are covered by the defect-fix PR, and are expected to be *absent* from the minimum PRs' tests. The bug issue records reproduction against the integrated minimum.
7. **Delivery.** CI `capstone-incident-handoff-ci.yml` (paths-filtered, `contents: read`). Deploy `capstone-incident-handoff-deploy.yml` (manual dispatch; job-level `id-token: write`; `environment: capstone-incident-handoff`; a guard step skips all Azure steps when `vars.AZURE_CLIENT_ID/TENANT_ID/SUBSCRIPTION_ID/AZURE_RESOURCE_GROUP` are unset and writes the limitation into the run summary). Workflow files live in `.github/workflows/` because GitHub requires it; both are capstone-named (exception recorded per `capstone/AGENTS.md`).
8. **Infrastructure** (`capstone/incident-handoff-board/infra/`): reuse the repo's AVM pins (storage-account 0.33.1, workspace 0.16.1, insights/component 0.8.0, serverfarm 0.7.0, web/site 0.24.0) for a dedicated Linux web app and a `Handoffs` table; shared-key disabled; system-assigned identity with Storage Table Data Contributor via the same documented native role-assignment exception (circular-dependency module gap) as `infra/README.md`. Code is deployed with `az webapp deploy` (Entra token) of a zip; SCM basic auth stays disabled.
9. **GH-AW** `capstone-handoff-evidence`: `workflow_dispatch` with issue number; `contents/issues/pull-requests/actions: read`; toolsets context, repos, issues, pull_requests; safe output `add-comment: max: 1`. Compiled with `gh aw compile`.
10. **Stretch** (open/acknowledged filter) is out of the minimum.

## Constraint from repository policy

`spec-pr-policy.yml` governs `.github/workflows/*`, so workflow PRs must link the merged specification PR. App paths under `capstone/` are not governed paths, but every PR still links this change.

## Risks and recovery

- No GitHub environments, variables or secrets exist on the fork, so a live Azure deployment is presumed unavailable. Recovery: keep bicep build + CI smoke evidence, record the limitation, do not claim a deployment; creating Azure resources in a personal subscription is out of scope.
- GH-AW real runs need a Copilot engine token secret; if absent the run fails at activation and this is recorded.
- Parallel PRs: manifests have one owner (Task 1). Rollback: revert the task PR; tasks are independently revertable in reverse dependency order.

## Dependency graph

Spec PR -> Task 1 -> {Task 2, Task 3, Task 5} (parallel) -> Task 4 -> integrated minimum -> Task 6 (defect) -> Task 7 (GH-AW) -> Task 8 (evidence).
