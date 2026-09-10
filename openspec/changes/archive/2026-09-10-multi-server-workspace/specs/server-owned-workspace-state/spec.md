## ADDED Requirements

### Requirement: Ids are namespaced by server

Every id a client holds SHALL be keyed by the pair of a server identity and that
server's id. A project, view, panel, terminal-session, recording, macro, or
setting id SHALL be a name in its own server's namespace, and identical id values
on two attached servers SHALL denote different objects. Routes, deep links, and
persisted client presentation state SHALL carry the server identity alongside the
id.

#### Scenario: Colliding ids on two attached servers

- **WHEN** a window attaches two servers whose workspaces hold a project with the
  same id value
- **THEN** the client presents them as two distinct projects, each addressed by
  its own server identity, and an operation on one is sent only to that server

#### Scenario: Deep link carries the server

- **WHEN** the client resolves a route or deep link to a project, panel, or
  terminal
- **THEN** the route names the owning server identity, and no id is resolved
  against a server that did not issue it

## MODIFIED Requirements

### Requirement: Canonical model ownership and client role

Terminay Server SHALL own the canonical workspace model and every privileged
service acting on its own host. Desktop and browser clients SHALL render that
model, submit validated commands, and keep only device-local presentation and
connection state. A client MAY observe several servers at once; each server SHALL
be canonical for its own model alone, and no server SHALL hold, route, or
reconcile another server's workspace. The model SHALL preserve the current
project, panel, and immutable terminal-session boundaries while allowing multiple
clients to observe one server, and process lifetime MUST NOT be tied to any
renderer.

#### Scenario: Multiple clients observe one server

- **WHEN** two clients connect to the same server
- **THEN** both observe the same canonical project, panel, and terminal-session
  identities

#### Scenario: Renderer lifetime is independent

- **WHEN** every renderer disconnects
- **THEN** the server's workspace state and terminal processes continue

#### Scenario: One client observes several servers

- **WHEN** a client holds connections to several servers
- **THEN** each server publishes and validates only its own workspace model, and
  no server is asked for another server's projects, panels, or sessions

### Requirement: Client-owned device-local state

Desktop and browser hosts SHALL keep only state inherently local to that device:
remembered server labels and non-secret connection metadata; encrypted device
keys and reconnect credentials; native window geometry and the mapping from
local windows to server and view ids; the window's composition, being its primary
connection, its set of attached connections, the workspace view attached on each
of them, and the order of the project tabs drawn from them; which project tab and
which terminal or panel is active in each connected presentation; sidebar
visibility for each server and project pair; transient dialogs, menus, selection,
drag previews, and optimistic UI state; hardware and host capabilities such as
microphone permission; and explicitly device-specific accessibility or input
overrides. The composition MUST NOT be sent to any server. Client-local state
MUST NOT be required to recover project membership, panel identity, or a live
terminal after reconnect.

#### Scenario: Active selections differ per client

- **WHEN** two clients of the same server show different active projects and
  terminals
- **THEN** both still share the same ordered project and panel lists

#### Scenario: Recovery without client state

- **WHEN** a client reconnects with no local workspace state
- **THEN** project membership, panel identity, and live terminals are recovered
  from the server

#### Scenario: Composition is device-local

- **WHEN** a window attaches a server, reorders its tabs, and another device
  connects to the same servers
- **THEN** the composition is stored only on the first device, no server records
  it, and the second device keeps its own composition

### Requirement: Desktop persistence allowlist

Desktop persistence SHALL be allowlisted to non-secret connection profiles,
OS-protected device credentials, native window geometry, each window's
composition, application update state, operating-system permission decisions, and
explicitly device-specific preferences. It MUST NOT persist workspace snapshots,
application-protocol DTOs, project roots, panel state, terminal state, server
settings, or server capability projections as a second authority. A cached
projection used while connected SHALL be disposable and SHALL always be
resynchronized from the server that owns it.

#### Scenario: No second authority on disk

- **WHEN** Desktop shuts down and restarts
- **THEN** no workspace snapshot, protocol DTO, project root, panel, terminal,
  server setting, or capability projection is read back as authority

#### Scenario: Cached projection is resynchronized

- **WHEN** Desktop reconnects to a server
- **THEN** any cached projection is discarded in favour of the server's state

#### Scenario: Composition survives restart

- **WHEN** Desktop restarts a window that had attached servers and a chosen tab
  order
- **THEN** the primary connection, the attached set, the attached view on each,
  and the tab order are restored from local persistence, while every project,
  panel, and terminal is resynchronized from its owning server

### Requirement: Browser connection-host persistence

Browser connection-host persistence SHALL follow the same ownership rule. Manager
storage SHALL contain only sanitized profiles and each session's composition.
Origin-bound credentials, verified bundle caches, and ephemeral renderer state
SHALL remain partitioned by the exact server session origin.

#### Scenario: Manager storage contents

- **WHEN** the browser manager stores a remembered server
- **THEN** only a sanitized profile is stored, and credentials and bundle caches
  stay partitioned by that server's session origin

#### Scenario: Composition is not a workspace snapshot

- **WHEN** the browser manager stores a session's composition
- **THEN** it stores only the primary and attached connection identities, the
  attached view on each, and the tab order, and no workspace snapshot, project
  root, panel, or terminal state

### Requirement: Identity-based authority for requests

