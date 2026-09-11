# server-owned-workspace-state Specification

## Purpose

Terminay Server owns the canonical workspace model and every privileged service
that acts on its own host, so that Desktop and browser clients only render that
model, submit validated commands, and keep device-local presentation and
connection state.

## Requirements

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

### Requirement: File and folder panel scope

File and folder panels SHALL reference canonical paths within their owning
project scope. Their view mode and navigation state SHALL be durable workspace
state.

#### Scenario: Folder panel view mode persists

- **WHEN** a folder panel's view mode or navigation state changes and the client
  reconnects
- **THEN** the server restores that view mode and navigation state

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

### Requirement: Excluded from the persistence contract

The persistence contract MUST NOT include unbounded terminal scrollback, live
PTY serialization, transient search text, open modal state, hover state,
in-progress drag geometry, or which project tab or terminal panel is active in a
connected presentation.

#### Scenario: Active tab is not durable server state

- **WHEN** a client changes its active project tab or active terminal
- **THEN** no durable workspace state records that choice

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

### Requirement: Snapshot, revision, and named commands

The server SHALL publish a complete initial snapshot with a monotonically
increasing workspace revision. Durable mutations SHALL be named commands such as
create, move, rename, and close rather than replacement uploads of an opaque
Dockview JSON document. A command SHALL declare the object ids and expected
revision it depends on. The server SHALL validate authorization and invariants,
commit once, assign the next revision, and publish one ordered result event.

#### Scenario: Committed command yields one ordered result

- **WHEN** a client commits a workspace command
- **THEN** the server validates it, commits once, assigns the next revision, and
  publishes one ordered result event to every connected client

#### Scenario: Layout is not uploaded wholesale

- **WHEN** a client changes panel layout
- **THEN** it submits named commands rather than an opaque layout document

### Requirement: Idempotency, rebase, and conflicts

A duplicated command id SHALL return its recorded outcome rather than applying
twice. A stale non-conflicting command MAY be rebased only where semantics are
explicit; otherwise the server SHALL return a conflict with the current
revision. Clients that miss events SHALL request a delta from a known revision
or a fresh snapshot.

#### Scenario: Duplicate command id

- **WHEN** a client resends a command with an already-processed command id
- **THEN** the recorded outcome is returned and the mutation is not applied again

#### Scenario: Stale conflicting command

- **WHEN** a command's expected revision is stale and its semantics do not permit
  rebase
- **THEN** the server returns a conflict carrying the current revision

#### Scenario: Two clients recover from a conflict

- **WHEN** two connected clients both submit commands and one conflicts
- **THEN** each receives one ordered result per committed command and the
  conflicting client recovers cleanly

### Requirement: Workspace delta envelope

A workspace delta SHALL have one versioned wire shape containing the resulting
project-scoped state and the ordered change records since the requested
revision. Clients SHALL validate that envelope, advance atomically to its
embedded state, and MUST NOT parse the envelope itself as a complete workspace
snapshot.

#### Scenario: Delta applied atomically

- **WHEN** a client receives a valid delta
- **THEN** it advances atomically to the embedded project-scoped state

#### Scenario: Malformed delta

- **WHEN** a malformed, stale, or incompatible delta arrives
- **THEN** the client projection is not partially mutated

### Requirement: Validation failure and bounded recovery

Snapshot and delta validation failures SHALL leave the last confirmed projection
marked stale and SHALL trigger a bounded full-snapshot recovery. They SHALL be
surfaced as connection or reconciliation failures rather than discarded while the
UI continues to present stale state as current.

#### Scenario: Snapshot fails validation

- **WHEN** a snapshot or delta fails validation
- **THEN** the client marks its projection stale, reports the reconciliation
  failure, and recovers from a complete authorized snapshot

### Requirement: Optimistic UI limits

Optimistic UI SHALL be allowed only when rollback is deterministic. Destructive
filesystem, Git, secret, recording, and terminal-lifecycle actions SHALL wait for
server confirmation.

#### Scenario: Destructive action awaits confirmation

- **WHEN** a destructive filesystem, Git, secret, recording, or terminal
  lifecycle action is invoked
- **THEN** the UI waits for the server result before presenting it as complete

### Requirement: Presentation reconciliation follows the newest projection

A client SHALL reconcile its presentation only against the newest workspace
projection it has confirmed. A reconciliation pass that is deferred, retried, or
superseded SHALL read the current projection when it runs rather than replaying
the projection it was scheduled with, and a newer projection SHALL cancel every
pass still pending from an older one.

A reconciliation pass SHALL NOT remove a panel that the newest confirmed
projection still contains. Because canonical panel removal closes the terminal
session behind it, a pass that has fallen behind the confirmed projection can
neither remove a presented panel nor end a live terminal session.

#### Scenario: Retried reconciliation reads the current projection

- **WHEN** a reconciliation pass is retried after the client has confirmed a newer
  projection
- **THEN** it reconciles against the newer projection, and no panel that
  projection contains is removed

