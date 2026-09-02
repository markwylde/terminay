## ADDED Requirements

### Requirement: foregroundBusy in the activity snapshot

The canonical activity snapshot and its change events SHALL expose a validated `foregroundBusy` boolean that is true only while the PTY host reports that a process other than the spawned shell owns the foreground process group. Unlike the presentation-oriented `working` status, `foregroundBusy` SHALL NOT be suppressed by provider authority, command completion signals, acknowledgement, output timers, or activity-indicator settings. Clients SHALL use it solely for destructive close protection and SHALL NOT infer it from output.

#### Scenario: Non-shell process owns the foreground group

- **WHEN** the PTY host reports a process other than the spawned shell owning the foreground process group
- **THEN** `foregroundBusy` is true regardless of provider authority, completion signals, acknowledgement, output timers, or indicator settings

#### Scenario: Idle shell prompt

- **WHEN** the spawned shell itself owns the foreground process group
- **THEN** `foregroundBusy` is false even if the terminal recently produced output

#### Scenario: Client use of foregroundBusy

- **WHEN** a client evaluates destructive close protection
- **THEN** it uses `foregroundBusy` and does not infer it from terminal output

### Requirement: Helper children do not make a session look idle

Helper children of a non-shell foreground process SHALL NOT cause the session to report as idle.

#### Scenario: Silent interactive process with helpers

- **WHEN** a non-shell foreground process has helper children and produces no output
- **THEN** the session still reports `foregroundBusy`
