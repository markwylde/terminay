# Server-owned workspace state

## Summary

Terminay Server owns the canonical workspace model and every privileged service
that acts on its own host or a bound project environment. Desktop and browser
clients render that model, submit validated commands, and keep only
device-local presentation and connection state.

The model must preserve the current project, panel, and immutable terminal
session boundaries while allowing multiple clients to observe one server
without tying process lifetime to any renderer.

## Canonical model

- A **server** is one workspace, trust, persistence, extension, and project-
  environment routing authority with one data root. Its own machine is the
  built-in This server environment, not the only possible project target.
- A **workspace view** is a server-owned logical grouping of projects that can
  be presented as an Electron native window or as an in-browser view/tab.
- A **project environment** is a stable server-owned execution binding held in
  the separate environment registry. Workspace state stores its opaque id but
  never provider credentials or configuration.
- A **project** has a stable id, immutable project-environment id, root folder
  interpreted by that environment, name, colour, icon, optional
  default shell-profile id, sidebar layout, ordered panels, and logical layout.
- A **panel** has a stable id, type, project ownership, presentation metadata,
  and type-specific state.
- A **terminal session** has an immutable server-issued id and runtime lifecycle
  independent of panel mounts. It snapshots its project's environment id and
  validation requires them to match. A terminal panel references a session;
  moving the panel does not recreate the session.
- File and folder panels reference canonical paths within their owning project
  scope. Their view mode and navigation state are durable workspace state.

Workspace views avoid using an Electron `BrowserWindow` id as product identity.
Electron may map a view to a native window; web clients may render the same
view through a view switcher. Closing a client window and deleting a logical
workspace view are separate actions.

## Server-owned state

The server persists and publishes:

- ordered workspace views and their active project;
- projects, roots, names, colours, icons, default shell-profile references,
  immutable environment references, and sidebar layout configuration;
- logical panel layout, active panel, splits, order, notes, and appearance;
- terminal identity, lifecycle, metadata, bounded output position, activity,
  and recording state;
- file/folder navigation and modes where they are part of the shared workspace;
- settings affecting shells, project services, terminal behaviour, recording,
  remote exposure, agents, AI providers, macros, and server automation;
- macros and server-held secrets;
- authoritative agent/activity state and acknowledgement;
- paired devices, public device keys, exposure state, and audit records; and
- schema and revision metadata needed for safe migration and resync.

The persistence contract does not include unbounded terminal scrollback, live
PTY serialization, transient search text, open modal state, hover state, or
in-progress drag geometry.

## Client-owned state

Desktop or browser hosts keep only state that is inherently local to that
device:

- remembered server labels and non-secret connection metadata;
- encrypted device keys and reconnect credentials;
- native window geometry and the mapping from local windows to server/view ids;
- browser-tab choice when it is not intended to change shared active state;
- sidebar visibility for each selected server/project pair;
- transient dialogs, menus, selection, drag previews, and optimistic UI state;
- hardware and host capabilities such as microphone permission; and
- explicitly device-specific accessibility/input overrides where using the
  server preference would be inappropriate.

Client-local state must not be required to recover project membership, panel
identity, or a live terminal after reconnect.

Desktop persistence is allowlisted to non-secret connection profiles,
OS-protected device credentials, native window geometry, exact
window-to-server/view bindings, verified content-addressed bundle caches,
application update state, OS permission decisions, and explicitly
device-specific preferences. It does not persist workspace snapshots,
application-protocol DTOs, project roots, panel state, terminal state, server
settings, or server capability projections as a second authority. A cached
projection used while connected is disposable and is always resynchronized
from the selected server.

Browser connection-host persistence follows the same ownership rule. Manager
storage contains only sanitized profiles; origin-bound credentials, verified
bundle caches, and ephemeral renderer state remain partitioned by the exact
server session origin.

## Commands, revisions, and conflicts

- The server publishes a complete initial snapshot with a monotonically
  increasing workspace revision.
- Durable mutations are named commands such as create/move/rename/close rather
  than replacement uploads of an opaque Dockview JSON document.
- A command declares the object ids and expected revision it depends on.
- The server validates authorization and invariants, commits once, assigns the
  next revision, and publishes one ordered result event.
- A duplicated command id returns its recorded outcome rather than applying
  twice.
- A stale non-conflicting command may be rebased only where semantics are
  explicit. Otherwise the server returns a conflict with the current revision.
- Clients that miss events request a delta from a known revision or a fresh
  snapshot.
