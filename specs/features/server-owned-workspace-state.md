# Server-owned workspace state

## Summary

Terminay Server owns the canonical workspace model and every privileged service
that acts on the server machine. Desktop and browser clients render that model,
submit validated commands, and keep only device-local presentation and
connection state.

The model must preserve the current project, panel, and immutable terminal
session boundaries while allowing multiple clients to observe one server
without tying process lifetime to any renderer.

## Canonical model

- A **server** is one authority, data root, trust domain, and machine context.
- A **workspace view** is a server-owned logical grouping of projects that can
  be presented as an Electron native window or as an in-browser view/tab.
- A **project** has a stable id, root folder, name, colour, icon, sidebar state,
  ordered panels, and logical layout.
- A **panel** has a stable id, type, project ownership, presentation metadata,
  and type-specific state.
- A **terminal session** has an immutable server-issued id and PTY lifecycle
  independent of panel mounts. A terminal panel references a session; moving
  the panel does not recreate the session.
- File and folder panels reference canonical paths within their owning project
  scope. Their view mode and navigation state are durable workspace state.

Workspace views avoid using an Electron `BrowserWindow` id as product identity.
Electron may map a view to a native window; web clients may render the same
view through a view switcher. Closing a client window and deleting a logical
workspace view are separate actions.

## Server-owned state

The server persists and publishes:

- ordered workspace views and their active project;
- projects, roots, names, colours, icons, and sidebar configuration;
- logical panel layout, active panel, splits, order, notes, and appearance;
- terminal identity, lifecycle, metadata, bounded output position, activity,
  and recording state;
- file/folder navigation and modes where they are part of the shared workspace;
- settings affecting shells, project services, terminal behaviour, recording,
  remote exposure, agents, AI providers, macros, and server automation;
- macros and server-held secrets;
- authoritative agent/activity state and acknowledgement;
- paired devices, reconnect grants, exposure state, and audit records; and
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
- transient dialogs, menus, selection, drag previews, and optimistic UI state;
- hardware and host capabilities such as microphone permission; and
- explicitly device-specific accessibility/input overrides where using the
  server preference would be inappropriate.

Client-local state must not be required to recover project membership, panel
identity, or a live terminal after reconnect.

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
- Optimistic UI is allowed only when rollback is deterministic; destructive
  filesystem, Git, secret, recording, and terminal-lifecycle actions wait for
  server confirmation.

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
  It never transfers PTY ownership between renderers.
- Web clients can manage logical views without requiring browser popup windows.

## Privileged service ownership

The following run in Terminay Server and are reached only through the
application protocol:

- PTY creation, input, resize, cwd inspection, output replay, and termination;
- terminal signal parsing and fallback activity reduction;
- filesystem listing/search/read/write/watch and file-conflict detection;
- Git status, diff, worktree lifecycle, Quick Push, and provider CLI execution;
- recording capture, persistence, listing, replay reads, and deletion;
- agent hook receiver, provider normalization, trust, status, and lifecycle;
- MCP/control socket, per-session capability tokens, and project-scoped tools;
- settings, macros, AI metadata generation, and secret-backed automation;
- remote pairing, WebRTC availability, device auth, revocation, and audit.

Client hosts retain native-only operations such as BrowserWindow lifecycle,
application updates, operating-system clipboard/dialogs, external-link
confirmation, and local credential storage.

Dictation is split deliberately: the client captures microphone audio after
local permission, while server policy, provider credentials, transcription,
and insertion into the intended terminal remain server-authorized operations.

## Project and path boundaries

- Every panel and terminal belongs to an exact server/project/view identity.
- Requests carry ids, not titles, labels, or client-selected roots as authority.
- Filesystem paths are resolved and validated on the server against the
  operation's allowed scope.
- Symlinks, worktrees, renames, deleted roots, and platform case rules are
  handled at the final canonical-path boundary.
- MCP capability tokens resolve directly to a server terminal and its project;
  renderer focus cannot widen scope.
- A connected device cannot refer to a session or object from another server
  using a copied id.

## Settings and secrets

- Settings are classified as server, connection-host, or temporary client state
  rather than stored in one undifferentiated Electron JSON file.
- Server settings are normalized and migrated by the server and broadcast with
  revisions.
- Server secrets use a pluggable vault. Embedded migration may use Electron
  safe storage to decrypt old records and import them over the private local
  bootstrap channel.
- A headless vault must document its unlock/key-management policy. Merely
  placing an encryption key beside ciphertext is not described as secure
  storage.
- Secret values are not included in workspace snapshots, audit events, logs, or
  normal settings responses.
- Macro execution resolves secret placeholders on the server and writes the
  result directly to the authorized PTY.

## Lifecycle and recovery

- Client disconnect never deletes projects, closes panels, or kills PTYs.
- Terminal exit updates all referencing panels and connected clients once.
- Server restart reloads durable workspace state and marks formerly live PTYs
  interrupted unless the process can be safely reattached.
- A missing project root or recording path remains represented with a
  recoverable error; the server does not silently retarget it to another path.
- State migrations create a recoverable backup or equivalent rollback point and
  are idempotent.

## Legacy data migration

- Supported terminal settings, macros, encrypted secrets, remote device grants,
  audit records, and recording paths are imported into the embedded server data
  root exactly once.
- Electron performs any safe-storage decryption needed for migration without
  writing plaintext migration files.
- Legacy state that was never persisted is represented by a new default
  workspace; the migration does not claim to recover unavailable data.
- Existing recordings and project files are referenced in place unless the user
  explicitly requests a move.
- Migration records source version, destination schema, completion, and
  recoverable failure details.

## Non-goals

- No cloud synchronization of workspace state.
- No cross-server project or terminal identity.
- No transparent simultaneous editing of one file by several users.
- No durable persistence of every ephemeral UI interaction.
- No dependence on Electron window ids, browser tab ids, tab titles, or current
  focus for authorization.

## Acceptance outcomes

- A project with terminal, file, and folder panels reconnects from a fresh
  client using only server state.
- Closing or reloading the owning Electron window does not kill its PTYs.
- Two connected clients receive one ordered result for each committed workspace
  command and recover cleanly from a revision conflict.
- Moving a project between logical views preserves panel/session ids and
  service scope.
- Files, Git, recordings, agents, MCP, macros, and settings work through the
  same server boundary locally and remotely.
- A remote client cannot obtain plaintext secrets or widen a project/session
  scope by changing titles, paths, or local state.
