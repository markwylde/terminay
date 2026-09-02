## ADDED Requirements

### Requirement: Provider, profile, environment, and revision model
The server SHALL define runtime-validated records for providers, connection
profiles, environments, environment revisions, capabilities, and statuses.
Every record SHALL be validated at runtime before it is persisted or served.

#### Scenario: Malformed record
- **WHEN** an environment or profile record fails runtime validation
- **THEN** it is rejected rather than persisted

### Requirement: Environment registry persistence
Environment domain records SHALL live in a revisioned, crash-safe repository
that is separate from workspace state. A revision SHALL advance on every
committed change, and an interrupted write SHALL leave the repository readable
at its last committed revision.

#### Scenario: Interrupted write
- **WHEN** the server is interrupted mid-write to the environment repository
- **THEN** the repository reopens at the last committed revision

#### Scenario: Environment failure does not corrupt layout
- **WHEN** an environment record is invalid or unavailable
- **THEN** workspace layout state is unaffected

### Requirement: Reserved This server environment
The server SHALL reserve one built-in **This server** environment that cannot
be deleted. It SHALL execute project work through the server's existing
terminal, filesystem, Git, and shell services, with no second local authority.

#### Scenario: Deletion attempted
- **WHEN** a client attempts to remove the This server environment
- **THEN** the request is rejected

#### Scenario: Local behaviour preserved
- **WHEN** an existing local project runs through This server
- **THEN** launch, files, Git, recording, agents, MCP, macros, project moves,
  reconnect, and server restart behave as before

### Requirement: Project and session environment binding
Every project SHALL carry an immutable environment binding, and every terminal
session SHALL carry environment metadata matching its project. A project or
session whose environment metadata does not match SHALL fail atomically before
any process, file, or workspace mutation.

#### Scenario: Mismatched session environment
- **WHEN** a session's environment metadata does not match its project's
  binding
- **THEN** the operation fails before any process, file, or workspace mutation

#### Scenario: Legacy project migrated
- **WHEN** a project created before environments existed is loaded
- **THEN** it is bound to This server exactly once, preserving its id, layout,
  and state

### Requirement: Runtime routing pipeline
The server SHALL resolve every project operation through an internal
environment registry and router contract keyed by the project's canonical
environment identity. Capability and status queries SHALL return bounded, safe
presentation records that carry no credentials or host detail.

#### Scenario: Operation routed by canonical identity
- **WHEN** a project operation is dispatched
- **THEN** it is routed through the registry using the project's canonical
  environment identity

#### Scenario: Status query
- **WHEN** a client queries an environment's capabilities or status
- **THEN** it receives a bounded presentation record containing no credentials

### Requirement: Project and panel movement across environments
A panel move whose source and destination projects resolve to different
environments SHALL be rejected before any mutation is applied.

#### Scenario: Cross-environment panel move
- **WHEN** a client moves a panel into a project bound to a different
  environment
- **THEN** the move is rejected atomically and no workspace state changes
