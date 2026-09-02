## MODIFIED Requirements

### Requirement: Desktop persistence allowlist

Desktop persistence SHALL be allowlisted to non-secret connection profiles,
OS-protected device credentials, native window geometry, exact
window-to-server/view bindings, verified content-addressed bundle caches,
application update state, operating-system permission decisions, and explicitly
device-specific preferences. It MUST NOT persist workspace snapshots,
application-protocol DTOs, project roots, panel state, terminal state, server
settings, or server capability projections as a second authority. A cached
projection used while connected SHALL be disposable and SHALL always be
resynchronized from the selected server.

#### Scenario: No second authority on disk

- **WHEN** Desktop shuts down and restarts
- **THEN** no workspace snapshot, protocol DTO, project root, panel, terminal,
  server setting, or capability projection is read back as authority

#### Scenario: Cached projection is resynchronized

- **WHEN** Desktop reconnects to a server
- **THEN** any cached projection is discarded in favour of the server's state

### Requirement: Client-host native-only operations

Client hosts SHALL retain native-only operations: BrowserWindow lifecycle,
application updates, operating-system clipboard and dialogs, external-link
confirmation, and local credential storage.

#### Scenario: Host performs a native operation

- **WHEN** the user triggers an application update or an OS dialog
- **THEN** the client host performs it without becoming an authority over
  workspace state
