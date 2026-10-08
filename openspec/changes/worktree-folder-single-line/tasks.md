## 1. Label model

- [x] 1.1 Carry `isDetached` and `head` on `FolderTreeWorktree` and fill them in `folderTreeWorktrees` in `src/workspace/folderTreeSources.ts`. Verified by a new case in `scripts/folder-tree-sources.test.mjs`.
- [x] 1.2 Add `folderLabel` to `src/workspace/folderTreeModel.ts`: the branch; the directory name when the worktree is detached or absent from the listing; the branch with the directory name as a suffix when another checkout of the repository, the project root checkout included, is on the same branch. Return the parts separately so the card can mute the suffix, plus a plain-text form `branch (directory)`. Verified by new cases in `scripts/folder-tree-model.test.mjs` covering a branch, a detached HEAD, an unlisted worktree, a branch shared with the root checkout, a branch shared by two linked worktrees, and a detached worktree not counting as a collision.
- [x] 1.3 Carry the label and the tooltip's facts (branch or detached head, directory name, path) on `FolderTreeFolderRow` for a linked folder, leaving `name` and `branch` as they are for General and plain folders. Verified by the extended `buildFolderTree` case in `scripts/folder-tree-model.test.mjs`.

## 2. Folder card

- [x] 2.1 Draw a linked folder's head in `src/components/folders/FoldersTree.tsx` as one title line: grip, branch icon, label with its muted suffix, unmerged mark, menu button, with no branch line; keep the accent colour for a dirty checkout and the facts line beneath. Leave General and plain folders unchanged. Style it in `foldersTree.css` so the label truncates and the unmerged mark does not. Verified by new card cases in `scripts/folders-tree-row.test.mjs`: a linked card renders no folder icon and one line naming the branch, and General still renders its title and branch line.
- [x] 2.2 Use the label in the accessible names of the card's controls (`Actions for`, `Reorder`, `New terminal in`, `Checks for`). Verified by assertions on those names in `scripts/folders-tree-row.test.mjs`.

## 3. Naming outside the tree

- [x] 3.1 Name the compact switcher's folders by the label. The switcher's model takes each folder's name as input, so the label is applied where `src/App.tsx` builds that input, through `folderNameFromStatus` in `src/workspace/folderTreeSources.ts`; the listed name and the search match both read it. Verified by the new `folderNameFromStatus` case in `scripts/folder-tree-sources.test.mjs` and the phone-width tests in `e2e/linked-folders.spec.ts`.
- [x] 3.2 Read `folderLabel` in the move-to-folder menu (`src/components/TerminalTab.tsx`), the Files pane heading, the front-folder name passed to the compact switcher, and the panels question (`src/App.tsx`, `src/workspace/useFolderMenuController.tsx`). Verified by `grep -n "folder\.name" src` showing no remaining read that can be reached with a linked folder, and `npx tsc --noEmit -p .` exiting zero.

## 4. Menu

- [x] 4.1 Offer `rename-folder` for a plain folder only in `src/workspace/folderMenuModel.ts`. Verified by the updated linked and plain cases in `scripts/folder-menu-model.test.mjs`.

## 5. Details tooltip

- [x] 5.1 Add `FolderDetailsTooltip` under `src/components/folders/`: three labelled single-line rows, rendered through a portal, positioned beside the title line and clamped inside the window, `role="tooltip"`, no pointer events, referenced by `aria-describedby` from the card head. Verified by a render case in `scripts/folders-tree-row.test.mjs` asserting the three labels and values, including `detached at` and the short head.
- [x] 5.2 Open it from a one-second timer started when the pointer is over a linked folder's title line, outside its controls, and on `:focus-visible` of its card; cancel and close on pointer leave, blur, pointer down, Escape, tree scroll, drag start, and menu open; clear the timer on unmount. Drop the native `title` from a linked folder's label. The wait is `createHoverDelay` in `src/workspace/hoverDelay.ts`. Verified by the fake-clock case in `scripts/folders-tree-row.test.mjs` (nothing at 900 ms, open at 1000 ms, closed or cancelled when the rest ends) and by the pass-over, menu, Escape, and General steps of the end-to-end test in 6.1.
- [x] 5.3 Cut an over-long location from its start in `foldersTree.css`, falling back to trimming in script if the `direction: rtl` form misplaces the leading separator. Verified by the end-to-end assertion in 6.1 that the location's rendered box ends with the directory name and its left edge is clipped.

## 6. End to end

- [x] 6.1 Extend `e2e/linked-folders.spec.ts`: a worktree's card shows its branch on one line and not its directory name; switching the worktree's branch from a shell changes the label without moving the card; a detached worktree shows its directory name; a worktree forced onto the root checkout's branch shows the directory suffix; the linked folder's menu has no Rename folder; hovering for under a second shows no tooltip and for over a second shows the three lines, with a deep path cut from its start; General shows no tooltip. Verified by `npm run test:e2e -- e2e/linked-folders.spec.ts` passing.
- [x] 6.2 Update existing end-to-end and unit expectations that locate a linked folder's card by its directory name or use Rename folder on one. Verified by `npm run test:linked-folders` and `npm run test:e2e -- e2e/linked-folders.spec.ts` passing with no skipped test.

## 7. Specs and delivery

- [x] 7.1 Run `openspec validate worktree-folder-single-line --strict`, `npm run lint`, and `npx tsc --noEmit -p .`. Verified by all three exiting zero.
- [ ] 7.2 Before archiving, check that `linked-folders`, `folders-sidebar-cards`, and `folders-dirty-means-unpushed` have archived and that `openspec/specs/project-folders/spec.md` holds the four requirements this change modifies; rebase the delta onto them if their text moved, and onto `folders-sidebar-reorder-all-rows` if it landed first. Verified by `openspec validate --all` passing and a read-through of the folded spec showing no requirement that still gives a linked folder a name and a branch line.
- [ ] 7.3 Open the pull request on `origin` (Gitea) with `tea` and read back the commit statuses on the head SHA. Verified by every status being `success` or `skipped`.
