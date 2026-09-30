# Tasks

Receipts: each PR body has a "Task receipt" (issue, owned paths, dependency state, branch, commit, validation command and result, PR). App root `APP=capstone/incident-handoff-board`. Local validation: `cd capstone/incident-handoff-board; npm run check`.

| Task | Issue | Depends on | Owned paths |
|---|---|---|---|
| 1 Contract, port, toolchain | #8 | spec PR | `APP/package*.json`, config, `APP/src/contract/**`, `APP/src/storage/{port,memory}.js`, `APP/tests/contract/**`, `APP/tests/storage/memory.test.js` |
| 2 API + adapters | #9 | 1 | `APP/src/server/**`, `APP/src/storage/{file,table}.js`, `APP/tests/api/**`, `APP/tests/storage/{file,table}.test.js` |
| 3 Accessible UI | #10 | 1 | `APP/public/**`, `APP/tests/ui/**` |
| 4 CI + smoke | #11 | 1, 2, 3 | `.github/workflows/capstone-incident-handoff-ci.yml`, `APP/scripts/smoke.mjs` |
| 5 AVM infra + OIDC deploy | #12 | 1 | `APP/infra/**`, `.github/workflows/capstone-incident-handoff-deploy.yml` |
| 6 Defect fix | bug issue (filed after 1-5 integrate) | 1-5 | `APP/src/contract/handoff.js`, `APP/src/server/**`, related regression tests |
| 7 GH-AW | task issue (filed after 6) | 6 | `.github/workflows/capstone-handoff-evidence.{md,lock.yml}` |
| 8 Evidence reconstruction | parent issue comment | all | no repository files |

## 1. Contract, storage port, toolchain (#8)
- [x] 1.1 Handoff validation and `acknowledge` transition with tests
- [x] 1.2 Storage port and memory adapter with tests
- [x] 1.3 Manifest, lockfile, eslint, vitest, README; `npm run check` passes

## 2. API and adapters (#9)
- [x] 2.1 Create/list/acknowledge/errors with API tests
- [x] 2.2 `/health`, `/ready` (dependency-aware) with tests
- [x] 2.3 File and Azure Table adapters with adapter tests (table via fake client)

## 3. Accessible UI (#10)
- [x] 3.1 Create form, list, acknowledge, states, live regions
- [x] 3.2 UI tests for loading, empty, success, validation, failure, acknowledgement

## 4. CI (#11)
- [x] 4.1 Capstone CI with smoke script; passing run linked in PR

## 5. Infra and deployment (#12)
- [x] 5.1 Pinned AVM Bicep; `az bicep build` passes
- [x] 5.2 OIDC deploy workflow with config guard; limitation recorded if unconfigured

## 6. Defect loop
- [x] 6.1 Reproduce, file bug issue linked to #7
- [x] 6.2 Fix with failing-before/passing-after regression test in linked PR

## 7. GH-AW
- [x] 7.1 Source + lock via `gh aw compile`; one `add-comment` output; run receipt

## 8. Evidence
- [ ] 8.1 Transcript-free reconstruction comment on #7 reporting first missing/contradictory receipt
