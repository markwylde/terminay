## MODIFIED Requirements

### Requirement: Recording surfaces require the canonical client

The timeline and terminal recording controls SHALL require the canonical `RecordingsClient` of the window's connection, whose server owns the terminal or recording they act on. They SHALL NEVER consult a Desktop recording-service global, translate legacy host method names, or subscribe to a host-local recording state stream. A missing recordings capability on that connection SHALL be a typed unavailable state, and canonical workspace reconciliation SHALL own recording state.

#### Scenario: Server lacks recording capability
- **WHEN** the window's server does not provide the recordings capability
- **THEN** a typed unavailable state is shown rather than falling back to a host-local recording service

#### Scenario: Controls follow the terminal's server
- **WHEN** the user starts or stops recording on a terminal in a window showing a remote server
- **THEN** the command is issued through that server's `RecordingsClient` and no other server receives it

## REMOVED Requirements

### Requirement: Recordings surface selects a server

**Reason**: A window shows one server, so Recordings always presents that server and has nothing to select.

**Migration**: See "Every workspace surface covers the window's server" in `connections-and-client-hosts`. To work with another server's Recordings, switch the window to that server or open it in a new window.
