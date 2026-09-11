## ADDED Requirements

### Requirement: Canonical workspace objects

A **server** SHALL be one workspace, trust, persistence, and extension authority
with one data root, and SHALL execute every project it owns on its own machine. A
**workspace view** SHALL be a server-owned logical grouping of projects
presentable as an Electron native window or an in-browser view or tab. A
**project** SHALL have a stable id, a root folder on the server's filesystem,
name, colour, icon, optional default shell-profile id, sidebar layout, ordered
panels, and logical layout. A **panel** SHALL have a stable id, type, project
ownership, presentation metadata, and type-specific state.

#### Scenario: A project root is a path on the server

- **WHEN** a project is persisted
- **THEN** its root is stored as a folder on the server's filesystem and no
  credentials or connection configuration are stored in workspace state

#### Scenario: Project fields survive a reconnect

- **WHEN** a fresh client connects
- **THEN** it receives each project's id, root, name, colour, icon, default
  shell-profile reference, sidebar layout, ordered panels, and logical layout
  from the server

### Requirement: Terminal session identity is immutable and server-issued

A terminal session SHALL have an immutable server-issued id and a runtime
lifecycle independent of panel mounts. A terminal panel SHALL reference a
session; moving the panel MUST NOT recreate the session.

#### Scenario: Moving a terminal panel

- **WHEN** a terminal panel is moved
- **THEN** it continues to reference the same session id and no new session is
  created

### Requirement: Server-side path resolution

Filesystem paths SHALL be resolved and validated on the server against the
operation's allowed scope. Symlinks, worktrees, renames, deleted roots, and
platform case rules SHALL be handled at the final canonical-path boundary. MCP
capability tokens SHALL resolve directly to a server terminal and its project;
renderer focus MUST NOT widen scope.

#### Scenario: MCP token scope

- **WHEN** an MCP capability token is used
- **THEN** it resolves to its own server terminal and project regardless of
  renderer focus

#### Scenario: Path outside the allowed scope

- **WHEN** a request resolves to a path outside the operation's allowed scope
- **THEN** the command fails before any mutation

### Requirement: Typed sidebar feature query scope

A valid active project SHALL enable sidebar feature queries with its canonical
server and project identity. An unscoped query SHALL fail with a typed,
actionable state rather than a generic `query failed` projection.

#### Scenario: Unscoped sidebar query

- **WHEN** a sidebar feature query is issued without a valid active project scope
- **THEN** it fails with a typed actionable state, not a generic `query failed`

### Requirement: Reconnecting to a live server

A server that remains alive SHALL retain its live terminal sessions across a
client reconnect.

#### Scenario: Reconnect to a live server

- **WHEN** a client reconnects to a server that remained alive
- **THEN** its live terminal sessions are retained

## MODIFIED Requirements

### Requirement: Canonical model ownership and client role

Terminay Server SHALL own the canonical workspace model and every privileged
service acting on its own host. Desktop and browser clients SHALL render that
model, submit validated commands, and keep only device-local presentation and
connection state. The model SHALL preserve the current project, panel, and
immutable terminal-session boundaries while allowing multiple clients to observe
one server, and process lifetime MUST NOT be tied to any renderer.

#### Scenario: Multiple clients observe one server

- **WHEN** two clients connect to the same server
- **THEN** both observe the same canonical project, panel, and terminal-session
  identities

#### Scenario: Renderer lifetime is independent

- **WHEN** every renderer disconnects
- **THEN** the server's workspace state and terminal processes continue

### Requirement: Server-persisted state inventory

The server SHALL persist and publish ordered workspace views and their project
membership; projects, roots, names, colours, icons, default shell-profile
references, and sidebar layout configuration; logical panel layout, splits,
order, notes, and appearance; terminal identity, lifecycle, metadata, bounded
output position, activity, and recording state; file and folder navigation and
modes where they are part of the shared workspace; settings affecting shells,
project services, terminal behaviour, recording, remote exposure, agents, AI
providers, macros, and server automation; macros and server-held secrets;
authoritative agent and activity state and acknowledgement; paired devices,
public device keys, exposure state, and audit records; and schema and revision
metadata needed for safe migration and resync.

#### Scenario: Fresh client rebuilds the workspace

- **WHEN** a project with terminal, file, and folder panels is reopened from a
  fresh client
- **THEN** it reconnects using only server state

#### Scenario: Agent and activity state is authoritative on the server

- **WHEN** a client queries agent or activity state
- **THEN** the server's authoritative state and acknowledgement are returned

### Requirement: Privileged services owned by the server

PTY creation, input, resize, working-directory inspection, output replay, and
termination; terminal signal parsing and fallback activity reduction; filesystem
listing, search, read, write, watch, and file-conflict detection; Git status,
diff, worktree lifecycle, Quick Push, and provider CLI execution; recording
capture, persistence, listing, replay reads, and deletion; process-bound
agent-journal discovery, versioned provider normalization, status, and lifecycle;
MCP and control socket, per-session capability tokens, and project-scoped tools;
settings, macros, AI metadata generation, and secret-backed automation; and
remote pairing, WebRTC availability, device authentication, revocation, and audit
SHALL be authorized and lifecycle-owned by Terminay Server and reached only
through the application protocol. They SHALL execute against the server's own
host.