- A workspace delta has one versioned wire shape containing the resulting
  project-scoped state and the ordered change records since the requested
  revision. Clients validate that envelope, advance atomically to its embedded
  state, and never parse the envelope itself as a complete workspace snapshot.
- Snapshot and delta validation failures leave the last confirmed projection
  marked stale and trigger a bounded full-snapshot recovery. They are surfaced
  as connection/reconciliation failures rather than discarded while the UI
  continues to present stale state as current.
- Optimistic UI is allowed only when rollback is deterministic; destructive
  filesystem, Git, secret, recording, and terminal-lifecycle actions wait for
  server confirmation.
- Closing a canonical terminal panel is command-first: the renderer waits for
  the server close result and a reconciled snapshot before completing the UI
  action. Dockview removal is a projection of that confirmed state and must not
  launch a second close command from a stale revision. Busy PTY teardown and
  snapshot convergence share a bounded 10-second lifecycle budget.

This is multi-client consistency, not collaborative document editing. File
editing continues to use the file-viewer conflict contract.

## Logical layout and client rendering

- The canonical layout describes panel relationships, split direction/weight,
  order, and active identities without embedding screen pixels or Electron
  window handles.
- Wide desktop clients render the full Dockview workspace.
- Narrow clients adapt the same project and panel model into selectors,
  stacked/tabbed surfaces, drawers, and touch controls without creating a
  second workspace model.
- A client may keep temporary local split measurements while dragging, then
  commit normalized weights.
- Native popout/adoption becomes movement between server-owned workspace views.
  Popping out an active terminal moves its owning project into a new logical
  view and presents that view as a native window; a renderer must never create
  an independent terminal-only browser window or transfer PTY ownership.
  It never transfers PTY ownership between renderers.
- A native project-host window binds to one exact server-owned workspace view
  and derives its project tabs only from that view's ordered project ids. The
  host may reattach terminal presentation streams between renderers, but it
  never synthesizes a replacement project id or treats a cross-view move as a
  project close.
- Web clients can manage logical views without requiring browser popup windows.

## Privileged service ownership

The following are authorized, routed, and lifecycle-owned by Terminay Server
and reached only through the application protocol. Their concrete execution
adapter is resolved from the canonical project environment:

- PTY/remote-terminal creation, input, resize, cwd inspection where supported,
  output replay, and termination;
- terminal signal parsing and fallback activity reduction;
- filesystem listing/search/read/write/watch and file-conflict detection;
- Git status, diff, worktree lifecycle, Quick Push, and provider CLI execution;
- recording capture, persistence, listing, replay reads, and deletion;
- process-bound agent-journal discovery, versioned provider normalization,
  status, and lifecycle;
- MCP/control socket, per-session capability tokens, and project-scoped tools;
- settings, macros, AI metadata generation, and secret-backed automation;
- remote pairing, WebRTC availability, device auth, revocation, and audit.

Client hosts retain native-only operations such as BrowserWindow lifecycle,
application updates, operating-system clipboard/dialogs, external-link
confirmation, and local credential storage.

The This server provider uses native host services. SSH and other providers
must implement declared capabilities or return unavailable; an identical path
or executable on the Terminay Server is never a fallback.

The host may map a local native window or browser tab to a server-owned logical
view, but that mapping is presentation metadata only. Opening, focusing, or
closing a native window does not create, mutate, transfer, or delete server
workspace state unless the user separately invokes the corresponding typed
workspace command.

Dictation is split deliberately: the client captures microphone audio after
local permission, while server policy, provider credentials, transcription,
and insertion into the intended terminal remain server-authorized operations.

## Project and path boundaries

- Every project has one exact environment binding, and every panel/terminal
  belongs to an exact server/project/view identity consistent with it.
- Requests carry ids, not titles, labels, or client-selected roots as authority.
- Project-scoped requests derive environment routing from the canonical project;
  a supplied environment/provider/hostname/IP/URL is never authority.
- Filesystem paths are resolved and validated on the server against the
  operation's allowed scope.
- Symlinks, worktrees, renames, deleted roots, and platform case rules are
  handled at the final canonical-path boundary.
- MCP capability tokens resolve directly to a server terminal and its project;
  renderer focus cannot widen scope.
- A connected device cannot refer to a session or object from another server
  using a copied id.
- Panel movement between unequal environment ids fails before mutation.

## Settings and secrets

- Settings are classified as server, connection-host, or temporary client state
  rather than stored in one undifferentiated Electron JSON file.
- Server settings are normalized and migrated by the server and broadcast with
  revisions.
