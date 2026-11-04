## MODIFIED Requirements

### Requirement: Bounded concurrent execution admission

The server SHALL admit four work executions and one reserved user-message coordination execution per bot, with at most twenty waiting executions. Distinct trigger events SHALL wait durably outside the twenty-entry execution admission queue and SHALL be admitted as slots open, under bot-triggers' pending-event bounds. A single trigger SHALL be able to contribute multiple distinct pending events; each accepted event SHALL create at most one automatic execution. Trigger work SHALL never occupy the reserved user-message coordination slot. Shared shell and desktop work SHALL require exclusive bot-scoped ownership independently of admission. Instructions, pinned memories, agent, model, sign-in and approval mode SHALL be snapshotted per execution. Completed providers SHALL close rather than remaining idle for later messages.

#### Scenario: Coordination while work capacity is full

- **WHEN** four work executions run and a user posts a correction
- **THEN** a reserved coordination execution can inspect, message or replace older work without first acquiring shared desktop ownership

#### Scenario: Profile edited during work

- **WHEN** a user edits the bot's instructions during an execution
- **THEN** that execution retains its snapshot and subsequent executions use the revised profile

#### Scenario: Several events from one trigger

- **WHEN** one trigger discovers three new items while the bot's execution queue is full
- **THEN** each event remains pending durably and is admitted separately as work capacity becomes available


## ADDED Requirements

### Requirement: Bot availability

A bot SHALL have a persisted enabled state, default enabled, independent of container state and individual trigger enabled states. Header and fleet card SHALL offer Disable/Enable and distinguish disabled from stopped/idle. Configuration and history SHALL remain accessible while disabled. Availability SHALL be revisioned and shared by authorized clients.

#### Scenario: Durable pause

- **WHEN** a disabled bot's server restarts
- **THEN** the bot stays disabled, no trigger wakes it and its configuration remains editable

### Requirement: Disabled bot execution boundary

Disable SHALL pause sources and automatic dispatch, cancel tests, prevent automatic wakes and retain definitions, memory and accepted undelivered events. Running sessions SHALL remain stoppable and SHALL not be silently killed. Manual chat, Run now and tests SHALL be refused with an Enable action. Pending events SHALL not prevent idle shutdown while disabled. Agent tools SHALL not enable a disabled bot.

#### Scenario: Disabled bot receives a message

- **WHEN** a user tries to send a new chat message to a disabled bot
- **THEN** execution is refused and the client offers Enable bot

### Requirement: Enabling bot observation

Enable SHALL resume previously accepted undelivered events and enabled sources without replaying the explicitly disabled period. Time schedules SHALL begin a new enabled boundary; observation sources SHALL establish fresh boundaries without emitting disabled-period activity. Enabling SHALL preserve individual trigger enabled states.

#### Scenario: Resume retained work

- **WHEN** a user enables a bot with accepted undelivered events and a disabled individual trigger
- **THEN** retained events for still-enabled triggers resume, disabled-period activity is not replayed and the disabled trigger stays disabled
