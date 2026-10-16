## 1. Row model

- [x] 1.1 Add a failing test to `scripts/folder-tree-model.test.mjs`: a linked folder or General whose worktree path is in `pullingWorktreePaths` is `isPulling`, and a plain folder and any other folder are not. Verified by the test failing before the change.
- [x] 1.2 Add `pullingWorktreePaths` to `FolderTreeInput` and `ProjectFolderTreeInput`, and `isPulling` to `FolderTreeFolderRow`. Verified by 1.1 passing.
- [x] 1.3 Pass the controller's `pullingWorktreePaths` to `buildProjectFolderTree` in `src/App.tsx`. Verified by `npx tsc --noEmit -p .` exiting zero.

## 2. Card presentation

- [x] 2.1 Add a failing test to `scripts/folders-tree-row.test.mjs`: a pulling folder renders a spinner and `Pulling…` after its label with `aria-busy` on its row, no facts line, and no dimming; a folder both deleting and pulling shows `Deleting…` alone. Verified by the test failing before the change.
- [x] 2.2 Draw the line in `FolderHeader` and style it, spinner and reduced motion included, in `foldersTree.css`. Verified by 2.1 passing.

## 3. End to end

- [x] 3.1 Add a test to `e2e/linked-folders.spec.ts` that pulls one of two linked folders from origin and records every card that says it is pulling: only the pulled folder's card does, marked busy, and no card says so once the pull settles. Verified by `npm run test:e2e -- e2e/linked-folders.spec.ts -g "Pulling…"` passing.

## 4. Specs and delivery

- [x] 4.1 Run `openspec validate folder-card-pulling-state --strict`, `npm run lint`, and `npx tsc --noEmit -p .`. Verified by all three exiting zero.
- [ ] 4.2 Open the pull request on `origin` (Gitea) with `tea` and read back the commit statuses on the head SHA. Verified by every status being `success` or `skipped`.
