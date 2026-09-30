## Why

Workshop users cannot tell new feedback from items being considered or completed, and editing the original request would lose context. Issue #1 asks for a lightweight status so the board communicates progress.

## What Changes

- Add an optional feedback status with exactly three values: `new`, `planned`, `done`.
- New feedback starts as `new`; existing stored feedback without a status reads as `new`.
- The board displays each item's status.
- Any workshop participant with access to the board can advance an item forward only (`new` -> `planned` -> `done`) through a documented, workshop-only, unauthenticated API/UI mechanism; no authorization is enforced or implied.
- Wording note: issue #1 says "optional status" and "authorized workshop user". Here every item always has a status (`new` when none is stored), and "authorized" means any participant with access to the board; see `design.md`.
- Skipping, reversing, repeating, or using unknown values is rejected with an actionable response; unknown identifiers create no data.
- Voting behavior and counts are unchanged.

## Capabilities

### New Capabilities

- `feedback-status`: status values, default, forward-only transitions, persistence, display, and accessible UI states.

### Modified Capabilities

None. The existing `feedback-application` capability is unchanged; all new behavior lives in `feedback-status`.

## Non-goals

Custom states, role-based access control or production authentication, status history, notifications, bulk updates, editing original request fields.

## Impact

- Application: `src/shared/contracts.ts`, `src/server/storage.ts`, `src/server/app.ts`, `src/client/api.ts`, `src/client/App.tsx`, `src/client/styles.css`.
- Tests: `tests/contracts.test.ts`, `tests/storage.test.ts`, `tests/api.test.ts`, `tests/App.test.tsx`.
- Harness: new `src/AGENTS.md` with local boundaries and focused validation.
- Documentation: workshop-only mechanism recorded in this change's `design.md`.
- Infrastructure, workflows, security configuration, dependencies: no change.
