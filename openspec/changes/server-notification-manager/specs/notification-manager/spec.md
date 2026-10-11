## ADDED Requirements

### Requirement: The server owns every notification

Terminay Server SHALL hold every notification on that server in one notification manager, and that manager SHALL be the only part of the product that decides what a notification is, whether it exists, and when clients are told of it. A notification SHALL belong to exactly one terminal session, and its owning project and session SHALL be resolved by the server and never taken from a client or a caller's parameter. A notification SHALL have an opaque id unique on its server, a source, a kind, the time it was raised, and, for a notification a process sent, a title and body. Clients SHALL display the notifications the manager publishes and SHALL NOT derive a notification from terminal activity themselves.

#### Scenario: Two clients on one server

- **WHEN** a Desktop window and a browser client are connected to the same server
- **THEN** both show the same notifications in the same order with the same count

#### Scenario: A client cannot assign an owner

- **WHEN** a request to add or dismiss a notification names a project or session other than the one the server resolves for it
- **THEN** the request is refused and no notification changes

### Requirement: Terminals add and remove their notifications

A notification SHALL be added and removed only on behalf of its own terminal: by terminal activity, or by a process in that terminal calling the control endpoint. Terminal activity SHALL hold at most one notification per terminal, present exactly while that terminal is unacknowledged and either needs attention or has finished activity, with a kind of agent finished, agent waiting, agent blocked, command finished, or terminal needs attention. The parts of the server that add and remove notifications SHALL NOT carry any timing, publication, or delivery logic. A terminal SHALL be able to remove a notification it added at any moment after adding it, whether or not any client has been told of it. Closing a terminal SHALL remove its notifications.

#### Scenario: An agent finishes

- **WHEN** an agent in a terminal nobody is interacting with finishes its turn
- **THEN** the manager holds one agent-finished notification for that terminal

#### Scenario: The state changes kind

- **WHEN** a terminal with an agent-waiting notification has its agent finish
- **THEN** the same notification becomes agent finished and no second notification is created

#### Scenario: A working terminal

- **WHEN** a terminal is working and nothing needs attention or has finished unviewed
- **THEN** the manager holds no notification for it

#### Scenario: A terminal closes

- **WHEN** a terminal that has notifications is closed
- **THEN** its notifications are removed

### Requirement: A notification is published after a settle period

A notification SHALL be pending when it is added and SHALL be published to clients only when it has stayed present for a settle period of five seconds. A notification removed while pending SHALL never be published to any client, and no removal SHALL be published for it. Removing a published notification SHALL be published without delay. A change to a notification that already exists SHALL keep its publication state: a change to a published notification SHALL be published without delay, and a change to a pending notification SHALL NOT extend or restart its settle period. The settle period SHALL be armed by the addition and cancelled by the removal, and SHALL NOT be implemented by sampling state on an interval.

#### Scenario: Removed within the settle period

- **WHEN** a terminal adds a finished notification and the user types in that terminal three seconds later
- **THEN** no client is ever told of that notification

#### Scenario: Still present after the settle period

- **WHEN** a notification is still present five seconds after it was added
- **THEN** it is published to every connected client

#### Scenario: Removed after publication

- **WHEN** a published notification is removed
- **THEN** its removal is published at once

#### Scenario: A change before publication

- **WHEN** a notification added at second zero changes kind at second three and is still present at second five
- **THEN** it is published at second five with its current kind

#### Scenario: A change after publication

- **WHEN** a published agent-waiting notification becomes agent finished
- **THEN** every client shows the change at once and the notification is never absent in between

### Requirement: Status indicators are not delayed

The settle period SHALL apply only to notifications. A terminal's tab indicator and its project's activity dot SHALL continue to show working, waiting, blocked, and finished state as soon as the server reports it. The header Notifications count and list and the Desktop application icon badge SHALL show published notifications only.

#### Scenario: An agent starts waiting

- **WHEN** an agent in a background terminal starts waiting for the user
- **THEN** that terminal's tab indicator turns red at once, and the header Notifications count rises five seconds later if the agent is still waiting and unacknowledged

#### Scenario: Dealt with from the tab

- **WHEN** a user sees a terminal's red tab indicator and clicks into it within the settle period
- **THEN** the indicator clears and the header Notifications count never changes

### Requirement: Interaction removes a terminal's notifications

Acknowledging a terminal, by clicking its tab, clicking into it, typing into it, moving focus to it with a terminal navigation command, or the server-owned acknowledgement operation, SHALL remove every notification of that terminal, including any a process sent. Dismissing one notification SHALL remove that notification and no other. Where the user is when a notification is raised SHALL NOT remove it: a notification for the focused terminal, including one a process sent from the terminal the user has just typed in, SHALL be published after the settle period unless the user interacts with that terminal first. A notification a process sent SHALL NOT change its terminal's activity state or indicator. Removal SHALL be server-owned, so that a notification removed through one client is removed for every client. Activating a project SHALL NOT remove its terminals' notifications.