#### Scenario: Terminals created while another window presents a project

- **WHEN** the user creates terminals in one window while another window presents
  a project of the same workspace
- **THEN** every created terminal keeps its tab and its live session

#### Scenario: Sessions this window does not present

- **WHEN** the workspace projection holds terminal sessions that this window does
  not present
- **THEN** they leave the panels this window does present untouched

### Requirement: Command-first terminal panel close

Closing a canonical terminal panel SHALL be command-first: the renderer SHALL
wait for the server close result and a reconciled snapshot before completing the
UI action. Dockview removal SHALL be a projection of that confirmed state and
MUST NOT launch a second close command from a stale revision. Busy PTY teardown
and snapshot convergence SHALL share a bounded 10-second lifecycle budget.

#### Scenario: Closing a busy terminal panel

- **WHEN** the user closes a terminal panel whose PTY is busy
- **THEN** the renderer waits for the server close result and reconciled snapshot
  within the shared 10-second budget before removing the panel

#### Scenario: No duplicate close command

- **WHEN** the projection removes a closed terminal panel
- **THEN** no second close command is issued from a stale revision

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

### Requirement: Logical layout without host handles

The canonical layout SHALL describe panel relationships, split direction and
weight, order, and active identities without embedding screen pixels or Electron
window handles. A client MAY keep temporary local split measurements while
dragging, then SHALL commit normalized weights.

#### Scenario: Dragging a splitter

- **WHEN** the user drags a splitter
- **THEN** the client tracks local measurements during the drag and commits
  normalized weights

### Requirement: Responsive rendering of one model

Wide desktop clients SHALL render the full Dockview workspace. Narrow clients
SHALL adapt the same project and panel model into selectors, stacked or tabbed
surfaces, drawers, and touch controls without creating a second workspace model.

#### Scenario: Narrow client

- **WHEN** a client is too narrow for the full workspace
- **THEN** it presents the same project and panel model through selectors,
  stacked surfaces, drawers, and touch controls

### Requirement: Popout and view adoption

Native popout and adoption SHALL become movement between server-owned workspace
views. Popping out an active terminal SHALL move its owning project into a new
logical view and present that view as a native window. A renderer MUST NOT create
an independent terminal-only browser window or transfer PTY ownership between
renderers. Web clients SHALL be able to manage logical views without requiring
browser popup windows.

#### Scenario: Popping out a terminal

- **WHEN** the user pops out an active terminal
- **THEN** its owning project moves into a new logical workspace view presented
  as a native window, and PTY ownership does not transfer between renderers

#### Scenario: Moving a project between views

- **WHEN** a project moves between logical views
- **THEN** panel and session ids and service scope are preserved

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

### Requirement: Client-host native-only operations

Client hosts SHALL retain native-only operations: BrowserWindow lifecycle,
application updates, operating-system clipboard and dialogs, external-link
confirmation, and local credential storage.

#### Scenario: Host performs a native operation

- **WHEN** the user triggers an application update or an OS dialog
- **THEN** the client host performs it without becoming an authority over
  workspace state

### Requirement: Window mapping is presentation metadata

The host MAY map a local native window or browser tab to a server-owned logical
view, but that mapping SHALL be presentation metadata only. Opening, focusing,
or closing a native window MUST NOT create, mutate, transfer, or delete server
workspace state unless the user separately invokes the corresponding typed
workspace command.

#### Scenario: Closing or reloading the owning window

- **WHEN** the owning Electron window is closed or reloaded
- **THEN** its PTYs are not killed and no workspace state is mutated

### Requirement: Dictation split of responsibility

Dictation SHALL split responsibility: the client captures microphone audio after
local permission, while server policy, provider credentials, transcription, and
insertion into the intended terminal remain server-authorized operations.

#### Scenario: Dictating into a terminal

- **WHEN** the user dictates after granting local microphone permission
- **THEN** the client captures audio and the server applies policy, resolves
  provider credentials, transcribes, and inserts into the intended terminal

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

### Requirement: Settings classification and revisioned broadcast

Settings SHALL be classified as server, connection-host, or temporary client
state rather than stored in one undifferentiated Electron JSON file. Server
settings SHALL be normalized and migrated by the server and broadcast with
revisions.

#### Scenario: Server setting changes

- **WHEN** a server setting is changed
- **THEN** the server normalizes it and broadcasts it with a revision to every
  authorized client

### Requirement: Server secret vault

Server secrets SHALL use a pluggable vault. Embedded mode SHALL use an
OS-backed protector for its server vault wrapping key without exposing plaintext
to a renderer or workspace bundle. Electron safe storage SHALL protect
embedded-vault wrapping keys only when the platform reports an OS-backed
encryption backend; Linux `basic_text` storage SHALL be unavailable for this
purpose.

#### Scenario: Platform reports no OS-backed backend

- **WHEN** the platform reports only Linux `basic_text` storage
- **THEN** Electron safe storage is not used to protect the embedded vault
  wrapping key

#### Scenario: Renderer requests vault plaintext

