## MODIFIED Requirements

### Requirement: Canonical workspace objects

A **server** SHALL be one workspace, trust, persistence, and extension authority
with one data root, and SHALL execute every project it owns on its own machine. A
**workspace view** SHALL be a server-owned logical grouping of projects
presentable as an Electron native window or an in-browser view or tab. A
**project** SHALL have a stable id, a root folder on the server's filesystem,
name, colour, icon, optional default shell-profile id, sidebar layout, and an
ordered list of folders. A **folder** SHALL have a stable id, project ownership,
a name, a kind, an optional link to one worktree of the project's repository,
ordered panels, and logical layout. A **panel** SHALL have a stable id, type,
project and folder ownership, presentation metadata, and type-specific state.

#### Scenario: A project root is a path on the server

- **WHEN** a project is persisted
- **THEN** its root is stored as a folder on the server's filesystem and no
  credentials or connection configuration are stored in workspace state

#### Scenario: Project fields survive a reconnect

- **WHEN** a fresh client connects
- **THEN** it receives each project's id, root, name, colour, icon, default
  shell-profile reference, sidebar layout, and ordered folders, and each
  folder's id, name, kind, worktree link, ordered panels, and logical layout,
  from the server

#### Scenario: A folder link is a server fact

- **WHEN** a linked folder is persisted
- **THEN** its link identifies a worktree the server itself listed for the
  project's repository, and no client-supplied path is stored as a folder root

### Requirement: Server-persisted state inventory

The server SHALL persist and publish ordered workspace views and their project
membership; projects, roots, names, colours, icons, default shell-profile
references, and sidebar layout configuration; each project's ordered folders,
their names, kinds, worktree links, and pending capture offers; logical panel
layout, splits, order, notes, and appearance for each folder; terminal identity,
lifecycle, metadata, bounded output position, activity, and recording state;
file and folder navigation and modes where they are part of the shared
workspace; settings affecting shells, project services, terminal behaviour,
recording, remote exposure, agents, AI providers, macros, and server automation;
macros and server-held secrets; authoritative agent and activity state and
acknowledgement; paired devices, public device keys, exposure state, and audit
records; and schema and revision metadata needed for safe migration and resync.

#### Scenario: Fresh client rebuilds the workspace

- **WHEN** a project with terminal, file, and folder panels spread over several
  folders is reopened from a fresh client
- **THEN** it reconnects using only server state, with every panel in the folder
  it was in

#### Scenario: Agent and activity state is authoritative on the server

- **WHEN** a client queries agent or activity state
- **THEN** the server's authoritative state and acknowledgement are returned

### Requirement: Excluded from the persistence contract

The persistence contract MUST NOT include unbounded terminal scrollback, live
PTY serialization, transient search text, open modal state, hover state,
in-progress drag geometry, or which project tab, folder, or terminal panel is
active in a connected presentation.

#### Scenario: Active tab is not durable server state

- **WHEN** a client changes its active project tab, selected folder, or active
  terminal
- **THEN** no durable workspace state records that choice

### Requirement: Client-owned device-local state

Desktop and browser hosts SHALL keep only state inherently local to that device:
remembered server labels and non-secret connection metadata; encrypted device
keys and reconnect credentials; native window geometry and the mapping from
local windows to server and view ids; the window's composition, being its primary
connection, its set of attached connections, the workspace view attached on each
of them, and the order of the project tabs drawn from them; which project tab,
which folder, and which terminal or panel is active in each connected
presentation; the Home tabs open on the device and their arrangement; sidebar
visibility and Folders tree visibility and width for each server and project
pair; transient dialogs, menus, selection, drag previews, and optimistic UI
state; hardware and host capabilities such as microphone permission; and
explicitly device-specific accessibility or input overrides. The composition and
the Home tab arrangement MUST NOT be sent to any server. Client-local state
MUST NOT be required to recover project membership, folder membership, panel
identity, or a live terminal after reconnect.

#### Scenario: Active selections differ per client

- **WHEN** two clients of the same server show different active projects,
  folders, and terminals
- **THEN** both still share the same ordered project, folder, and panel lists

#### Scenario: Recovery without client state

- **WHEN** a client reconnects with no local workspace state
- **THEN** project membership, folder membership, panel identity, and live
  terminals are recovered from the server

#### Scenario: Composition is device-local

- **WHEN** a window attaches a server, reorders its tabs, and another device
  connects to the same servers
- **THEN** the composition is stored only on the first device, no server records
  it, and the second device keeps its own composition

#### Scenario: Home tabs are device-local

- **WHEN** a device opens, arranges, and closes Home tabs
- **THEN** no server records the change and no other device's Home tabs change

## ADDED Requirements

### Requirement: Folder changes are named workspace commands

Creating, renaming, reordering, and deleting a folder, moving a panel between
folders, and accepting or declining a capture offer SHALL each be a named
workspace command validated and committed by the server under the same revision,
idempotency, and conflict rules as every other workspace command. A command
SHALL be refused when it names a folder outside its project, would leave a panel
without a folder, would rename, reorder, or delete General, or would delete a
linked folder whose worktree exists. Folders the server creates or removes to
follow the repository's worktrees, and moves it makes to capture a terminal,
SHALL be committed through the same commands and published as ordinary revisions.

#### Scenario: Deleting General

- **WHEN** a client submits a command that deletes a project's General folder
- **THEN** the server refuses it and the workspace revision is unchanged

#### Scenario: Server-made folder

- **WHEN** the server creates a linked folder for a newly observed worktree
- **THEN** every connected client receives it as an ordinary workspace revision

#### Scenario: Two devices move the same panel

- **WHEN** two devices submit conflicting folder moves for one panel
- **THEN** one commits, the other is resolved by the ordinary conflict rules, and
  both devices converge on the same folder