- Server secrets use a pluggable vault. Embedded mode uses an OS-backed
  protector for its server vault wrapping key without exposing plaintext to a
  renderer or workspace bundle.
- Electron safe storage protects embedded-vault wrapping keys only when the
  platform reports an OS-backed encryption backend. Linux `basic_text` storage
  is unavailable for this purpose.
- A headless vault wraps its data-encryption key in a versioned, bounded
  passphrase envelope using the specified scrypt parameters. Unlock input comes
  only from an echo-disabled controlling terminal or a one-shot inherited file
  descriptor; command-line arguments, environment variables, ordinary stdin,
  and a plaintext key beside the ciphertext are not unlock mechanisms.
- The selected server-core headless adapter persists that envelope through an
  injected server storage boundary (the file implementation uses mode-0600
  replace-by-rename writes), authenticates its metadata, zeroizes passphrase,
  derived-key, and scoped plaintext buffers, and starts locked after restart.
  Its protocol-facing status and references contain metadata only; Electron
  safe storage remains a separate embedded protector boundary.
- The canonical state repository rejects a complete but stale vault envelope
  using its expected revision.
- Secret values are not included in workspace snapshots, audit events, logs, or
  normal settings responses.
- Macro execution resolves secret placeholders on the server and writes the
  result directly to the authorized PTY.

## Lifecycle and recovery

- Source-development Desktop uses a dedicated `Terminay Development` user-data
  root, including when a source build is temporarily packaged by Electron
  Builder for local development or smoke testing. A development build must not
  migrate or otherwise mutate an installed Desktop release's profile.
- Client disconnect never deletes projects, closes panels, or kills PTYs.
- Terminal exit updates all referencing panels and connected clients once. A
  successful-exit close decision uses the terminal surface's already-observed
  setting at the exit boundary; it does not wait for another settings request
  after the session has ended.
- Server restart reloads durable workspace state and marks formerly live PTYs
  interrupted unless the process can be safely reattached.
- A missing project root or recording path remains represented with a
  recoverable error; the server does not silently retarget it to another path.
- State migrations create a recoverable backup or equivalent rollback point and
  are idempotent.

## First-run initialization

- A new server data root is initialized through the canonical repository, not
  by a renderer or host adapter.
- Initialization atomically commits one workspace view, one This server
  project rooted at the server-authorized home, one terminal panel, and its
  terminal session before reporting the workspace ready.
- Initialization is idempotent. A client reload, additional native window, or
  reconnect cannot create another default project or terminal.
- A non-empty repository restores its projects and non-terminal panels. Local
  Desktop restart does not restore terminal tabs: its PTYs died with the local
  server, so the server removes their stale panels and sessions and creates one
  fresh terminal in each restored project before the workspace is shown. A
  project is never presented without a terminal. Previous tab counts are not
  restored. A remote server that remains alive retains its live terminal
  sessions across reconnect.
- A renderer never repairs an empty or malformed server snapshot by inventing
  project, panel, or session identity. Repository initialization or recovery
  either succeeds authoritatively or the client presents a bounded failure.

## Non-goals

- No cloud synchronization of workspace state.
- No cross-server project or terminal identity.
- No transparent simultaneous editing of one file by several users.
- No durable persistence of every ephemeral UI interaction.
- No dependence on Electron window ids, browser tab ids, tab titles, or current
  focus for authorization.
- No Electron-owned mirror of server workspace state or feature-specific
  compatibility database.

## Acceptance outcomes

- A new server data root publishes exactly one initialized workspace view,
  This server project, terminal panel, and terminal session before any client
  renders the workspace as ready.
- A project with terminal, file, and folder panels reconnects from a fresh
  client using only server state.
- Closing or reloading the owning Electron window does not kill its PTYs.
- Two connected clients receive one ordered result for each committed workspace
  command and recover cleanly from a revision conflict.
- When either client creates, closes, moves, or activates a panel, the other
  client reaches the same workspace revision and panel/session identities
  without polling, reload, or an independently manufactured renderer panel.
- A malformed, stale, or incompatible delta cannot partially mutate a client
  projection; the client reports stale state and recovers from a complete
  authorized snapshot.
- Moving a project between logical views preserves panel/session ids and
  service scope.
- Files, Git, recordings, agents, MCP, macros, and settings work through the
  same server boundary locally and remotely.
- A valid active project enables sidebar feature queries with its canonical
  server/project/environment identity; an unscoped query fails with a typed,
  actionable state rather than a generic `query failed` projection.
- A remote client cannot obtain plaintext secrets or widen a project/session
  scope by changing titles, paths, or local state.
