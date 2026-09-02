## ADDED Requirements

### Requirement: Canonical state durability in both server modes
Embedded and standalone server startup SHALL compose the same durable workspace
repository and transaction boundary. An in-memory workspace store MUST NOT act
as a production authority. When canonical persistence cannot be read or
committed, startup and recovery SHALL fail with a bounded actionable state, and
a client MUST NOT repair it by creating local identities.

#### Scenario: Embedded and standalone share the repository
- **WHEN** either server mode starts
- **THEN** it uses the durable workspace repository and its transaction
  boundary

#### Scenario: Unreadable persistence
- **WHEN** canonical persistence cannot be read or committed
- **THEN** startup fails with a bounded actionable state and no client-created
  identity appears

### Requirement: First-run initialization
On a genuinely new data root the server SHALL atomically create one workspace
view, one This server project, one terminal panel, and its terminal session
before reporting the workspace ready. Initialization SHALL be idempotent across
concurrent clients, client reload, additional windows, embedded-server restart,
and process restart.

#### Scenario: Fresh launch is usable
- **WHEN** a Local Desktop client opens against a clean data root
- **THEN** it shows the initial project, an active terminal tab, a live shell,
  and an enabled sidebar without any user or test repair action

#### Scenario: Concurrent first run
- **WHEN** several clients connect while the data root is being initialized
- **THEN** exactly one workspace view, project, panel, and session is created

#### Scenario: Creation does not race initialization
- **WHEN** a project or terminal is created
- **THEN** it is reconciled from the authoritative command result and revision
  exactly once and cannot produce duplicate default projects or sessions

### Requirement: Restoring a non-empty repository
An existing repository SHALL be restored without manufacturing another project.
A Local server restart SHALL remove stale terminal panels and sessions and
create exactly one fresh active terminal, while a still-running remote server
SHALL retain its live terminal sessions across reconnect. A client reload SHALL
reconstruct the same project, panel, session, selected server, and logical view
from server state.

#### Scenario: Local restart
- **WHEN** Local is reopened after its server stopped
- **THEN** the canonical projects and non-terminal panels are restored, dead
  terminal tabs are dropped, and exactly one fresh terminal starts with no
  duplicate project state

#### Scenario: Live remote reconnect
- **WHEN** a client reconnects to a still-running remote server
- **THEN** that server's live terminal sessions are retained

### Requirement: Typed sidebar feature query state
Explorer, Agents, Git, files, recordings, macros, settings, and related sidebar
queries SHALL be issued through the canonical selected-server client using the
active server, project, and environment identity from the hydrated snapshot.
Host-local query facades and generic collapse of failures into an unexplained
`query failed` are forbidden. The sidebar SHALL be disabled only for a typed
unavailable state; a valid active project SHALL enable it, and failures SHALL
display bounded actionable copy without losing the terminal workspace.

#### Scenario: Scoped query authority
- **WHEN** a sidebar feature query is issued
- **THEN** it carries the hydrated active server, project, and environment
  identity and is not served by a host-local facade

#### Scenario: Second project does not change authority
- **WHEN** a second project or terminal is created
- **THEN** the sidebar remains bound to the correct selected server and project
  and requires no reload

#### Scenario: Typed failure copy
- **WHEN** a sidebar query fails
- **THEN** the operation, scope, repository, or transport failure is reported
  with bounded actionable copy and the terminal workspace is retained

### Requirement: Connected workspace readiness
A connected workspace MUST NOT be presented as ready until its initial or
restored snapshot has a valid active view, project, and panel projection, or an
explicit empty-state contract applies.

#### Scenario: No premature ready state
- **WHEN** a client connects before the authoritative snapshot has a valid
  active projection
- **THEN** the workspace is not presented as ready
