## ADDED Requirements

### Requirement: Durable persistence behind a storage port

Handoffs SHALL be persisted through an application-owned storage interface that does not depend on UI or Azure SDK types. Tests SHALL use a deterministic in-memory adapter; the deployed application SHALL retain records across refreshes and restarts using a durable adapter.

#### Scenario: Records survive a new adapter instance

- **WHEN** a handoff is saved with the durable adapter, and a new adapter instance is created over the same backing store
- **THEN** the handoff is listed with identical fields

#### Scenario: Adapters share one contract

- **WHEN** the memory, file and Azure Table adapters are exercised with the same create, get, update and list operations
- **THEN** they return equivalent results, including for unknown identifiers

### Requirement: Liveness and dependency-aware readiness

`GET /health` SHALL report process liveness without touching storage. `GET /ready` SHALL return 200 only when the storage dependency is usable and 503 otherwise.

#### Scenario: Healthy process, unavailable storage

- **WHEN** the process runs but the storage check fails
- **THEN** `/health` is 200 and `/ready` is 503 with `checks.storage` reporting `unavailable`

#### Scenario: Ready

- **WHEN** storage is usable
- **THEN** `/ready` is 200 with `checks.storage` `ok`

### Requirement: Capstone-scoped CI

A workflow named for the capstone SHALL lint, test, build/start and smoke-test the app for changes under its paths with read-only repository permissions.

#### Scenario: CI proves the minimum workflow

- **WHEN** CI runs on a pull request touching the app
- **THEN** lint and tests run, and a started server passes `/health`, `/ready` and one create-to-acknowledge smoke path, with diagnostics uploaded on failure

### Requirement: AVM-first OIDC deployment with honest evidence

Infrastructure SHALL compose pinned Azure Verified Modules in a resource group, use a managed identity with only Storage Table data access, and deploy through GitHub OIDC and a protected environment without stored credentials. A deployment SHALL be reported only if a workflow run and live probes exist.

#### Scenario: Bicep compiles with pinned modules

- **WHEN** the infrastructure is built
- **THEN** `az bicep build` succeeds and every module reference carries an explicit version

#### Scenario: Azure not configured

- **WHEN** required OIDC variables or the protected environment are absent
- **THEN** the deploy workflow skips deployment with an explicit summary stating the limitation and does not report success of a deployment

### Requirement: Ticket-driven defect fix

A reproduced defect SHALL be tracked in a bug issue and fixed by a linked pull request containing a regression test that fails before and passes after the fix.

#### Scenario: Repeated acknowledgement defect

- **WHEN** the minimum is integrated and a handoff is acknowledged twice
- **THEN** the bug issue records the reproduction (second call returns 200 and changes `acknowledgedAt`) and the fix PR makes the "Repeated acknowledgement is rejected consistently" scenarios pass

### Requirement: Single-output GH-AW

A capstone GH-AW SHALL read issue, pull-request and check evidence and produce exactly one `add-comment` safe output, with no approval, merge, workflow-editing, policy-bypass or deployment authority. Source and generated lock SHALL be produced by `gh aw compile`.

#### Scenario: Lock matches source

- **WHEN** the workflow source is compiled
- **THEN** the committed lock file is identical to the compiler output and declares only read permissions plus one comment output

### Requirement: Transcript-free evidence

The parent issue SHALL link the OpenSpec change, task issues, pull requests, CI runs, deployment status or recorded limitation, bug issue and fix, and GH-AW result so a reviewer can reconstruct delivery without transcripts.

#### Scenario: First missing receipt is reported

- **WHEN** a fresh reviewer follows only the parent issue
- **THEN** every link resolves, and any missing or contradictory receipt is reported rather than inferred
