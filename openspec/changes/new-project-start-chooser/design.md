## Context

A new project gets its root from the renderer, not the server. `createServerProject` (`src/App.tsx:7192`) sends `defaultProjectRoot`, which is the root of the first project in the view (`src/App.tsx:6679-6682`, sent at `:7256`). The disconnected fallback `addProject` (`src/workspace/useProjectCollection.ts:457-462`) prefers the active project's root. The server already fills an empty root with its default (`withDefaultProjectRoot`, `packages/server-core/src/workspaceProtocol.ts:986-997`), which is the account home on Desktop (`electron/main.ts:4757`) and `--project-root` / `TERMINAY_PROJECT_ROOT` / cwd on a standalone server. The client just never sends an empty root while another project exists.

`WorkspaceProject.root` is a required string with `rootOrigin: explicit | server-default | legacy-unverified` (`packages/server-core/src/workspace.ts:60-64, 228-249`). The workspace persists as one JSON file through `FileWorkspaceStateBackend` at schema version 6. Sidebars resolve the root through `featureProjectRoot()` and have no "no root" state: an empty root silently skips Explorer loading, and Git shows "Not a git repository". Nothing records recent folders, and no server-side directory picker exists. The only native dialog is `file.choose` for files, and it would show the client device's disk, not the server's.

## Goals / Non-Goals

**Goals:**
- A UI-created project never inherits another project's root.
- A UI-created project waits for an explicit start choice, held on the server and the same in every client.
- A no-root project mode whose sidebars are inert.
- A per-server recent-folders list (max 50) with forget.
- A server-side folder browser that works in Desktop, browser and phone clients.

**Non-Goals:**
- Restoring a recent project's name, colour, icon, layout or panels. A recent entry is a folder only.
- Changing projects created with an explicit root (MCP, CLI, terminal-in-unknown-project, re-home, restore).
- Changing the standalone server's `--project-root` default. It still seeds explicit-less creation from older clients.
- Migrating existing projects. They load as started with their current roots.

## Decisions

### 1. Start state and no-root are server-owned project fields

`WorkspaceProject` gains `start?: 'awaiting-choice'` (absent means started) and a new `rootOrigin: 'none'` with `root: ''`. A project awaiting a choice also has `rootOrigin: 'none'`. Schema version 6 → 7. The migration leaves every existing project untouched, because absent `start` already means started.

*Why:* The state has to survive restart and look the same on every client (`server-owned-workspace-state`), so it cannot be renderer-local. Keeping `root` a required string and encoding "no root" as an origin keeps every existing `root` reader type-safe. The origin guard in `workspace.ts:910` forces each consumer to handle `none` explicitly.
*Alternative:* make `root` optional. Rejected: it touches every root reader and loses the provenance guard.
*Boundary:* project/window boundary. A no-root project is still a full project-identity boundary for MCP, recordings and agent status. Only filesystem features are inert.

### 2. `project.create` without a root yields an awaiting project, negotiated by capability

When a connection that negotiated the new feature capability `projectStartChoice` sends `project.create` with no root, the server commits the project with `start: 'awaiting-choice'` and the client launches no terminal. A connection without that capability gets today's behaviour: the server default root and an immediate terminal. The renderer's root-inheritance code is deleted in both `createServerProject` and `addProject`.

*Why:* Per-connection compatibility negotiation (ADR-0047). An older bundle must never receive a project it cannot render.
*Boundary:* client code is untrusted. The server decides the start state, and a client cannot create a started no-root project except through `project.start`.

### 3. `project.start` is one idempotent command

`project.start { projectId, choice: { kind: 'folder', path } | { kind: 'home' } }`. A recent entry is sent as `folder`. In one transaction the server checks `start === 'awaiting-choice'`, failing with `start_conflict` if not, validates and canonicalizes the folder (explicit provenance), clears `start`, records the folder in recents, and commits. The first terminal launches through the normal terminal-launch resolver as the same explicit creation flow `project.create` uses today. On restore, the server and Desktop skip the "one fresh terminal" step for projects still awaiting a choice.

