## MODIFIED Requirements

### Requirement: Notification tools

Terminay SHALL expose three notification tools:

- `send_notification` SHALL take a body of at most 280 characters and an optional title of at most 80 characters, add a notification to the calling terminal, and return its opaque handle. Given the handle of a notification the calling terminal sent, it SHALL replace that notification's title and body in place and add no second notification.
- `list_notifications` SHALL return the published notifications of terminals the caller can address, each with an opaque handle, its kind, its title and body, and its terminal's handle. The result SHALL be bounded.
- `dismiss_notification` SHALL remove one notification by handle. The handle is one the calling terminal received from `send_notification`, or one `list_notifications` returned to the caller.

The tools SHALL address only notifications that belong to a terminal. `list_notifications` SHALL NOT return a bot notification, whatever the caller's reach, and no handle SHALL resolve to one.

Dismissing a notification that came from terminal activity SHALL acknowledge its terminal exactly as a user's dismissal from the Notifications list does. Dismissing a sent notification SHALL remove it for every client. A handle SHALL resolve only for a notification of a terminal the caller can address. A workspace-reach caller can therefore dismiss any terminal notification on its server, and a project-reach caller only those of its own project.

`send_notification` SHALL need a calling terminal. `list_notifications` and `dismiss_notification` SHALL NOT need one. All three SHALL be operations of the local control endpoint, dispatched with the resolved scope of the capability that called, so that any process holding that capability can call them and the stdio adapter only presents them as tools. The owning terminal of a sent notification SHALL be resolved from the capability and SHALL NOT be a parameter. The tools' descriptions SHALL tell the agent the following:

- a sent notification is shown to the user only if it is still present after a short settle period;
- a sent notification is removed when the user interacts with the terminal, including within that period.

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

#### Scenario: Pixel clears an agent-finished notification

- **WHEN** Pixel lists notifications and dismisses an agent-finished notification of a terminal in project "web"
- **THEN** that terminal is acknowledged on every client and its tab dot clears

#### Scenario: Handle from another terminal

- **WHEN** an agent in project "api" calls `dismiss_notification` with a handle of a notification belonging to a terminal in project "web"
- **THEN** the call fails as not found and no notification is removed

#### Scenario: A terminal's activity notification

- **WHEN** an agent calls `dismiss_notification` with the handle `list_notifications` gave it for its own terminal's agent-finished notification
- **THEN** that terminal is acknowledged and the notification is removed for every client

#### Scenario: Called over the socket without an MCP client

- **WHEN** a process in a terminal sends the send-notification operation to the control endpoint with that terminal's capability
- **THEN** a notification is added to that terminal exactly as the tool adds one

#### Scenario: Body too long

- **WHEN** an agent calls `send_notification` with a body over 280 characters
- **THEN** the call fails with a bounded error and no notification is added

#### Scenario: Bot notifications are not listed

- **WHEN** the bot Bird's notification is published and a workspace-reach caller calls `list_notifications`
- **THEN** the result holds no entry for Bird

#### Scenario: A bot notification's id is not a handle

- **WHEN** a workspace-reach caller passes the id of Bird's notification to `dismiss_notification`
- **THEN** the call fails as not found and Bird's notification remains
