## Why

Deleting a worktree looks like it does nothing until the folder vanishes. The
Worktrees panel used to write `deleting…` under the worktree being removed;
the Folders tree that replaced it draws a linked folder's card exactly as
before for as long as the removal takes. A large worktree takes seconds to
remove, and a bulk deletion removes its targets one at a time, so the user is
left looking at cards that give no sign of which are on their way out, and can
open the menu of one again to find Delete worktree greyed out with no reason
shown.

The state itself was never lost: the workspace still tracks which worktrees
this device is removing, disables their menu actions, and writes `deleting…`
in the Changes pane of the folder on screen. Only the card stopped saying it.

## What Changes

- A linked folder's card shows `Deleting…` on a line beneath its label from the
  moment its worktree's removal is confirmed until that removal settles, for a
  single deletion and for each target of a bulk deletion.
- That line stands in place of the card's facts line, and the card's row is
  marked busy for assistive technology.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-folders`: a linked folder's card gains a deleting presentation.

## Impact

- `src/workspace/folderTreeModel.ts`, `src/workspace/folderTreeSources.ts` — a
  folder row carries whether its worktree is being removed.
- `src/components/folders/FoldersTree.tsx` and its stylesheet — the line and
  the busy mark.
- `src/App.tsx` — passes the worktrees being removed to the tree.
- Tests: `scripts/folder-tree-model.test.mjs`,
  `scripts/folders-tree-row.test.mjs`, `e2e/linked-folders.spec.ts`.