- **WHEN** a renderer or workspace bundle requests a vault wrapping key
- **THEN** no plaintext is exposed to it

### Requirement: Headless vault envelope and unlock

A headless vault SHALL wrap its data-encryption key in a versioned, bounded
passphrase envelope using the specified scrypt parameters. Unlock input SHALL
come only from an echo-disabled controlling terminal or a one-shot inherited
file descriptor. Command-line arguments, environment variables, ordinary stdin,
and a plaintext key stored beside the ciphertext MUST NOT be unlock mechanisms.

#### Scenario: Unlock attempted through an environment variable

- **WHEN** a passphrase is supplied through a command-line argument, environment
  variable, or ordinary stdin
- **THEN** it is not accepted as an unlock mechanism

#### Scenario: Interactive unlock

- **WHEN** the operator unlocks through an echo-disabled controlling terminal or
  a one-shot inherited file descriptor
- **THEN** the vault unlocks

### Requirement: Headless vault persistence and hygiene

The selected server-core headless adapter SHALL persist the vault envelope
through an injected server storage boundary, whose file implementation uses
mode-0600 replace-by-rename writes. It SHALL authenticate the envelope's
metadata, zeroize passphrase, derived-key, and scoped plaintext buffers, and
SHALL start locked after restart. Its protocol-facing status and references SHALL
contain metadata only. Electron safe storage SHALL remain a separate embedded
protector boundary. The canonical state repository SHALL reject a complete but
stale vault envelope using its expected revision.

#### Scenario: Restart

- **WHEN** a headless server restarts
- **THEN** its vault starts locked and its protocol-facing status exposes
  metadata only

#### Scenario: Stale envelope write

- **WHEN** a complete but stale vault envelope is submitted
- **THEN** the canonical state repository rejects it on its expected revision

### Requirement: Secret exposure limits and macro resolution

Secret values MUST NOT be included in workspace snapshots, audit events, logs, or
normal settings responses. Macro execution SHALL resolve secret placeholders on
the server and SHALL write the result directly to the authorized PTY.

#### Scenario: Snapshot contents

- **WHEN** a workspace snapshot, audit event, log line, or settings response is
  produced
- **THEN** it contains no secret values

#### Scenario: Macro with a secret placeholder

- **WHEN** a macro containing a secret placeholder runs
- **THEN** the server resolves the placeholder and writes the result directly to
  the authorized PTY

### Requirement: Development data root isolation

Source-development Desktop SHALL use a dedicated `Terminay Development`
user-data root, including when a source build is temporarily packaged by
Electron Builder for local development or smoke testing. A development build
MUST NOT migrate or otherwise mutate an installed Desktop release's profile.

#### Scenario: Packaged source build

- **WHEN** a source build is packaged for local development or smoke testing and
  run
- **THEN** it uses the `Terminay Development` user-data root and leaves an
  installed release's profile untouched

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

### Requirement: Recoverable path errors and migration safety

A missing project root or recording path SHALL remain represented with a
recoverable error, and the server MUST NOT silently retarget it to another path.
A deleted persisted Local project root MUST NOT turn Desktop startup into a
persistence failure: the project remains available for its explicit repair flow,
while its file and Git bindings and replacement terminal are withheld until its
root is valid again. State migrations SHALL create a recoverable backup or
equivalent rollback point and SHALL be idempotent.

#### Scenario: Deleted Local project root at startup

- **WHEN** Desktop starts with a persisted Local project whose root was deleted
- **THEN** startup succeeds, the project is represented with a recoverable error
  awaiting repair, and its file/Git bindings and replacement terminal are
  withheld

#### Scenario: Repeated migration

- **WHEN** a state migration is retried
- **THEN** it produces the same result and a recoverable backup or rollback point
  exists

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

### Requirement: Authoritative recovery from bad snapshots

A renderer MUST NOT repair an empty or malformed server snapshot by inventing
project, panel, or session identity. Repository initialization or recovery SHALL
either succeed authoritatively or the client SHALL present a bounded failure. An
unreadable snapshot, an invalid snapshot, and a failed first-run commit SHALL all
use that same host-owned recovery surface.

#### Scenario: Malformed snapshot

- **WHEN** the server snapshot is empty, unreadable, invalid, or first-run commit
  fails
- **THEN** the client presents the same bounded host-owned recovery surface and
  invents no project, panel, or session identity

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

### Requirement: Server-derived default project names

The `project.create` workspace command SHALL accept an absent or blank name. When
the name is absent or blank the server SHALL derive the project's default name
from the authoritative project set it holds at the moment the command is applied.
Clients SHALL NOT be relied on to derive a unique default, since no client can
see the authoritative set.

#### Scenario: Command omits a name
- **WHEN** a client applies `project.create` without a name
- **THEN** the server assigns the default name and the created project carries it in the resulting snapshot

#### Scenario: Command supplies a name
- **WHEN** a client applies `project.create` with a non-blank name
- **THEN** the project is created with that name unchanged

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
