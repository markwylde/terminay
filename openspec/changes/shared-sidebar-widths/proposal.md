## Why

Each project remembers its own width for the left folders column and the right sidebar. Switching projects makes the columns jump to a different width, and resizing a column in one project does nothing for the others. The Home sidebar is the opposite case: it forgets its width on every relaunch. The rules also differ by column. The right sidebar's width is stored in the server's workspace and follows the project to every device. The left column's width sits in server settings under a per-project key. Home's width is not stored anywhere.

## What Changes

- The left folders column has one width, shared by every project in the window. Resizing it in one project resizes it in all of them.
- The right sidebar likewise has one width, shared by every project and remembered separately from the left column.
- The Home sidebar has its own width, separate from the project columns, and the device now remembers it.
- All three widths are remembered on the device, in the same store as Home sidebar visibility, and never travel through the server. Until the first resize, a built-in default applies.
- **BREAKING** The project sidebar's `fileExplorerWidth` is removed from server workspace state, from the sidebar update command, and from the client's sidebar model. A stored workspace that still has it loads without it.
- **BREAKING** The per-project `sidebar.projectFoldersWidth` map and the **Default sidebar width** setting (`sidebar.defaultWidth`) are removed from settings. The remembered width replaces both.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-sidebar-layout`: a new requirement that the folders column and the sidebar each have one device-remembered width shared across projects; finishing a width resize no longer commits a project-scoped sidebar update.
- `file-explorer-and-folder-tabs`: a project no longer owns its sidebar width. The matching removal of the Explorer's configurable default width is carried by the `linked-folders` delta of that requirement, which this change updates.
- `workspace-dashboard`: the Home sidebar has its own width, which the device remembers.

## Impact

- Renderer: `src/App.tsx` (project and Home width wiring, `commitFoldersTreeWidth`, the `fileExplorerWidth` commit), `src/workspace/localViewState.ts` (new remembered widths), `src/workspace/projectTabModel.ts`, `src/shared/serverWorkspaceReconciliation.ts`, `src/terminalSettings.ts`, `src/types/settings.ts`.
- Server and client model: `packages/server-core/src/workspace.ts` and `packages/client-core/src/workspace.ts` drop `fileExplorerWidth` from the sidebar state, its validation, and the sidebar patch allow-list.
- Tests that build sidebar fixtures with `fileExplorerWidth`, or assert the per-project width wiring, under `scripts/` and `packages/*/test/`.
- The active `linked-folders` change specifies a per-project Folders tree width. Its delta is updated to cover visibility only.
