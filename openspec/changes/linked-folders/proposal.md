## Why

A project has two layers today, the project and its terminals, in one panel layout. Work on a project is rarely one thing: there is a dev server, a couple of agents each on their own branch, and a shell or two. Those all share one layout and one strip of tabs, so a task has no home, and the worktree an agent is working in is listed in the Git pane on the far side of the window from the terminal doing the work. Reaching a terminal in another project means leaving the current one to look.

The technical gap behind that is that the workspace model has no object between a project and a panel, and that a project is bound to exactly one filesystem root, so showing another worktree's files means switching the root of the whole project.

## What Changes

- Add **folders**, a level between project and terminal. A folder holds panels and has its own panel layout. Every project has a **General** folder, where new terminals land.
- Add a **Folders tree** on the left of each project, listing the project's folders and the terminals in each. Selecting a folder shows its layout; selecting a terminal focuses it.
- **Every Git worktree of the project's repository gets a folder.** General is the checkout at the project root. A linked folder shows its branch, pull request, and CI, and a terminal created in it starts in that worktree. Users can also create plain folders by hand.
- **Capture the worktree an agent creates.** When a terminal creates a worktree, Terminay creates the linked folder and moves that terminal into it, with Undo. A server setting, on by default, turns the automatic move off; the folder still appears and offers to take the terminal.
- **BREAKING** The project sidebar (Explorer, Documentation, Agents) moves to the right of the panel area and follows the selected folder. Files shows the selected folder's root.
- **BREAKING** The Git pane becomes **Changes**, showing the working-tree changes of the selected folder's worktree. The worktree list leaves the pane; its row actions (Commit & push with AI, Pull from origin, Rename worktree, Delete worktree, Copy path, Copy relative path, Open shell in folder, Reveal in OS) move to the folder's context menu. A plain folder offers the same menu without the Git actions.
- **BREAKING** "Switch project root" is removed from the worktree actions. Selecting a linked folder points Files and Changes at its worktree without changing the project's root, and file operations in a worktree no longer switch the root first.
- **BREAKING** Closing the last panel no longer closes the project. A folder with no panels shows a placeholder that says so and offers New terminal, the way Home does when no tabs are open.
- Deleting a plain folder, or deleting the worktree of a linked folder, asks first when the folder still holds panels: move them to General, or close them. A linked folder is removed only by deleting its worktree.
- Add **tab peek**: hovering a project tab that is not active shows that project's Folders tree, and choosing a terminal there switches straight to it.
- A project that is not a Git repository has General and any folders the user makes. It shows no branch lines and no suggestions, and Changes reports that the folder is not a repository.

Project tabs stay in the title bar and keep reordering and tear-off into new windows.

## Capabilities

### New Capabilities

- `project-folders`: folders within a project, the General folder, the Folders tree, folders linked to Git worktrees, capturing a terminal into the folder of a worktree it created, the folder context menu, and how the rest of the project follows the selected folder.

### Modified Capabilities

- `workspace-and-project-tabs`: a project is composed of folders that each hold a panel layout; new panels open in the selected folder; a panel can move between folders; closing the final panel leaves the project open; project tabs gain tab peek.
- `project-sidebar-layout`: the project sidebar sits to the right of the panel area; the Explorer group holds Files and Changes; Folders tree visibility is a device preference.
- `git-worktrees-and-quick-push`: the Git pane is the Changes pane for the selected folder's worktree; worktree actions are folder actions; switching the project root between worktrees is removed.
- `file-explorer-and-folder-tabs`: the Explorer watches the root of the selected folder; Files shares its group with Changes.
- `shell-profiles-and-terminal-launch`: the directory a new terminal falls back to is the root of its folder, not always the project root.
- `server-owned-workspace-state`: folders are canonical, server-persisted workspace objects; the selected folder and Folders tree visibility are device-local.
- `mcp-server`: a terminal opened through MCP lands in the caller's folder.

## Impact

- **Workspace model** (`packages/server-core/src/workspace.ts`, `workspaceProtocol.ts`, `workspaceRepository.ts`): a new folder object, `folderId` on panels, per-folder layout and panel order, new named commands, schema version 6, and the first stepwise migration from version 5.
- **Git and worktree observation** (`packages/server-core/src/gitService/`, `worktreeInsights/`): a server-side reconciler that keeps one linked folder per listed worktree, driven by the existing registry watch. No new watcher and no timer.
- **Filesystem and Git authorization**: a project's operations may target the root of any of its linked folders, resolved by the server from the worktree listing. This widens what a project scope can read and write and is recorded as a new ADR.
- **Terminal launch** (`terminalService/launchResolver.ts`): the launch intent carries a folder.
- **Worktree attribution** (`packages/server-core/src/terminalService/`, `activity/processAncestry.ts`): the server works out which terminal ran the command that created a worktree, from the terminal's own processes and Git, never from the agent (ADR-0051). The proposed mechanism adds Git tracing variables to the environment of Terminay's terminals and a local socket the server reads; it needs the owner's approval.
- **Renderer** (`src/App.tsx`, `src/workspace/`, `src/components/sidebar/`, `src/components/git-panel/`, `src/shared/WorkspaceSplitLayout.tsx`): one Dockview per folder, the Folders tree, the right-hand sidebar, the Changes pane, the folder menu, tab peek, and folder-aware inventory for the dashboard and compact switcher.
- **Settings**: one new server-scoped boolean.
- **MCP** (`apps/terminay-server/src/mcp/`): `open_terminal` and `split_terminal` place the new terminal in the caller's folder.
- **Desktop host** (`electron/`): the same workspace commands and launch intent on the desktop authority path.
- **Tests**: workspace reducer and migration unit tests, Git reconciler tests, and Electron end-to-end coverage through `npm run test:e2e`.
- **Docs**: `docs/product-overview.md` gains the folder level in the core model.
