## 1. Device preference

- [x] 1.1 Add `FOLDERS_COLUMN_PANE_IDS`, `FoldersColumnLayout`, and `SidebarSettings.projectFoldersColumnLayout` to `src/types/settings.ts`, default it to `{}` in `src/terminalSettings.ts`, and normalise it on read: heights clamped to 30–2000, collapse flags strictly boolean, order rebuilt so it names each pane once. Verified by the case "a stored left column stack always names both panes at bounded heights" in `src/workspace/projectTabModel.test.ts` passing under `npm run test:linked-folders`.
- [x] 1.2 Add `projectFoldersColumnLayoutOnDevice` and `withProjectFoldersColumnLayout` to `src/workspace/projectTabModel.ts`, keyed by server and project, defaulting the Agents height to the `defaultAgentsPaneHeight` setting. Verified by the case "the left column stack is device-local per server and project" in the same file.

## 2. Left column

- [x] 2.1 Rewrite `src/components/folders/FoldersColumn.tsx` to draw the chrome band without a title, keeping the Folders actions button, over a `SidebarPanelStack` of a Folders pane and an optional Agents pane; report one new layout per completed collapse, resize, or reorder. Verified by `npx tsc --noEmit -p .` and `npm run lint` exiting zero.
- [x] 2.2 In `foldersTree.css`, remove the title rule and make the Folders pane's body a non-scrolling flex container so the tree keeps the only scrollbar. Verified by the end-to-end test in 4.2 finding both panes inside the column and by the existing Folders tree tests in `e2e/linked-folders.spec.ts` passing.
- [x] 2.3 In `src/App.tsx`, build the Agents pane's content once, hand it to `FoldersColumn` when agent integration is enabled, and read and write the column's layout through device settings with the same optimistic local copy the column's width uses. Verified by the reload step of the end-to-end test in 4.2.

## 3. Sidebar groups

- [x] 3.1 Export `useNarrowLayout` from `src/shared/WorkspaceSplitLayout.tsx` and offer the sidebar's Agents group only when agent integration is enabled and the layout is narrow; a stored `agents` selection resolves to Explorer on a wide layout without being rewritten. Verified by the end-to-end test "sidebar groups switch Explorer and Documentation stacks, and Agents is in the left column" asserting two tabs and no Agents tab.

## 4. Tests

- [x] 4.1 Point the end-to-end helpers at the new place: `selectSidebarGroup(page, 'agents')` opens the left column's Agents pane, and the sidebar-stack locators in `e2e/project-sidebar-layout.spec.ts`, `e2e/canonical-dev-sidebar-resize-repro.spec.ts`, `e2e/installed-sidebar-resize-repro.spec.ts`, and `e2e/local-application-connection-recovery.spec.ts` are scoped to `.file-explorer-sidebar`. Verified by `npm run test:e2e -- e2e/project-sidebar-layout.spec.ts e2e/agent-status-sidebar.spec.ts` passing.
- [x] 4.2 Add the end-to-end test "the left column stacks Folders and Agents as collapsible, resizable, reorderable panes under an untitled band": the band has no text, keeps the Folders actions button and the tab strip's background colour; collapsing Folders leaves its title and grows Agents; the separator resizes from the keyboard; the Agents grip reorders from the keyboard; order and height survive a reload. Verified by that test passing under `npm run test:e2e -- e2e/project-sidebar-layout.spec.ts`.
- [x] 4.3 Run the Folders tree and file explorer suites against the stacked column. Verified by `npm run test:e2e -- e2e/linked-folders.spec.ts e2e/file-explorer-sidebar.spec.ts` passing.

## 5. Specs and delivery

- [x] 5.1 Run `openspec validate left-column-agents-pane --strict`, `npm run lint`, `npx tsc --noEmit -p .`, and `npm run test:linked-folders`. Verified by all four exiting zero.
- [x] 5.2 Reconcile the prerequisite canonical requirements and rebase this delta before archive; verify no missing base, duplicate requirement, or superseded folder/sidebar behavior remains.
- [x] 5.3 Open the pull request on `origin` (Gitea) with `tea` and read back the commit statuses on the head SHA. Verified by every status being `success` or `skipped`.

## Reconciliation evidence — 2026-11-04

The prerequisite contracts are present in the canonical specs and this change’s deltas are rebased onto the consolidated wording. The review preserves every-panel rows, title-based folder dragging, General reordering and the current Agents tab placement. These replace the old directory-archive-order checkpoint: prerequisite changes with unrelated open implementation or verification tasks remain active. `openspec validate --all` is checked after the batch; missing requirement bases are not invented.