#### Scenario: Typing clears a sent notification

- **WHEN** a terminal has a notification an agent sent and the user types into that terminal
- **THEN** that notification is removed on every client

#### Scenario: Dismissing one of two

- **WHEN** a terminal has an agent-finished notification and a notification an agent sent, and the user dismisses the sent one from the list
- **THEN** the sent notification is removed and the agent-finished notification remains

#### Scenario: Sent while the user is in the terminal

- **WHEN** a process sends a notification from the focused terminal the user last typed in, and the user does nothing further in it
- **THEN** it is published after the settle period

#### Scenario: Sent, then the user types

- **WHEN** a process sends a notification from a terminal and the user types into that terminal within the settle period
- **THEN** it is never published

#### Scenario: Activating the project

- **WHEN** a user activates a project whose background terminal has a notification, without interacting with that terminal
- **THEN** the notification remains

### Requirement: Notification text sent by a process is bounded plain text

A notification a process sends SHALL carry a body of at most 280 characters and an optional title of at most 80 characters. The server SHALL store them as plain text with control characters and escape sequences removed, and every client SHALL render them as text. The text SHALL NOT be interpreted as markup, a link, or a command, SHALL NOT be written to any terminal, and SHALL NOT select or address anything. A notification a process sent SHALL always be shown together with its owning terminal's title and its project, resolved by the server. A terminal SHALL hold at most eight notifications a process sent, and sends SHALL be rate-limited per terminal. The message body of an `OSC 9` or `OSC 777` terminal notification SHALL NOT become notification text.

#### Scenario: Over-long text

- **WHEN** a process sends a notification whose body exceeds 280 characters
- **THEN** the call fails with a bounded error and no notification is added

#### Scenario: Text that looks like markup

- **WHEN** a process sends a notification whose body contains HTML and an escape sequence
- **THEN** the escape sequence is removed and the remaining characters are shown literally

#### Scenario: Text that names another terminal

- **WHEN** a process in `Terminal 1` sends a notification whose title is `Terminal 2`
- **THEN** its row still names `Terminal 1` and its project as the terminal it belongs to

#### Scenario: Too many

- **WHEN** a terminal already holds eight notifications a process sent and another is sent
- **THEN** the call fails with a bounded error and the existing eight are unchanged

#### Scenario: An OSC notification with a message

- **WHEN** a terminal emits `OSC 9` with a message body
- **THEN** the terminal's notification is of kind terminal needs attention and carries none of that message

### Requirement: Notification protocol surface

The protocol SHALL expose the published notifications as `notifications.snapshot` and `notifications.delta`, carried on the normal ordered event journal with the same contiguous-revision and resync rules as terminal activity. It SHALL accept `notifications.dismiss` only with the notification's id and the exact immutable project and session ids of its owner. Pending notifications SHALL NOT appear in a snapshot or a delta. A server SHALL advertise these as the `notifications.v1` feature capability, and a client connected to a server that does not advertise it SHALL derive its Notifications list from terminal activity. A project-scoped client SHALL receive only notifications of terminals in its scope. Every operation name SHALL be a valid wire operation name.

#### Scenario: A client connects during a settle period

- **WHEN** a client connects while a notification is pending
- **THEN** its snapshot does not contain that notification, and it receives the notification in a delta if it is published

#### Scenario: Dismiss with mismatched ids

- **WHEN** `notifications.dismiss` names a project or session other than the notification's own
- **THEN** the request is not accepted

#### Scenario: Replay gap

- **WHEN** a client detects a non-contiguous notification revision
- **THEN** it requests a fresh snapshot instead of applying the gap

#### Scenario: A server that does not publish notifications

- **WHEN** a client connects to a server that does not advertise `notifications.v1`
- **THEN** its Notifications list and count are derived from that server's terminal activity

### Requirement: Notifications are live server state

Notifications SHALL be held as live state of the running server and SHALL NOT be written into workspace state. After a server restart, a notification from terminal activity SHALL be re-established from the restored activity state and SHALL settle again before it is published, and a notification a process sent SHALL NOT be restored.

#### Scenario: Restart with an unacknowledged finished terminal

- **WHEN** the server restarts while a terminal has finished unacknowledged activity
- **THEN** that terminal's notification is published again once it has stayed present for the settle period

#### Scenario: Restart with a sent notification

- **WHEN** the server restarts while a terminal holds a notification a process sent
- **THEN** that notification is not present afterwards
