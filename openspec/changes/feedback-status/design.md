## Context

Issue #1 adds a forward-only status to feedback. This document is the change-local design; root `DESIGN.md` remains the durable architecture record. Constraints applied from root `DESIGN.md`: storage behind an interface with in-memory and Azure Table adapters, Express API plus React client in one App Service, managed identity, no long-lived credentials.

No durable architectural decision results from this change, so root `DESIGN.md` and ADRs are not updated.

## Decisions

### API shape

`PATCH /api/feedback/:id/status` with body `{ "status": "planned" }` returns 200 `{ feedback }`. Errors reuse `ApiError`:

- 400 `VALIDATION_ERROR` for a value outside `new|planned|done`.
- 404 `NOT_FOUND` for an unknown identifier (no data created).
- 409 `INVALID_STATUS_TRANSITION` for skip, reverse, or repeat; message names the only allowed next status (for example "Status can only move from new to planned.").

`status` is added to the `Feedback` response. `createFeedbackSchema` is unchanged so clients cannot choose an initial status.

### Forward rule lives in storage

The rule is enforced in `FeedbackStorage.updateStatus(id, next)` for both adapters, with a shared helper in `src/shared/contracts.ts`, so the API and UI cannot bypass or diverge from it. The UI hides the control at `done` as a convenience only.

### Persistence

Status is stored as a property on the existing feedback row. Storage normalizes at the boundary with `entity.status ?? "new"`; an unexpected stored status string is also read as `new` and never returned. No migration, table, or infrastructure change is needed. Seed items are `new`.

Azure mutation protocol for `updateStatus`:

1. Get the feedback row (partition = id, row key `feedback`); 404 maps to `FeedbackNotFoundError`.
2. Validate the transition against the freshly read (normalized) status.
3. Write the full retained entity plus `status` as a conditional replace using the fetched ETag (`If-Match`), never a blind replace, so a concurrent vote count cannot be overwritten.
4. On 412, refetch and re-evaluate (up to 4 attempts like votes). Return 409 `INVALID_STATUS_TRANSITION` only when the freshly read state makes the requested target invalid; otherwise retry.

Fake-`TableClient` tests assert the ETag condition is sent, 412 triggers refetch, a duplicate concurrent advance yields one success and one 409, a vote/status race preserves both, and a legacy entity without `status` advances with all other fields retained.

### Workshop-only update mechanism

Chosen: an open, unauthenticated endpoint with visible advance controls, usable by any workshop participant with access to the board, documented as workshop-only and not for production. The feature brief's phrase "authorized workshop user" is interpreted this way; the application enforces no authorization. It adds no secrets or settings and keeps infrastructure unchanged.

Alternatives:

- Shared facilitator token in an environment variable: closer to "authorized" but requires an app setting and secret handling in `infra/`, which this change excludes.
- UI-only "facilitator mode": cosmetic and could mislead participants about security.

Risk: anyone reaching the app can advance items. Mitigations: forward-only rule, existing rate limiting, no deletion or editing of the original request. A production version would require real authentication and is a separate change.

### UI

Each item shows a status text badge and, unless `done`, an advance button named for the target ("Mark planned" / "Mark done"). Only the activated item's button is disabled while busy and exposes a polite "Updating" state. Success uses `role="status"` and failures `role="alert"`, both naming the item. Vote controls are untouched.

Client reconciliation: update and vote results are merged per item so a late response cannot overwrite a newer status or vote count; the client applies only the fields its own operation changed. On a 409 the client reloads the list, shows the server's state, and announces that the item changed. `src/client/api.ts` tolerates network rejection and non-JSON error bodies and maps 429 to the server's retry message or a generic fallback.

### Observability

Log `status_changed` with exactly `id`, `from`, and `to` at info using the existing logger; no request body or personal data. An API test asserts the event name and fields. The existing rate limiter covers the route.

## Risks / Trade-offs

- Repeat submission is rejected (409), so a double click shows an error; the busy state prevents this in the UI.
- Forward-only with no history means a mistaken advance cannot be undone in the product; accepted because reversal is explicitly rejected by the issue.

## Infrastructure, AVM, identity

No Bicep, AVM, role assignment, workflow, or OIDC change.

## Rollback

Revert the code. The extra `status` property on stored rows is ignored by older code; no data migration is needed.

## Validation mapping

| Scenario group | Independent validation |
|---|---|
| Values/default, unknown value | `tests/contracts.test.ts`, `tests/storage.test.ts`, `tests/api.test.ts` |
| Forward/skip/reverse/unknown id | `tests/storage.test.ts`, `tests/api.test.ts`, `tests/App.test.tsx` |
| Legacy row, ETag, races, persistence | `tests/storage.test.ts` (Azure adapter with faked `TableClient`); refresh in `tests/api.test.ts` and `tests/App.test.tsx`; restart evidence in PR |
| Failure states (429, network, malformed body, stale 409), per-item busy, empty | `tests/App.test.tsx` |
| Logging | `tests/api.test.ts` (`status_changed` fields) |
| Voting unaffected | existing vote tests unchanged plus cross-checks in `tests/api.test.ts`, `tests/storage.test.ts` |
| Accessibility and states | `tests/App.test.tsx` |
| Workshop-only, no infra/secrets | this document; `git --no-pager diff --name-only` shows no `infra/` or `.github/workflows/` paths |
