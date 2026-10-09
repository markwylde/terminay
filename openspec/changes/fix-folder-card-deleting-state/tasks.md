## 1. Row model

- [x] 1.1 Add a failing test to `scripts/folder-tree-model.test.mjs`: a linked folder whose worktree path is in `deletingWorktreePaths` is `isDeleting`, and General, a plain folder, and any other linked folder are not. Verified by the test failing on the missing field before the change.
- [x] 1.2 Add `deletingWorktreePaths` to `FolderTreeInput` and `ProjectFolderTreeInput`, and `isDeleting` to `FolderTreeFolderRow`. Verified by 1.1 passing.
- [x] 1.3 Pass the controller's `deletingWorktreePaths` to `buildProjectFolderTree` in `src/App.tsx`. Verified by `npx tsc --noEmit -p .` exiting zero.

## 2. Card presentation

- [x] 2.1 Add a failing test to `scripts/folders-tree-row.test.mjs`: a deleting linked folder renders `Deleting…` after its label with `aria-busy` on its row and no facts line; the same folder not deleting renders its facts line and neither of the others. Verified by the test failing before the change.
- [x] 2.2 Draw the line in `FolderHeader` and style it in `foldersTree.css`. Verified by 2.1 passing and `npm run test:linked-folders` exiting zero.
- [x] 2.3 Dim the whole card of a deleting folder to 40% opacity with a `folders-tree__folder--deleting` class. Verified by `scripts/folders-tree-row.test.mjs` asserting the class on the card and its absence otherwise.

## 3. End to end

- [x] 3.1 Add a test to `e2e/linked-folders.spec.ts` that deletes one of two worktrees and records every card that says it is being deleted: only the deleted worktree's card does, marked busy and at 40% opacity, the other card stays at full opacity, and no card says so once it is gone. Verified by `npm run test:e2e -- e2e/linked-folders.spec.ts -g "Deleting…"` passing.

## 4. Specs and delivery

- [x] 4.1 Run `openspec validate fix-folder-card-deleting-state --strict`, `npm run lint`, and `npx tsc --noEmit -p .`. Verified by all three exiting zero.
- [ ] 4.2 Open the pull request on `origin` (Gitea) with `tea`, attach a screenshot of a card showing `Deleting…`, and read back the commit statuses on the head SHA. Verified by every status being `success` or `skipped`.
