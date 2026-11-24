## ADDED Requirements

### Requirement: Start-failure warning in Chat
When a user message cannot start its execution, the message SHALL keep the failure and its reason. Chat SHALL show a warning for that message with the reason and two controls, Dismiss and Retry. Chat SHALL show the warning only while the failure is not dismissed and no later user message in the log has started an execution. Deleting the message or clearing Chat SHALL remove its warning.

#### Scenario: A later message starts
- **WHEN** a message fails to start, and the user then sends another message that starts an execution
- **THEN** Chat no longer shows the first message's warning

#### Scenario: Several unresolved failures
- **WHEN** two messages fail to start and no later message has started
- **THEN** Chat shows a warning for each of them

#### Scenario: Deleting the failed message
- **WHEN** the user deletes a message whose start failed
- **THEN** its warning disappears

### Requirement: Dismissing a start failure
Dismiss SHALL be recorded on the message on the server, so the warning stays hidden on every client and after reloads and restarts. Every attached client SHALL observe the dismissal through message events.

#### Scenario: Dismiss
- **WHEN** the user dismisses a message's start-failure warning
- **THEN** the warning disappears, and stays hidden after Chat reloads, after a server restart and on another client

#### Scenario: Dismissed failure cannot be retried
- **WHEN** a client retries a message whose failure was dismissed
- **THEN** the request is refused as a conflict and no execution starts

### Requirement: Retrying a start failure
Retry SHALL start a fresh execution linked to the same message, without posting another message. Like a post, it SHALL act for the window of the client that asked. The message SHALL show as pending while it starts, then as started, or as failed with a new reason.

#### Scenario: Retry succeeds
- **WHEN** the user retries a message whose start failed, and the execution starts
- **THEN** the warning disappears, no new message is posted, and the new execution is linked to that message

#### Scenario: Retry fails again
- **WHEN** the user retries a message and the execution still cannot start
- **THEN** the warning stays, showing the new reason

#### Scenario: Restart during a retry
- **WHEN** the server restarts while a retried message is pending
- **THEN** the message becomes started if its retried execution exists, and failed with a reason otherwise, and no further execution starts on its own

### Requirement: Retry and Dismiss are guarded
Retry and Dismiss SHALL name the message's revision and the dispatch attempt the client observed. Only a message whose start failed and was not dismissed, at that revision and attempt, SHALL be retried or dismissed. Any other request SHALL be refused as a conflict without changing the message. Each accepted retry SHALL start a new attempt, so at most one retry is accepted per failure.

#### Scenario: Concurrent retries
- **WHEN** two retry requests naming the same failed attempt arrive together
- **THEN** exactly one is accepted and makes one start attempt, and the other is refused as a conflict

#### Scenario: Late retry after a failed retry
- **WHEN** a retry naming an earlier attempt arrives after a later attempt has already failed
- **THEN** it is refused as a conflict and no execution starts

#### Scenario: Message edited elsewhere
- **WHEN** a client retries a failed message whose text another client has since edited
- **THEN** the retry is refused as a conflict, and the client shows the current text

#### Scenario: Retry a message that did not fail
- **WHEN** a client asks to retry or dismiss a message that started, is pending, or was posted by the bot
- **THEN** the request is refused as a conflict and the message is unchanged
