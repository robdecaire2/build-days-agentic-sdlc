## ADDED Requirements

### Requirement: Handoff entity

A handoff SHALL have a generated `id`, a `service` (1-80 chars after trimming), a `summary` (1-500), a `nextAction` (1-500), a `state` of exactly `open` or `acknowledged`, `createdAt`, `updatedAt` (ISO-8601 UTC) and `acknowledgedAt` (timestamp or null). New handoffs are `open` with `acknowledgedAt` null.

#### Scenario: Valid input creates an open handoff

- **WHEN** a valid service, summary and next action are submitted
- **THEN** a handoff is created with state `open`, `acknowledgedAt` null, and `createdAt` equal to `updatedAt`

#### Scenario: Invalid input is rejected with field details

- **WHEN** a field is missing, blank after trimming, not a string, or longer than its limit
- **THEN** nothing is created and the response is HTTP 400 with code `validation_failed` and a per-field `details` list naming each offending field and what to fix

### Requirement: Create and list handoffs via API

The API SHALL create handoffs with `POST /api/handoffs` (201) and list them with `GET /api/handoffs` (200) ordered newest `createdAt` first, ties broken by `id` ascending.

#### Scenario: Created handoff appears in the list

- **WHEN** a handoff is created and the list is requested
- **THEN** the list contains it, and multiple handoffs appear in deterministic order

#### Scenario: Empty board

- **WHEN** no handoffs exist
- **THEN** the list is HTTP 200 with an empty `handoffs` array

### Requirement: Acknowledge an open handoff

`POST /api/handoffs/{id}/acknowledge` SHALL move an existing `open` handoff to `acknowledged`, set `acknowledgedAt` and `updatedAt`, and persist the change.

#### Scenario: Open handoff is acknowledged

- **WHEN** an open handoff is acknowledged
- **THEN** the response is HTTP 200 with state `acknowledged` and a non-null `acknowledgedAt`, and a later list shows the same state

#### Scenario: Unknown identifier

- **WHEN** an unknown or malformed identifier is acknowledged
- **THEN** the response is HTTP 404 with code `not_found` and no data is created or changed

### Requirement: Repeated acknowledgement is rejected consistently

A handoff that is already `acknowledged` SHALL NOT be changed by another acknowledgement attempt. The attempt SHALL receive HTTP 409 with code `already_acknowledged`, and the original `acknowledgedAt` and `updatedAt` SHALL be retained. This requirement is delivered by the defect-fix task after the minimum workflow is integrated.

#### Scenario: Second acknowledgement does not overwrite the first

- **WHEN** an already acknowledged handoff is acknowledged again
- **THEN** the response is HTTP 409 `already_acknowledged` and the stored `acknowledgedAt` and `updatedAt` equal their values after the first acknowledgement

#### Scenario: Repeated attempts are consistent

- **WHEN** the same handoff is acknowledged three times
- **THEN** the first succeeds and the second and third each return the identical 409 response

### Requirement: Accessible board UI

The UI SHALL provide a keyboard-operable create form and handoff list with labelled inputs, a clearly named submit action, visible text for loading, empty, success, validation and failure states, state shown as text (not colour alone), and focus or live-region announcements for updates.

#### Scenario: Loading and empty states

- **WHEN** the board is loading, then returns no handoffs
- **THEN** a loading status is shown first and then an empty-state message

#### Scenario: Inline validation is associated with the input

- **WHEN** a field is invalid on submit (client-side or API `validation_failed`)
- **THEN** an error message is linked to that input with `aria-describedby`, the input has `aria-invalid="true"`, and focus moves to the first invalid input

#### Scenario: Create succeeds

- **WHEN** a valid form is submitted
- **THEN** a success message is announced in a live region, the form is cleared, and the new handoff is listed as "Open"

#### Scenario: API failure preserves input

- **WHEN** the API request fails or the network is unavailable
- **THEN** a recoverable error alert is shown, the entered values remain in the form, and the user can retry

#### Scenario: Acknowledge from the board

- **WHEN** the user activates "Acknowledge" on an open handoff with the keyboard
- **THEN** the item shows the text "Acknowledged" with its time, the button is removed, and a success message is announced

#### Scenario: Acknowledgement conflict or failure is perceivable

- **WHEN** acknowledging returns an error (409, 404, or network)
- **THEN** an alert names the problem and the list is refreshed from the API
