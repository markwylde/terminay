## 1. Device-remembered widths

- [x] 1.1 Add `recallColumnWidth(column)` and `rememberColumnWidth(column, width)` to `src/workspace/localViewState.ts` for `'folders' | 'sidebar' | 'home'`, stored under one key. Widths are rounded, out-of-range or unreadable values fall back to the defaults (232 / 280 / 220), and failing storage is silent. Verified by new cases in `scripts/local-view-state.test.mjs`: defaults on an empty store, the round trip, independent columns, rejection of a garbage value, and no throw when storage throws.

## 2. Renderer wiring

- [x] 2.1 In `src/App.tsx`, hold one `foldersColumnWidth` and one `sidebarWidth` state initialised from `recallColumnWidth`. Pass them to every project workspace as `foldersWidth` and `navigationWidth`, and have both commit callbacks set the state and call `rememberColumnWidth`. Remove `commitFoldersTreeWidth`, `foldersTreeWidthFor`, `foldersTreeChanges.width`, and the `fileExplorerWidth` commit through `onCommitProjectSidebar`. Verified by the typecheck and by the updated `scripts/web-shared-workspace.test.mjs` assertion that `navigationWidth` comes from the shared state rather than `project.fileExplorerWidth`.
- [x] 2.2 Initialise `homeSidebarWidth` from `recallColumnWidth('home')`, and have its commit remember the width. Verified by the typecheck and by the local-view-state test covering the `home` column.
- [x] 2.3 Listen for the `storage` event on the column-widths key, update the three states from it, and never write back from the listener. Verified by a `local-view-state.test.mjs` case for the parse helper the listener uses, and by manual check in two windows (task 5.3).

## 3. Remove per-project width from the workspace model

- [x] 3.1 Remove `fileExplorerWidth` from `WorkspaceSidebarState`, its default, normalization, validation, and the patch allow-list in `packages/server-core/src/workspace.ts`. Add a server-core test that a stored workspace whose sidebar still has `fileExplorerWidth` loads without it, and that a patch naming it is rejected. Verified by `npm test --workspace @terminay/server-core`.
- [x] 3.2 Remove `fileExplorerWidth` from `packages/client-core/src/workspace.ts` types and validators, `ProjectSidebarState`, `PROJECT_SIDEBAR_KEYS`, and `createProjectTab` in `src/workspace/projectTabModel.ts`, and from `src/shared/serverWorkspaceReconciliation.ts`. Verified by `npm run typecheck:workspaces` and a grep finding no `fileExplorerWidth` outside `openspec/`.
- [x] 3.3 Remove `fileExplorerWidth` from the sidebar fixtures in `scripts/*.test.mjs` (workspace-projection, server-workspace-reconciliation, reserved-project-projection, workspace-delta-reconciliation-runtime, browser-presents-every-view). Verified by those tests passing.

## 4. Remove per-project folders width and the default-width setting

- [x] 4.1 Remove `projectFoldersWidth` and `defaultWidth` from `SidebarSettings`, their defaults and normalization in `src/terminalSettings.ts`, and the **Default sidebar width** Settings field. Verified by a `terminalSettings` normalization case showing both stored keys are dropped, and by the Settings search no longer finding "Default sidebar width".
- [x] 4.2 Remove `projectFoldersTreeWidthOnDevice` and `withProjectFoldersTreeWidth` from `projectTabModel.ts`, and move `DEFAULT_FOLDERS_TREE_WIDTH` into the localViewState defaults. Update `src/workspace/projectTabModel.test.ts` to match. Verified by `npm run test:linked-folders`.
- [x] 4.3 Update the active `linked-folders` change so its "Folders tree visibility and width" delta covers visibility only, and so its `server-owned-workspace-state` delta no longer lists Folders tree width as per-project client state. Because `linked-folders` also modifies "Explorer pane and project root presentation", that requirement's width wording is fixed in its delta, not duplicated here, so neither change's archive overwrites the other. Verified by `openspec validate --all`.

## 5. Verification

- [x] 5.1 Add an E2E case in `e2e/linked-folders.spec.ts` (or a sibling spec): resize the Folders column and the sidebar in project A, switch to project B and see both widths, reload and see both kept, then resize Home and see project widths unchanged. Verified by `npm run test:e2e` for that spec.
- [x] 5.2 Run `npm run lint`, `npm run typecheck:workspaces`, `npm run test:local-view-state`, `npm run test:linked-folders`, `npm run test:linked-folders:layout`, `npm run test:workspace-models`, and `openspec validate --all`, all passing.
- [ ] 5.3 Launch the app, then confirm by hand that resizing either column in one project resizes it everywhere, that the widths survive a relaunch, and that a second window picks up a resize.
