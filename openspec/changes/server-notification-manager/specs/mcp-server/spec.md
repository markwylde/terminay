## ADDED Requirements

### Requirement: Notification tools

Terminay SHALL expose two tools that act on the calling terminal's notifications. `send_notification` SHALL take a body of at most 280 characters and an optional title of at most 80 characters, add a notification to the calling terminal, and return its opaque handle; given the handle of a notification the calling terminal sent, it SHALL replace that notification's title and body in place and add no second notification. `dismiss_notification` SHALL remove one notification the calling terminal sent, by handle. A notification handle SHALL be valid only for the terminal that sent the notification, and neither tool SHALL list, change, or remove a notification that came from terminal activity or belongs to another terminal. Both SHALL be operations of the local control endpoint, dispatched with the resolved scope of the capability that called, so that any process in the terminal holding that capability can call them and the stdio adapter only presents them as tools. The owning terminal SHALL be resolved from the capability and SHALL NOT be a parameter. The tools' descriptions SHALL tell the agent that a notification is shown to the user only if it is still present after a short settle period, and that it is removed when the user interacts with the terminal, including within that period.

#### Scenario: Sending a notification

- **WHEN** an agent calls `send_notification` with the title `Review ready` and the body `Three files changed`
- **THEN** a notification with that text is added to the calling terminal and the call returns its handle

#### Scenario: Updating a notification

- **WHEN** an agent calls `send_notification` with the handle of a notification it sent and a new body
- **THEN** the same notification carries the new body and no second notification is added

#### Scenario: Dismissing a notification

- **WHEN** an agent calls `dismiss_notification` with the handle of a notification it sent
- **THEN** that notification is removed for every client

#### Scenario: Sent and dismissed quickly

- **WHEN** an agent calls `send_notification` and then `dismiss_notification` with its handle two seconds later
- **THEN** no client is ever shown that notification

#### Scenario: Handle from another terminal

- **WHEN** an agent calls `dismiss_notification` with a handle that belongs to another terminal
- **THEN** the call fails as not found and no notification is removed

#### Scenario: A terminal's activity notification

- **WHEN** an agent calls `dismiss_notification` naming its own terminal's agent-finished notification
- **THEN** the call fails as not found and that notification remains

#### Scenario: Called over the socket without an MCP client

- **WHEN** a process in a terminal sends the send-notification operation to the control endpoint with that terminal's capability
- **THEN** a notification is added to that terminal exactly as the tool adds one

#### Scenario: Body too long

- **WHEN** an agent calls `send_notification` with a body over 280 characters
- **THEN** the call fails with a bounded error and no notification is added