*Why:* First choice wins across clients with no races (spec: "A start choice is one server command"). Validation failure leaves the state untouched.
*Boundary:* server-side path resolution. The path is resolved and validated on the owning server (ADR-0020: canonicalized once, not cached).

### 4. No-root launch uses the verified account home

The terminal-launch resolver treats `rootOrigin: 'none'` as "no project directory" and falls back to `terminalLaunchPathAuthority.homeDirectory` unless the request carries an explicit cwd. `featureProjectRoot()` returns a typed `no-root` result. The Explorer, Git and Documentation controllers render a "No root folder" empty state from it and issue no query, and the server also rejects feature queries for a no-root project with a typed `no_project_root` error.

*Why:* The spec asks for sidebars that "basically don't do anything". Refusing on the server as well as in the renderer keeps the authority boundary on the server.
*Alternative:* treat home as the root. Rejected: Explorer and the Git watch would scan the whole home tree, which is the exact cost ADR-0021 and ADR-0028 guard against.

### 5. Recent folders live in workspace state, per server

`WorkspaceState.recentProjectFolders: { path, usedAt }[]` holds at most 50 entries, ordered by `usedAt` descending and deduplicated by canonical path. The server records an entry from inside `project.start(folder)` and `project.root.update` when the resulting origin is `explicit`. `recent.forget { path }` removes one. Availability (whether the folder exists) is checked when the chooser asks for the list, through a bounded stat-only query. It is not stored.

*Why:* Recents are server facts. `connections-and-client-hosts` forbids keeping project roots in client storage, and roots mean nothing on another server. Workspace state already gives revisioned broadcast, so a forget converges on every client.
*Boundary:* none crossed. The paths are of the same class as project roots already in the snapshot.

### 6. A server-side root folder browse query

`fs.browseRootFolders { path? }` → `{ path, parent?, entries: { name }[], truncated }`, with at most 1000 directory names and the account home by default. It lists directories only, with no file names or metadata, and canonicalizes on every request. It requires the same device authority as `project.root.update`. It is not exposed through MCP. The chooser and the no-root empty state share one `RootFolderBrowser` component, rendered through the in-page window frame (ADR-0053).

*Why:* It works for remote and phone clients, and it follows the existing rule that a root is "browsed and validated on the server that will own it".
*Boundary:* this is the first filesystem query not contained by a project root, so it crosses the server filesystem boundary of ADR-0011. ADR-0066 records the scope: names of directories only, root-change authority, no MCP.
*Alternative:* the native dialog on Desktop with the server browser elsewhere. Rejected by the owner: one browser everywhere, and a native dialog shows the wrong machine for a remote server.

### 7. Chooser presentation

When `start === 'awaiting-choice'`, the project's main area renders `ProjectStartChooser` instead of the Dockview, and the sidebar group renders nothing. Focus goes to the first action (Open a folder). Recent rows show the folder name and full path, with a Forget control. Unavailable rows are disabled but stay forgettable. In the compact layout it is a single vertical column.

## Risks / Trade-offs

- [An older client attached to a new server sees an awaiting project from a newer client] → The snapshot for a connection without `projectStartChoice` presents the project as having no root, and the older client shows its existing empty Explorer. It can still set a root, and `project.root.update` on an awaiting project also clears `start`.
- [Browsing the whole server filesystem from a paired phone] → Directory names only, root-change authority, bounded, and no MCP. A device with that authority can already run a shell, so this adds no new capability.
- [Restore code paths that assume every project has a terminal] → Covered by a restore unit test and an E2E restart scenario.
- [The recents list grows the snapshot] → Bounded at 50 short entries.

## Migration Plan

Schema 6 → 7 is additive: `recentProjectFolders` defaults to empty and existing projects carry no `start`. Rolling back to an older server after a v7 state has been written is not supported. The older validator rejects the unknown `start` key and the `none` origin (`workspace.ts:908-914`), so the older server refuses the state instead of misreading it. That fails closed and needs no extra handling.

## Open Questions

- None blocking. ADR-0002 (SQLite) still describes a backend the workspace does not use. This change, like `linked-folders`, writes against the JSON backend and does not revisit that ADR.
