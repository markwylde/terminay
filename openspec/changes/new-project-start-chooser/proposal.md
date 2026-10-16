## Why

When a user creates a project, it opens in the folder of the window's first project instead of their home directory. Files, Changes and Documentation then show a repository that the new project has nothing to do with. The spec already forbids this ("New project roots" SHALL NEVER copy another project's root), but the renderer sends the first project's root as the new project's root (`src/App.tsx:6679-6682`, `:7256`) and the disconnected fallback does the same (`src/workspace/useProjectCollection.ts:457-462`).

Fixing the default to home only removes the wrong guess. A new project still does not know which folder the user wants. Terminay should ask: open a folder, work in the home directory with no root folder, or reopen a recent project.

## What Changes

- A project created from the UI with no root starts in an **awaiting start choice** state. Its main panel area shows a start chooser instead of a terminal. No terminal is launched and the project sidebars show nothing until the user chooses.
- The chooser offers three starts:
  - **Open a folder**: a fixed-height folder browser served by the owning server, the same in Desktop, browser and phone clients, with a path field that autocompletes as you type.
  - A project started in a folder (browsed or recent) takes the folder's name, unless the user has already renamed it.
  - **Home directory**: a project with **no root folder**. Its terminal starts in the server account's home, and the Files, Changes and Documentation panes show a "No root folder" state that offers to open a folder.
  - **Recent projects**: the owning server's last 50 explicitly chosen project folders, most recent first. Each entry can be forgotten. Opening one whose folder another project already has shows that project and closes the empty one. Otherwise it sets the folder.
- After the user chooses, Terminay launches the project's first terminal through the normal launch resolver and focuses it.
- A no-root project can gain a root later through Set Project Root or Set Root From Working Directory. It then leaves no-root mode.
- The server keeps a bounded, per-server list of recent project folders, recorded whenever a project's root becomes explicit.
- A server-side directory browse operation lets a client pick a root anywhere the server account can read. It returns directory names only and is authorised the same way as changing a project root.
- The bug is fixed: the client never sends another project's root when it creates a project.
- Projects created with an explicit root (MCP, CLI, a terminal created in an unknown project, re-homing) start immediately and never show the chooser.

## Capabilities

### New Capabilities
- `project-start-chooser`: the awaiting-start-choice state, the chooser and its three starts, no-root projects, the server-owned recent-folders list with forget, and the server-side root folder browser.

### Modified Capabilities
- `workspace-and-project-tabs`: "New project roots" (no inherited root; a UI-created project with no root awaits a choice), "Pending project tab during creation" (the tab becomes ready when the chooser is shown), "Focus after creation" (focus goes to the chooser, then to the terminal after a choice), "Initial terminal in every project" (a project awaiting a choice has no terminal, including after restart), and "Project root selection sources" (open-folder and recent are sources too, and choosing a root takes a no-root project out of no-root mode).
- `workspace-dashboard`: "The main window outlives its last project" (a project created from an empty window shows the chooser).
- `file-explorer-and-folder-tabs`: adds the presentation of the Explorer, Git and Documentation panes for a project with no root folder.
- `server-owned-workspace-state`: "Server-persisted state inventory" adds a project's start state and the per-server recent project folders.

## Impact

- **Renderer** (`src/App.tsx` `createServerProject`, `src/workspace/useProjectCollection.ts` `addProject`, `CompactSwitcher`, `ConnectedWebRendererWorkspace`): stop sending an inherited root, render the chooser in place of the Dockview while a project awaits a choice, and add a no-root empty state to the sidebar panes.
- **Server core** (`packages/server-core/src/workspace.ts`, `workspaceProtocol.ts`, `composition.ts`): new project start state, a `project.start` command, a recent-folders store with `recent.forget`, a bounded directory-browse query, no-root launch in the account home, and restore skipping projects that await a choice.
- **Protocol** (`packages/protocol`): new command, query and snapshot fields, with compatibility negotiated per connection.
- **Persistence**: workspace state gains project start state and recent folders. Existing projects load as started, with their roots unchanged.
- **Tests**: server-core unit tests, renderer tests, and E2E through `npm run test:e2e`.