Every panel and terminal SHALL belong to an exact server, project, and view
identity. Every request SHALL name the connection whose server owns the object it
addresses, and SHALL be sent only over that connection. Requests SHALL carry ids;
titles, labels, and client-selected roots MUST NOT be authority. Project-scoped
requests SHALL be resolved from the canonical project; a supplied hostname, IP, or
URL MUST NOT be authority. A client MUST NOT send an id issued by one server to
another server, and a connected device MUST NOT refer to a session or object from
another server using a copied id.

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

#### Scenario: Request is routed by its object's server

- **WHEN** the user acts on a project, panel, or terminal while several servers
  are attached
- **THEN** the request is issued over the connection to the server that owns that
  object, and no other attached server receives it

### Requirement: Workspace views are not window ids

Workspace views MUST NOT use an Electron `BrowserWindow` id as product identity.
Electron MAY map a view to a native window and web clients MAY render the same
view through a view switcher. A window SHALL attach one workspace view on each
attached server, and each of those views SHALL stay owned by its own server.
Closing a client window and deleting a logical workspace view SHALL be separate
actions.

#### Scenario: Closing a native window

- **WHEN** the user closes the native window presenting a workspace view
- **THEN** the logical workspace view is not deleted

#### Scenario: One attached view per server

- **WHEN** a window attaches two servers
- **THEN** it holds one workspace view on each, and neither server is aware of the
  other's view

### Requirement: Native project-host window binding

A native project-host window SHALL bind to one primary connection and to one
exact server-owned workspace view on that connection and on each attached
connection. It SHALL derive its project tabs only from the ordered project ids of
those bound views. The host MAY reattach terminal presentation streams between
renderers but MUST NOT synthesize a replacement project id or treat a cross-view
move as a project close.

#### Scenario: Cross-view move

- **WHEN** a project is moved out of a view presented by a native window
- **THEN** the host treats it as a move, not a project close, and synthesizes no
  replacement project id

#### Scenario: Tabs come only from bound views

- **WHEN** a window is bound to a primary connection and one attached connection
- **THEN** its project tabs are exactly the projects of the bound view on each of
  those two servers

### Requirement: Consistency scope

The workspace consistency contract SHALL be multi-client consistency within one
server, not collaborative document editing and not consistency across servers.
Each server SHALL order its own revisions independently, and a client MUST NOT
sequence, compare, or reconcile one server's revisions against another's. File
editing SHALL continue to use the file-viewer conflict contract.

#### Scenario: Concurrent file edits

- **WHEN** two clients edit the same file
- **THEN** the file-viewer conflict contract governs the outcome rather than the
  workspace command protocol

#### Scenario: Revisions are per server

- **WHEN** a client holds projections of two attached servers
- **THEN** it tracks a separate revision per server and never compares or orders
  them against each other

### Requirement: Disconnect and restart lifecycle

Client disconnect MUST NOT delete projects, close panels, or kill PTYs. The
lifecycle of each connection SHALL be independent: a connection that drops,
reconnects, or fails authorization SHALL leave every other connection of the same
window connected and operable. Terminal exit SHALL update all referencing panels
and connected clients once. A successful-exit close decision SHALL use the
terminal surface's already-observed setting at the exit boundary and MUST NOT wait
for another settings request after the session has ended. Server restart SHALL
reload durable workspace state and SHALL mark formerly live PTYs interrupted
unless the process can be safely reattached.

#### Scenario: Client disconnects

- **WHEN** a client disconnects
- **THEN** its projects, panels, and PTYs are unaffected

#### Scenario: Terminal exits successfully

- **WHEN** a terminal exits successfully
- **THEN** all referencing panels and connected clients update once, using the
  already-observed close setting at the exit boundary

#### Scenario: Server restart with unreattachable PTYs

- **WHEN** the server restarts and a formerly live PTY cannot be safely
  reattached
- **THEN** durable workspace state reloads and that session is marked interrupted

#### Scenario: One connection of several drops

- **WHEN** one attached connection of a window drops or restarts
- **THEN** the window's other connections stay connected and operable, and their
  projects, panels, and terminals are untouched

### Requirement: Workspace state non-goals

There SHALL be no cloud synchronization of workspace state, no workspace that
spans several servers, no server-to-server routing of workspace, terminal, or
filesystem operations, no cross-server project or terminal identity, no
transparent simultaneous editing of one file by several users, no durable
persistence of every ephemeral UI interaction, no dependence on Electron window
ids, browser tab ids, tab titles, or current focus for authorization, and no
Electron-owned mirror of server workspace state or feature-specific compatibility
database.

#### Scenario: Authorization never depends on focus

- **WHEN** an authorization decision is made
- **THEN** it does not depend on an Electron window id, browser tab id, tab
  title, or current focus

#### Scenario: No Electron mirror

- **WHEN** Desktop runs
- **THEN** it maintains no Electron-owned mirror of server workspace state or
  feature-specific compatibility database

#### Scenario: Servers do not talk to each other

- **WHEN** a window presents projects from several servers
- **THEN** no server holds a workspace referencing another server's projects and
  no server forwards an operation to another server

### Requirement: Cross-client convergence for panel changes

When either client of one server creates, closes, or moves a panel, the other
client of that server SHALL reach the same workspace revision and panel and
session identities without polling, reload, or an independently manufactured
renderer panel. Convergence SHALL be scoped to the server that owns the panel and
SHALL NOT change any other server's revision or projection.

#### Scenario: One client moves a panel

- **WHEN** one client creates, closes, or moves a panel
- **THEN** the other client converges to the same revision and panel and session
  identities without polling or reload

#### Scenario: Convergence does not cross servers

- **WHEN** a panel changes on one attached server
- **THEN** only that server's revision and projection advance, and every other
  attached server's projection is unchanged