#### Scenario: Feature parity locally and remotely

- **WHEN** files, Git, recordings, agents, MCP, macros, or settings are used
- **THEN** they work through the same server boundary for local and remote
  clients

#### Scenario: Adapter resolution

- **WHEN** a privileged operation runs for a project
- **THEN** it executes against the host of the server that owns that project

### Requirement: Identity-based authority for requests

Every panel and terminal SHALL belong to an exact server, project, and view
identity. Requests SHALL carry ids; titles, labels, and client-selected roots
MUST NOT be authority. Project-scoped requests SHALL be resolved from the
canonical project; a supplied hostname, IP, or URL MUST NOT be authority. A
connected device MUST NOT refer to a session or object from another server using
a copied id.

#### Scenario: Client supplies a hostname

- **WHEN** a client includes a hostname, IP, or URL in a project-scoped request
- **THEN** the operation is resolved from the canonical project and the supplied
  value is ignored as authority

#### Scenario: Copied id from another server

- **WHEN** a device sends an object or session id belonging to another server
- **THEN** the request is rejected

#### Scenario: Title change cannot widen scope

- **WHEN** a remote client changes titles, paths, or local state
- **THEN** it obtains no plaintext secrets and no wider project or session scope

### Requirement: First-run initialization

A new server data root SHALL be initialized through the canonical repository,
not by a renderer or host adapter. Initialization SHALL atomically commit one
workspace view, one project rooted at the server-authorized home, one terminal
panel, and its terminal session before reporting the workspace ready.
Initialization SHALL be idempotent: a client reload, additional native window, or
reconnect MUST NOT create another default project or terminal.

The server SHALL seed that first terminal on the same startup path that restores
a non-empty repository, so a host cannot make first-run and restart behave
differently by seeding on only one of them.

#### Scenario: New data root

- **WHEN** a new server data root is initialized
- **THEN** exactly one workspace view, project, terminal panel, and terminal
  session are committed before any client renders the workspace as ready

#### Scenario: Reload after initialization

- **WHEN** a client reloads, opens another native window, or reconnects
- **THEN** no additional default project or terminal is created

### Requirement: Restoring a non-empty repository

A non-empty repository SHALL restore its projects and non-terminal panels. A
terminal panel describes a process owned by the server process that created it,
so a restart MUST NOT restore terminal tabs: the server SHALL remove their stale
panels and sessions and SHALL create one fresh terminal in each restored project
with a valid root before the workspace is shown. Previous tab counts MUST NOT be
restored. A project whose persisted root is missing on the server SHALL instead
stay represented with its recoverable error until repaired.

This restore SHALL be performed by the server for every host. A connection host
SHALL NOT decide what a restored workspace contains, so Desktop and a browser
reaching a standalone server SHALL observe the same restored workspace for the
same repository.

#### Scenario: Server restart

- **WHEN** a server restarts with restored projects
- **THEN** stale terminal panels and sessions are removed and one fresh terminal
  is created in each restored project with a valid root before the workspace is
  shown

#### Scenario: Local Desktop restart

- **WHEN** Desktop restarts with restored Local projects
- **THEN** stale terminal panels and sessions are removed and one fresh terminal
  is created in each restored project with a valid root before the workspace is
  shown

#### Scenario: The host does not change the outcome

- **WHEN** the same repository is restored under an embedded Desktop server and
  under a standalone server reached from a browser
- **THEN** both restore the same projects, remove the same stale terminal panels,
  and seed replacement terminals the same way

#### Scenario: Restored project with a missing root

- **WHEN** a restored project's persisted root is missing on the server
- **THEN** it stays represented with its recoverable error and receives no
  replacement terminal until repaired

## REMOVED Requirements

### Requirement: Canonical object definitions

**Reason:** The definitions name a project environment as a canonical object and
give a project an environment id, and the project environment concept is removed.

**Migration:** None. The object definitions are kept, without an environment, as
"Canonical workspace objects".

### Requirement: Terminal sessions have immutable server-issued identity

**Reason:** A session snapshots its project's environment id and validation
requires the two to match, and there is no environment id to snapshot.

**Migration:** None. Session identity is kept as "Terminal session identity is
immutable and server-issued".

### Requirement: Provider capability honesty

**Reason:** The project environment concept is removed, so there is no provider
that implements a subset of the server's own host services and no fallback path
to guard against.

**Migration:** None. Every privileged service executes against the server's own
host, which is covered by "Privileged services owned by the server".

### Requirement: Server-side path resolution and boundaries

**Reason:** Its boundary rule is that a panel move between projects with unequal
environment ids must fail, and every project of one server executes on that
server.

**Migration:** None. Path resolution is kept as "Server-side path resolution".

### Requirement: Remote project restoration

**Reason:** The project environment concept is removed. A project's root is a
path on its own server's filesystem, so a restored root is either present on that
server or a recoverable project error, which "Restoring a non-empty repository"
already states.

**Migration:** None. The retention of live terminal sessions across a reconnect
is kept as "Reconnecting to a live server".

### Requirement: Typed sidebar feature query state

**Reason:** It scopes a query by environment identity and preserves
project-environment routing failure codes, and there is no environment to route
to.

**Migration:** None. Query scoping is kept as "Typed sidebar feature query
scope".
