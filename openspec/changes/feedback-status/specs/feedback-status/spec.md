## ADDED Requirements

### Requirement: Feedback status values and default

Every feedback item SHALL have a status that is exactly one of `new`, `planned`, or `done`. New feedback SHALL start as `new`, and stored feedback without a status SHALL be read as `new`.

#### Scenario: New item starts as new

- **WHEN** a user submits valid feedback
- **THEN** the created item is returned, listed, and displayed with status `new`

#### Scenario: Legacy item has no stored status

- **WHEN** an item persisted before this change is listed
- **THEN** it is returned with status `new`

### Requirement: Forward-only status transitions

A workshop user SHALL be able to move an item only to the next status in the sequence `new` -> `planned` -> `done`, and the new status SHALL persist.

#### Scenario: Valid forward transition persists

- **WHEN** a workshop user advances an item from `new` to `planned` (or `planned` to `done`)
- **THEN** the updated item is returned and the new status is still shown after the board is refreshed

#### Scenario: Legacy item can be advanced

- **WHEN** a workshop user advances an item that was persisted without a status
- **THEN** it moves from `new` to `planned`, keeps all its other fields and votes, and is listed as `planned`

#### Scenario: Concurrent duplicate advance

- **WHEN** two requests advance the same item from `new` to `planned` at the same time
- **THEN** exactly one succeeds and the other receives the conflict response, and the item is `planned` once

#### Scenario: Concurrent vote and status change

- **WHEN** a vote and a status advance for the same item happen at the same time
- **THEN** the stored item has both the new vote count and the new status

#### Scenario: Skipping a status is rejected

- **WHEN** a request moves an item from `new` directly to `done`
- **THEN** the request is rejected with a conflict response whose message names the only allowed next status, and the stored status is unchanged

#### Scenario: Reversing or repeating a status is rejected

- **WHEN** a request moves an item to an earlier status or to its current status
- **THEN** the request is rejected with the same actionable conflict response and the stored status is unchanged

#### Scenario: Unknown status value is rejected

- **WHEN** a request supplies a status other than `new`, `planned`, or `done`
- **THEN** the request is rejected with a validation error and the stored status is unchanged

#### Scenario: Unknown feedback identifier is rejected

- **WHEN** a status update targets an identifier that does not exist
- **THEN** the application responds that the feedback was not found and creates no data

### Requirement: Workshop-only update mechanism

Any workshop participant with access to the board SHALL be able to advance status. The mechanism SHALL require no production authentication, SHALL NOT imply that authorization is enforced, and SHALL be documented as workshop-only and unsuitable for production, without adding credentials, secrets, or infrastructure settings.

#### Scenario: Mechanism is documented and adds no secrets

- **WHEN** a reviewer inspects the change design and implementation diff
- **THEN** the unauthenticated workshop-only mechanism is documented and no infrastructure, workflow, or credential change is present

#### Scenario: Users see the workshop-only notice

- **WHEN** the board renders items with advance controls
- **THEN** a visible note states that the status control is workshop-only and open to anyone using the board

### Requirement: Voting is unaffected

Adding status SHALL NOT change voting behavior or vote counts.

#### Scenario: Status change keeps votes

- **WHEN** an item with votes is advanced
- **THEN** its vote count is unchanged and repeat-vote prevention for the same client identifier still applies

#### Scenario: Vote keeps status

- **WHEN** a user votes on an item that is `planned`
- **THEN** the item remains `planned` and the vote count increases by one

#### Scenario: Repeat vote on an advanced item

- **WHEN** the same client identifier votes again on an item after it was advanced
- **THEN** the vote count and status are unchanged and the response reports the vote already exists

### Requirement: Accessible status display and control

The board SHALL show status as text (not color alone) and SHALL provide a keyboard-operable, accessibly named control to advance an item, with accessible loading, success, and error states.

#### Scenario: Status is perceivable

- **WHEN** the board renders an item
- **THEN** its status text is exposed to assistive technology and is not conveyed by color alone

#### Scenario: Advance succeeds

- **WHEN** a user activates the advance control for an item
- **THEN** the item shows the new status and a polite status message naming the item announces the change, without reverting votes or status from any earlier response

#### Scenario: Advance in progress

- **WHEN** a user activates the advance control for one item
- **THEN** only that item's control is disabled and exposes a polite "Updating" state, and controls for other items remain usable

#### Scenario: Advance rejected by the server

- **WHEN** the server rejects a status update with an actionable error
- **THEN** an alert names the affected item and shows the message, the displayed status is unchanged, and the control is usable again

#### Scenario: Advance rate limited

- **WHEN** the status update receives a rate-limit response
- **THEN** the previous status is kept, an alert shows "Too many requests. Try again shortly.", and the control is usable again

#### Scenario: Advance fails on the network or returns a malformed body

- **WHEN** the request fails at the network level or the error response is not valid JSON
- **THEN** the previous status is kept, an alert shows a generic recovery message, and the control is usable again

#### Scenario: Stale status after a conflict

- **WHEN** a status update conflicts because the item was changed elsewhere (or by a concurrent vote)
- **THEN** the board reloads the list, shows the server's current status and vote count, and announces that the item changed

#### Scenario: Empty board

- **WHEN** the board loads with no feedback
- **THEN** the accessible empty state is shown and no advance controls exist

#### Scenario: Item is done

- **WHEN** an item's status is `done`
- **THEN** no advance control is offered for it
