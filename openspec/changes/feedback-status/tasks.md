# Tasks

## Conventions

- **Branches and PRs:** one branch `feedback-status/task-<n>-<slug>` and one pull request per task, from current `main` into `main` of `robdecaire2/build-days-agentic-sdlc`. Use `Refs #1`, never a closing keyword, and the repository PR template.
- **"Task N merged":** its PR is merged into `main` with required checks passing. Later tasks branch from or rebase onto that `main`.
- **Receipts:** put a "Task receipt" section in the task's PR body and post a short comment on issue #1 linking the PR. The transcript is not evidence. Receipt format:

  ```text
  Task: <n> <title>
  Session / branch / commit: <session id> / <branch> / <sha>
  Changed paths: <list, all within the owned paths>
  Scenarios covered -> tests: <scenario> -> <test file>::<test name>
  Validation run: <exact command> -> <passed|failed|unrun + reason>
  Pull request / dependency state: <PR link> / <merged tasks>
  Follow-ups: <issue links or none>
  ```

- **Prohibited for every task:** `infra/`, `.github/workflows/`, `package.json`, `package-lock.json`, `DESIGN.md`, and `docs/features/feedback-status.md`.

## Dependency table

| Task | Depends on (merged) | Can run in parallel with | Primary owned paths |
|---|---|---|---|
| 0 Specification PR | none | none | `openspec/changes/feedback-status/**`, `src/AGENTS.md` |
| 1 Shared contract | 0 | none | `src/shared/contracts.ts`, `tests/contracts.test.ts` |
| 2 Storage | 1 | 4 | `src/server/storage.ts`, `tests/storage.test.ts` |
| 3 API | 1, 2 | 4 | `src/server/app.ts`, `tests/api.test.ts` |
| 4 React UI | 1 | 2, 3 | `src/client/api.ts`, `src/client/App.tsx`, `src/client/styles.css`, `tests/App.test.tsx` |
| 5 Evidence | 2, 3, 4 | none | PR body and issue #1 comment only (no repository files) |
| 6 Final gate | 5 | none | none (no edits) |

Fleet may run tasks 2 and 4 in parallel only after task 1 is merged; task 3 starts after task 2 is merged. No two tasks own the same file. Ownership of the error code: the `InvalidStatusTransitionError` class is task 2 and the `INVALID_STATUS_TRANSITION` code string and 409 mapping are task 3 (see `design.md`).

## 0. Specification PR (this PR)

- [x] 0.1 Add the OpenSpec change `feedback-status` (proposal, spec, design, tasks).
- [x] 0.2 Add `src/AGENTS.md` (contract-first order, adapter parity, focused commands). Delivered in this PR; no implementation task depends on it.

## 1. Shared status contract

- [ ] 1.1 Add `feedbackStatuses`, `FeedbackStatus`, `nextStatus` helper, `updateStatusSchema`, and `status` on `Feedback`.
- [ ] 1.2 Test enum, unknown value, and the next-status helper. Validate: `npm test -- tests/contracts.test.ts` and `npm run typecheck`.

## 2. Storage behavior

- [ ] 2.1 Normalize missing or unexpected status to `new` (`entity.status ?? "new"`); default `new` on create and seed; add `updateStatus` and `InvalidStatusTransitionError` (carries from, to, allowed next, and the actionable message) to both adapters (Azure: fetch, validate, conditional replace with the ETag retaining all fields, refetch and re-evaluate on 412).
- [ ] 2.2 Test forward, skip, reverse, repeat, unknown id (no data created), legacy advance with fields retained, ETag condition sent, 412 refetch, concurrent duplicate (one success, one 409-equivalent error), vote/status race, votes unchanged. Validate: `npm test -- tests/storage.test.ts` and `npm run typecheck`.

## 3. API endpoint

- [ ] 3.1 Add `PATCH /api/feedback/:id/status` after the rate-limit middleware, with 400/404/409 mapping (`INVALID_STATUS_TRANSITION` for `InvalidStatusTransitionError`) and the `status_changed` log.
- [ ] 3.2 Test create returns `new`, advance then list, rejections, unknown id, a request over the rate limit gets 429 without touching storage, and the `status_changed` log has exactly `id`, `from`, `to`. Vote interplay means all three: (a) after advancing an item, a first vote by a new client returns the count plus one with the status unchanged; (b) after a vote, advancing leaves the vote count unchanged; (c) a repeat vote by the same client after advancing returns the already-voted response with count and status unchanged. Validate: `npm test -- tests/api.test.ts`, then `npm run typecheck`.

## 4. React display and control

Tests mock fetch using the API shape in `design.md`.

- [ ] 4.1 Add `updateFeedbackStatus`; make `api.ts` tolerate network failure, non-JSON bodies, and 429; add the status text badge, advance button, workshop-only note, per-item busy/success/error states, per-item merge of vote and status results, and reload on 409.
- [ ] 4.2 Test display, advance, refresh, per-item "Updating" state, server error alert naming the item, 429, network failure, malformed body, stale 409 reload, late vote response not reverting status, workshop-only note, empty board with no controls, no control at `done`, accessible names. Validate: `npm test -- tests/App.test.tsx` and `npm run typecheck`.

## 5. Evidence

- [ ] 5.1 Tasks 2-4 each supply their receipt (format above) before assembly.
- [ ] 5.2 Assemble the final evidence checklist (comment on issue #1 and last PR body): scenario-to-test map with results, workshop-only disclosure, manual persistence-after-refresh and application-restart procedure with result, and no `infra/` or workflow paths. Validate with: `git --no-pager diff --check`; `git --no-pager diff --name-only main...HEAD` (output contains no `infra/` or `.github/workflows/` path); `npm test`.

## 6. Final gate

- [ ] 6.1 Run `npm run check` (lint, typecheck, test, build) and `openspec validate --all`. Report real results and mark anything unrun as unrun.
