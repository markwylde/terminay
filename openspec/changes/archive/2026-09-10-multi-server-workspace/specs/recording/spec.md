## ADDED Requirements

### Requirement: Recordings surface selects a server

The Recordings surface SHALL carry a server selector listing every attached
connection, defaulting to the server that owns the active project tab. It SHALL
list, replay, and delete only recordings of the selected server, and SHALL NEVER
present two servers' recordings as one list. Selecting a connection that is
unavailable or incompatible SHALL show that connection's state instead of
recordings.

#### Scenario: Default selection

- **WHEN** the user opens Recordings while a project of an attached server is
  active
- **THEN** the selector starts on that server and lists that server's recordings

#### Scenario: Recordings are not merged

- **WHEN** two attached servers each hold recordings
- **THEN** the surface lists only the selected server's recordings

#### Scenario: Replay stays on its server

- **WHEN** the user replays or deletes a recording
- **THEN** the read or delete is issued only on the server that holds it

## MODIFIED Requirements

### Requirement: Recording surfaces require the canonical client

The timeline and terminal recording controls SHALL require the canonical `RecordingsClient` of the connection whose server owns the terminal or recording they act on. They SHALL NEVER consult a Desktop recording-service global, translate legacy host method names, or subscribe to a host-local recording state stream. A missing recordings capability on that connection SHALL be a typed unavailable state, and canonical workspace reconciliation SHALL own recording state.

#### Scenario: Server lacks recording capability
- **WHEN** the selected server does not provide the recordings capability
- **THEN** a typed unavailable state is shown rather than falling back to a host-local recording service

#### Scenario: Controls follow the terminal's server
- **WHEN** the user starts or stops recording on a terminal of an attached server
- **THEN** the command is issued through that server's `RecordingsClient` and no other attached connection receives it
