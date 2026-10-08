## 1. Row

- [x] 1.1 Give `TerminalRow` in `src/components/folders/FoldersTree.tsx` an optional `onRename(title)` and an editing state: double-click shows an input holding the title, focused and selected; Enter and blur save the trimmed text when it is not blank and differs; Escape cancels; the row is not draggable and the input's click, double-click, key, and context-menu events do not reach the row. Verified by new cases in `scripts/folders-tree-row.test.mjs` passing under `npm run test:linked-folders`.
- [x] 1.2 Pass `onRenameTerminal(folderId, panelId, title)` through `FoldersTree` and `FoldersColumn`, absent where a card only lists. Verified by `npx tsc --noEmit -p .` exiting zero.
- [x] 1.3 Style the input in `foldersTree.css` to sit on the row's line at the title's size without changing the row's height. Verified by the end-to-end test in 3.1 asserting the row's height is the same before and during editing.

## 2. Saving

- [x] 2.1 Add a rename handler in `src/App.tsx` that calls `workspaceSnapshotStore.updatePanel` with the title, sets the Dockview panel title when the panel is shown, and bumps the title revision; return focus to the terminal after Enter or Escape. Verified by the end-to-end test in 3.1.

## 3. Verification and delivery

- [x] 3.1 Add an end-to-end test to `e2e/linked-folders.spec.ts`: double-clicking an inactive terminal's row shows the selected input; Enter renames the row and the tab and focuses the terminal; Escape and a blank name leave the title; clicking elsewhere saves. Verified by it passing under `npm run test:e2e -- e2e/linked-folders.spec.ts`.
- [ ] 3.2 Run `openspec validate rename-terminal-from-folders-row --strict`, `npm run lint`, and `npx tsc --noEmit -p .`. Verified by all three exiting zero.
- [ ] 3.3 Open the pull request on `origin` (Gitea) with `tea` and read back the commit statuses on the head SHA. Verified by every status being `success` or `skipped`.
