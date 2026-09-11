## ADDED Requirements

### Requirement: Signal sources for every session

PTY-byte signals SHALL work at the server-owned terminal stream boundary for every session. Native foreground-process and journal signals SHALL be available for every session, because every session runs on the server that owns its project.

#### Scenario: Terminal session signals

- **WHEN** a session runs in a project
- **THEN** PTY-byte signals are parsed at the server-owned stream boundary

#### Scenario: Native signals

- **WHEN** foreground-process or journal evidence is needed for a session
- **THEN** the server's native foreground-process and journal signals are available for it

### Requirement: Foreground observation availability states

The activity snapshot SHALL identify foreground observation as `available` or `limited`. `limited` SHALL mean the session's observation cannot provide a current safe foreground answer and SHALL NOT mean that the terminal is idle.

#### Scenario: Observation cannot answer

- **WHEN** a session's observation cannot provide a current safe foreground answer
- **THEN** the snapshot reports `limited` and this is not treated as idle

## REMOVED Requirements

### Requirement: Environment-scoped signal sources

**Reason:** Project environments are removed; every session is a native session on the server that owns its project, so signal sources are not scoped by environment. Replaced by "Signal sources for every session".

**Migration:** None; there are no installed users. Reaching another machine means running a Terminay Server on it and connecting to it.

### Requirement: Foreground observation availability

**Reason:** `limited` was framed as the project environment being unable to answer; there is no environment. Replaced by "Foreground observation availability states".

**Migration:** None; there are no installed users.
