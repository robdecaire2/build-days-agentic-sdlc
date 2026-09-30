## Why

On-call ownership is lost when it lives in chat history. The optional capstone (issue #7, brief `docs/capstone/incident-handoff-board.md`) asks for a net-new app where one engineer records a handoff and the next acknowledges it, with a complete, transcript-free evidence chain.

## What Changes

- New application `capstone/incident-handoff-board/`: one entity (Handoff, states `open`, `acknowledged`) and one workflow (create, list, acknowledge).
- HTTP API, accessible browser UI (loading, empty, success, validation, failure), storage port with memory, file and Azure Table adapters, `/health` and dependency-aware `/ready`.
- Capstone-scoped CI, AVM/OIDC deployment design and workflow, a ticket-driven defect fix, and one GH-AW with a single safe output.
- Repeated-acknowledgement handling is deliberately delivered by the defect-fix task (see `design.md`), as the brief prescribes.

## Capabilities

### New Capabilities

- `handoff-board`: entity, API, UI behaviour, repeated-acknowledgement rule.
- `handoff-delivery`: persistence, liveness/readiness, CI, infrastructure and deployment, GH-AW, evidence.

### Modified Capabilities

None. The feedback application and its capabilities are untouched.

## Non-goals

Incident paging, alert ingestion, chat integrations, escalation, authentication/authorization, comments, attachments, audit export, analytics, multi-team routing. Stretch (open/acknowledged filter) is deferred.

## Impact

- Application, tests, infra: only beneath `capstone/incident-handoff-board/`.
- Workflows (platform-required root locations, capstone-named): `capstone-incident-handoff-ci.yml`, `capstone-incident-handoff-deploy.yml`, `capstone-handoff-evidence.md` and its generated `.lock.yml`.
- Documentation: app README/AGENTS.md. No change to `src/**`, existing `tests/**`, existing workflows, root `DESIGN.md`, or `openspec/changes/feedback-status/**`.
