# server-owned-workspace-state Specification

## Purpose

Terminay Server owns the canonical workspace model and every privileged service
that acts on its own host or a bound project environment, so that Desktop and
browser clients only render that model, submit validated commands, and keep
device-local presentation and connection state.

## Requirements

### Requirement: Canonical model ownership and client role

Terminay Server SHALL own the canonical workspace model and every privileged
service acting on its own host or a bound project environment. Desktop and
browser clients SHALL render that model, submit validated commands, and keep
only device-local presentation and connection state. The model SHALL preserve
the current project, panel, and immutable terminal-session boundaries while
allowing multiple clients to observe one server, and process lifetime MUST NOT
be tied to any renderer.

#### Scenario: Multiple clients observe one server

- **WHEN** two clients connect to the same server
- **THEN** both observe the same canonical project, panel, and terminal-session
  identities

#### Scenario: Renderer lifetime is independent

- **WHEN** every renderer disconnects
- **THEN** the server's workspace state and terminal processes continue

### Requirement: Canonical object definitions

A **server** SHALL be one workspace, trust, persistence, extension, and
project-environment routing authority with one data root, whose own machine is
the built-in This server environment and not the only possible project target. A
**workspace view** SHALL be a server-owned logical grouping of projects
presentable as an Electron native window or an in-browser view or tab. A
**project environment** SHALL be a stable server-owned execution binding held in
the separate environment registry; workspace state SHALL store its opaque id and
MUST NOT store provider credentials or configuration. A **project** SHALL have a
stable id, immutable project-environment id, root folder interpreted by that
environment, name, colour, icon, optional default shell-profile id, sidebar
layout, ordered panels, and logical layout. A **panel** SHALL have a stable id,
type, project ownership, presentation metadata, and type-specific state.

#### Scenario: Workspace state stores only an environment id

- **WHEN** a project is persisted
- **THEN** its environment binding is stored as an opaque id and no provider
  credentials or configuration are stored in workspace state

#### Scenario: Project fields survive a reconnect

- **WHEN** a fresh client connects
- **THEN** it receives each project's id, environment id, root, name, colour,
  icon, default shell-profile reference, sidebar layout, ordered panels, and
  logical layout from the server

### Requirement: Terminal sessions have immutable server-issued identity

A terminal session SHALL have an immutable server-issued id and a runtime
lifecycle independent of panel mounts. It SHALL snapshot its project's
environment id, and validation SHALL require them to match. A terminal panel
SHALL reference a session; moving the panel MUST NOT recreate the session.

#### Scenario: Moving a terminal panel

- **WHEN** a terminal panel is moved
- **THEN** it continues to reference the same session id and no new session is
  created

#### Scenario: Environment id mismatch

- **WHEN** a session's snapshotted environment id does not match its project's
  environment id
- **THEN** validation fails

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
view through a view switcher. Closing a client window and deleting a logical
workspace view SHALL be separate actions.

#### Scenario: Closing a native window

- **WHEN** the user closes the native window presenting a workspace view
- **THEN** the logical workspace view is not deleted

### Requirement: Server-persisted state inventory

The server SHALL persist and publish ordered workspace views and their project
membership; projects, roots, names, colours, icons, default shell-profile
references, immutable environment references, and sidebar layout configuration;
logical panel layout, splits, order, notes, and appearance; terminal identity,
lifecycle, metadata, bounded output position, activity, and recording state;
file and folder navigation and modes where they are part of the shared
workspace; settings affecting shells, project services, terminal behaviour,
recording, remote exposure, agents, AI providers, macros, and server automation;
macros and server-held secrets; authoritative agent and activity state and
acknowledgement; paired devices, public device keys, exposure state, and audit
records; and schema and revision metadata needed for safe migration and resync.

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
local windows to server and view ids; which project tab and which terminal or
panel is active in each connected presentation; sidebar visibility for each
selected server and project pair; transient dialogs, menus, selection, drag
previews, and optimistic UI state; hardware and host capabilities such as
microphone permission; and explicitly device-specific accessibility or input
overrides. Client-local state MUST NOT be required to recover project
membership, panel identity, or a live terminal after reconnect.

#### Scenario: Active selections differ per client

- **WHEN** two clients of the same server show different active projects and
  terminals
- **THEN** both still share the same ordered project and panel lists

#### Scenario: Recovery without client state

- **WHEN** a client reconnects with no local workspace state
- **THEN** project membership, panel identity, and live terminals are recovered
  from the server

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

### Requirement: Browser connection-host persistence

Browser connection-host persistence SHALL follow the same ownership rule.
Manager storage SHALL contain only sanitized profiles. Origin-bound credentials,
verified bundle caches, and ephemeral renderer state SHALL remain partitioned by
the exact server session origin.

