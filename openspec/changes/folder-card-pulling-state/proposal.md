## Why

Pull from origin, chosen from a folder's menu, gives no sign on the folder that
anything is happening. The menu closes, the card looks exactly as before, and
the only trace of the pull is the Changes pane of the folder on screen — which
is often not the folder that was pulled. A pull over a slow network takes
seconds, so the user cannot tell whether it started, is still running, or
quietly finished.

The workspace already tracks which worktrees this device is pulling: the folder
menu reads it to grey out a second pull and the Changes pane writes `pulling…`.
Only the card does not say it.

## What Changes

- A folder's card shows a spinner and `Pulling…` on a line beneath its label
  from the moment a pull from origin starts until it settles, for General and
  for a linked folder.
- That line stands in place of the card's facts line, and the card's row is
  marked busy for assistive technology.
- The card is not dimmed: unlike a deletion, the folder is staying.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-folders`: a folder's card gains a pulling presentation.

## Impact

- `src/workspace/folderTreeModel.ts`, `src/workspace/folderTreeSources.ts` — a
  folder row carries whether its worktree is being pulled.
- `src/components/folders/FoldersTree.tsx` and its stylesheet — the line, the
  spinner, and the busy mark.
- `src/App.tsx` — passes the worktrees being pulled to the tree.
- Tests: `scripts/folder-tree-model.test.mjs`,
  `scripts/folders-tree-row.test.mjs`, `e2e/linked-folders.spec.ts`.
