## ADDED Requirements

### Requirement: Canonical model ownership and client role
The server SHALL be the only canonical authority for workspace views, projects, panels,
and terminal sessions. Clients SHALL render server state and issue commands; they SHALL NOT
hold authoritative workspace membership or layout.

#### Scenario: Fresh client reconstructs the workspace
- **WHEN** a client with no local state connects and requests a snapshot
- **THEN** it reconstructs every project, panel, logical layout, and active identity from
  that one snapshot

#### Scenario: Renderer-local state is not authoritative
- **WHEN** a client asserts project membership or layout that differs from canonical state
- **THEN** the server rejects the assertion and the client converges to canonical state

### Requirement: Stable object identity and ownership
Servers, workspace views, projects, panels, and terminal sessions SHALL each have a stable
server-issued id, and the ownership relationships between them SHALL be canonical. Panel
state for terminal, file, and folder surfaces SHALL be modelled without host layout types,
and normalized split, order, and active state SHALL be represented separately from native
window ids and screen pixels.

#### Scenario: Layout is host-independent
- **WHEN** the same canonical snapshot is rendered by two different hosts
- **THEN** both reconstruct the same logical split, order, and active selection without any
  native window id or pixel geometry

#### Scenario: Cross-scope identifiers are rejected
- **WHEN** a command names a panel id that belongs to another project or server
- **THEN** the server rejects it on identity grounds, regardless of client focus or labels

### Requirement: Terminal sessions have immutable server-issued identity
A terminal session's identity SHALL be issued by the server and SHALL NOT depend on any
renderer, native window, or client process. Destroying or reloading a client SHALL NOT end
a terminal session; client subscriptions are detachable consumers of the session.

#### Scenario: Renderer reload preserves the session
- **WHEN** the renderer context is recreated or its native window is unbound
- **THEN** the server-owned terminal session remains live with the same immutable id and the
  client reattaches to it

#### Scenario: Moving a project preserves sessions
- **WHEN** a project is moved between logical workspace views
- **THEN** every panel and terminal-session id is preserved

### Requirement: Snapshot, revision, and named commands
Workspace mutation SHALL happen through named, scoped commands carrying an idempotent
command id and an expected revision. The server SHALL emit ordered events, support delta
delivery and full resynchronization, and SHALL reject a command whose expected revision is
stale with an explicit conflict.

#### Scenario: Duplicate command id
- **WHEN** the same command id is submitted twice
- **THEN** the server commits it once and returns the same result for the repeat

#### Scenario: Concurrent conflicting moves
- **WHEN** two clients submit conflicting moves against the same revision
- **THEN** exactly one commits and the other receives an explicit conflict, and no panel or
  session is duplicated

#### Scenario: Multi-object move is atomic
- **WHEN** one command moves several objects
- **THEN** the change is committed as a single revision or not at all

### Requirement: Distinct close semantics
Closing a client window, closing a logical workspace view, closing a panel, and terminating
a PTY SHALL be four distinct operations. A client detaching or being destroyed SHALL NOT be
treated as a panel close or a session termination.

#### Scenario: Window close does not kill PTYs
- **WHEN** a client window is closed or reloaded
- **THEN** its terminal sessions remain live and are marked as having no attached consumer

### Requirement: Canonical persistence and recovery reporting
The server SHALL persist canonical state through a schema-versioned repository with an
atomic commit path, backup and recovery, and idempotent migrations. Modal, hover, drag
geometry, search text, and unbounded terminal content SHALL NOT be persisted. On restart the
server SHALL report missing project roots and interrupted sessions with explicit metadata
while preserving canonical project and session ids.

#### Scenario: Restart marks interrupted sessions
- **WHEN** the server restarts with durable state that recorded live PTYs
- **THEN** it reloads that state and marks the formerly live sessions interrupted rather than
  deleting or silently recreating them

#### Scenario: Missing root is reported, not replaced
- **WHEN** a persisted project root no longer exists
- **THEN** recovery reports the missing root as explicit metadata and keeps the project's
  canonical id and state

#### Scenario: Migration is idempotent
- **WHEN** the same migration runs twice against the same store
- **THEN** the resulting state is identical and no duplicate objects are created

### Requirement: Optimistic UI limits
Clients MAY apply deterministic optimistic updates only for mutations that are safe to roll
back locally. Any optimistic state SHALL be reverted when the server rejects or rebases the
corresponding command.

#### Scenario: Rejected command rolls back
- **WHEN** an optimistically applied mutation is rejected by the server
- **THEN** the client deterministically restores the last canonical state
