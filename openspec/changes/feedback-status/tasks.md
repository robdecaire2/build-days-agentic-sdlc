# Tasks

Dependency order: 1 -> (2 -> 3) in parallel with 4 -> 5 -> 6. Run Fleet only after task 1 is merged. Do not edit `infra/`, `.github/workflows/`, or `package.json`.

## 1. Shared status contract

Owns: `src/shared/contracts.ts`, `tests/contracts.test.ts`.

- [ ] 1.1 Add `feedbackStatuses`, `FeedbackStatus`, `nextStatus` helper, `updateStatusSchema`, and `status` on `Feedback`.
- [ ] 1.2 Test enum, unknown value, and next-status helper. Validate: `npm test -- tests/contracts.test.ts` and `npm run typecheck`.

## 2. Storage behavior

Owns: `src/server/storage.ts`, `tests/storage.test.ts`. Depends on 1.

- [ ] 2.1 Normalize missing/unexpected status to `new` (`entity.status ?? "new"`); default `new` on create and seed; add `updateStatus` with `InvalidStatusTransitionError` to both adapters (Azure: fetch, validate, conditional replace with ETag retaining all fields, refetch and re-evaluate on 412).
- [ ] 2.2 Test forward, skip, reverse, repeat, unknown id (no data created), legacy advance with fields retained, ETag condition sent, 412 refetch, concurrent duplicate (one success, one 409), vote/status race, votes unchanged. Validate: `npm test -- tests/storage.test.ts`.

## 3. API endpoint

Owns: `src/server/app.ts`, `tests/api.test.ts`. Depends on 1, 2.

- [ ] 3.1 Add `PATCH /api/feedback/:id/status` with 400/404/409 mapping and `status_changed` log.
- [ ] 3.2 Test create returns `new`, advance then list, rejections, unknown id, vote interplay, and the `status_changed` log event has exactly `id`, `from`, `to` with no personal data. Validate: `npm test -- tests/api.test.ts`.

## 4. React display and control

Owns: `src/client/api.ts`, `src/client/App.tsx`, `src/client/styles.css`, `tests/App.test.tsx`. Depends on 1; tests mock fetch using the API shape in `design.md`.

- [ ] 4.1 Add `updateFeedbackStatus`; make `api.ts` tolerate network failure, non-JSON bodies, and 429; add status text badge, advance button, per-item busy/success/error states, per-item merge of vote/status results, and reload on 409.
- [ ] 4.2 Test display, advance, refresh, per-item "Updating" state, server error alert naming the item, 429, network failure, malformed body, stale 409 reload, late vote response not reverting status, empty board with no controls, no control at `done`, accessible names. Validate: `npm test -- tests/App.test.tsx`.

## 5. Harness and evidence

Owns: `src/AGENTS.md`, PR description. Depends on 2-4 for evidence; `src/AGENTS.md` has no dependency.

- [x] 5.1 Add `src/AGENTS.md` (contract-first order, adapter parity, focused commands); keep accurate.
- [ ] 5.2 Before assembling evidence, tasks 2-4 each post exact scenario/test names and command output summaries. Then complete a PR checklist: scenario-to-test map with results, workshop-only mechanism disclosure, manual persistence-after-refresh and application-restart procedure with result, and confirmation of no `infra/` or workflow paths. Validate: `git --no-pager diff --check` plus the completed checklist.

## 6. Final gate

No file ownership.

- [ ] 6.1 Run `npm run check` and `openspec validate --all`; confirm `git --no-pager diff --name-only` contains no `infra/` or `.github/workflows/` paths. Report real results.