#### Scenario: Manager storage contents

- **WHEN** the browser manager stores a remembered server
- **THEN** only a sanitized profile is stored, and credentials and bundle caches
  stay partitioned by that server's session origin

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

The workspace consistency contract SHALL be multi-client consistency, not
collaborative document editing. File editing SHALL continue to use the
file-viewer conflict contract.

#### Scenario: Concurrent file edits

- **WHEN** two clients edit the same file
- **THEN** the file-viewer conflict contract governs the outcome rather than the
  workspace command protocol

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

A native project-host window SHALL bind to one exact server-owned workspace view
and SHALL derive its project tabs only from that view's ordered project ids. The
host MAY reattach terminal presentation streams between renderers but MUST NOT
synthesize a replacement project id or treat a cross-view move as a project
close.

#### Scenario: Cross-view move

- **WHEN** a project is moved out of a view presented by a native window
- **THEN** the host treats it as a move, not a project close, and synthesizes no
  replacement project id

### Requirement: Privileged services owned by the server

PTY and remote-terminal creation, input, resize, working-directory inspection
where supported, output replay, and termination; terminal signal parsing and
fallback activity reduction; filesystem listing, search, read, write, watch, and
file-conflict detection; Git status, diff, worktree lifecycle, Quick Push, and
provider CLI execution; recording capture, persistence, listing, replay reads,
and deletion; process-bound agent-journal discovery, versioned provider
normalization, status, and lifecycle; MCP and control socket, per-session
capability tokens, and project-scoped tools; settings, macros, AI metadata
generation, and secret-backed automation; and remote pairing, WebRTC
availability, device authentication, revocation, and audit SHALL be authorized,
routed, and lifecycle-owned by Terminay Server and reached only through the
application protocol. Their concrete execution adapter SHALL be resolved from the
canonical project environment.

#### Scenario: Feature parity locally and remotely

- **WHEN** files, Git, recordings, agents, MCP, macros, or settings are used
- **THEN** they work through the same server boundary for local and remote
  project environments

#### Scenario: Adapter resolution

- **WHEN** a privileged operation runs for a project
- **THEN** its execution adapter is resolved from that project's canonical
  environment

### Requirement: Client-host native-only operations

Client hosts SHALL retain native-only operations: BrowserWindow lifecycle,
application updates, operating-system clipboard and dialogs, external-link
confirmation, and local credential storage.

#### Scenario: Host performs a native operation

- **WHEN** the user triggers an application update or an OS dialog
- **THEN** the client host performs it without becoming an authority over
  workspace state

### Requirement: Provider capability honesty

The This server provider SHALL use native host services. SSH and other providers
SHALL implement declared capabilities or return unavailable. An identical path or
executable on the Terminay Server MUST NOT be used as a fallback.

#### Scenario: Provider lacks a capability

- **WHEN** a provider does not implement a requested capability
- **THEN** it returns unavailable and no Terminay Server path or executable is
  substituted

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

Every project SHALL have one exact environment binding, and every panel and
terminal SHALL belong to an exact server, project, and view identity consistent
with it. Requests SHALL carry ids; titles, labels, and client-selected roots MUST
NOT be authority. Project-scoped requests SHALL derive environment routing from
the canonical project; a supplied environment, provider, hostname, IP, or URL
MUST NOT be authority. A connected device MUST NOT refer to a session or object
from another server using a copied id.

#### Scenario: Client supplies a hostname

- **WHEN** a client includes an environment id, provider, hostname, IP, or URL in
  a project-scoped request
- **THEN** routing is derived from the canonical project and the supplied value is
  ignored as authority

#### Scenario: Copied id from another server

- **WHEN** a device sends an object or session id belonging to another server
- **THEN** the request is rejected

#### Scenario: Title change cannot widen scope

- **WHEN** a remote client changes titles, paths, or local state
- **THEN** it obtains no plaintext secrets and no wider project or session scope

### Requirement: Server-side path resolution and boundaries

Filesystem paths SHALL be resolved and validated on the server against the
operation's allowed scope. Symlinks, worktrees, renames, deleted roots, and
platform case rules SHALL be handled at the final canonical-path boundary. MCP
capability tokens SHALL resolve directly to a server terminal and its project;
renderer focus MUST NOT widen scope. Panel movement between unequal environment
ids SHALL fail before mutation.

#### Scenario: Panel move across environments

- **WHEN** a panel is moved between projects with unequal environment ids
- **THEN** the command fails before any mutation

#### Scenario: MCP token scope

- **WHEN** an MCP capability token is used
- **THEN** it resolves to its own server terminal and project regardless of
  renderer focus

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

Client disconnect MUST NOT delete projects, close panels, or kill PTYs. Terminal
exit SHALL update all referencing panels and connected clients once. A
successful-exit close decision SHALL use the terminal surface's already-observed
setting at the exit boundary and MUST NOT wait for another settings request after
the session has ended. Server restart SHALL reload durable workspace state and
SHALL mark formerly live PTYs interrupted unless the process can be safely
reattached.

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
workspace view, one This server project rooted at the server-authorized home,
one terminal panel, and its terminal session before reporting the workspace
ready. Initialization SHALL be idempotent: a client reload, additional native
window, or reconnect MUST NOT create another default project or terminal.

#### Scenario: New data root

- **WHEN** a new server data root is initialized
- **THEN** exactly one workspace view, This server project, terminal panel, and
  terminal session are committed before any client renders the workspace as ready

#### Scenario: Reload after initialization

- **WHEN** a client reloads, opens another native window, or reconnects
- **THEN** no additional default project or terminal is created

### Requirement: Restoring a non-empty repository

A non-empty repository SHALL restore its projects and non-terminal panels. Local
Desktop restart MUST NOT restore terminal tabs: their PTYs died with the local
server, so the server SHALL remove their stale panels and sessions and SHALL
create one fresh terminal in each restored project with a valid root before the
workspace is shown. Previous tab counts MUST NOT be restored. A This-server
project whose persisted root is missing SHALL instead stay represented with its
recoverable error until repaired.

#### Scenario: Local Desktop restart

- **WHEN** Desktop restarts with restored Local projects
- **THEN** stale terminal panels and sessions are removed and one fresh terminal
  is created in each restored project with a valid root before the workspace is
  shown

#### Scenario: Restored project with a missing root

- **WHEN** a restored This-server project's persisted root is missing
- **THEN** it stays represented with its recoverable error and receives no
  replacement terminal until repaired

### Requirement: Remote project restoration

A remote SSH or Puzed project's root SHALL be interpreted only by that
environment, so a path such as `/home/vms` MUST NOT be treated as a missing local
folder and SHALL still receive a replacement terminal. A remote seed that fails
while the environment is still connecting SHALL be retried until the environment
is ready. Explorer SHALL wait until that terminal exists so SFTP cannot occupy
the session channel first. A remote server that remains alive SHALL retain its
live terminal sessions across reconnect.

#### Scenario: Remote root resembles a local path

- **WHEN** a restored SSH or Puzed project's root is a path that does not exist
  on the Terminay Server
- **THEN** it is interpreted only by that environment and still receives a
  replacement terminal

#### Scenario: Environment still connecting

- **WHEN** a remote terminal seed fails because the environment is still
  connecting
- **THEN** it is retried until the environment is ready, and Explorer waits until
  that terminal exists before using the session channel

#### Scenario: Reconnect to a live remote server

- **WHEN** a client reconnects to a remote server that remained alive
- **THEN** its live terminal sessions are retained

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

There SHALL be no cloud synchronization of workspace state, no cross-server
project or terminal identity, no transparent simultaneous editing of one file by
several users, no durable persistence of every ephemeral UI interaction, no
dependence on Electron window ids, browser tab ids, tab titles, or current focus
for authorization, and no Electron-owned mirror of server workspace state or
feature-specific compatibility database.

#### Scenario: Authorization never depends on focus

- **WHEN** an authorization decision is made
- **THEN** it does not depend on an Electron window id, browser tab id, tab
  title, or current focus

#### Scenario: No Electron mirror

- **WHEN** Desktop runs
- **THEN** it maintains no Electron-owned mirror of server workspace state or
  feature-specific compatibility database

### Requirement: Cross-client convergence for panel changes

When either client creates, closes, or moves a panel, the other client SHALL
reach the same workspace revision and panel and session identities without
polling, reload, or an independently manufactured renderer panel.

#### Scenario: One client moves a panel

- **WHEN** one client creates, closes, or moves a panel
- **THEN** the other client converges to the same revision and panel and session
  identities without polling or reload

### Requirement: Typed sidebar feature query state

A valid active project SHALL enable sidebar feature queries with its canonical
server, project, and environment identity. An unscoped query SHALL fail with a
typed, actionable state rather than a generic `query failed` projection. Remote
project-environment routing failures — cancelled, deadline, unavailable, and
capability — SHALL keep those protocol codes through the dispatcher.

#### Scenario: Unscoped sidebar query

- **WHEN** a sidebar feature query is issued without a valid active project scope
- **THEN** it fails with a typed actionable state, not a generic `query failed`

#### Scenario: Remote routing failure

- **WHEN** a remote project-environment routing failure is cancelled, times out,
  is unavailable, or lacks capability
- **THEN** that protocol code is preserved through the dispatcher
