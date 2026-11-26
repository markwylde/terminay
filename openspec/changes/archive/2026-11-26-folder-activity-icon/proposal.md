## Why

When a folder is pulled from origin, or its worktree is deleted, the Folders tree inserts a `Pulling…` or `Deleting…` line beneath the folder's label. On General, which has no facts line for it to stand in for, that line is an extra row: everything beneath it in the sidebar jumps down while git works and jumps back up when it settles (issue #662). Linked folders trade their facts line for the busy line, so their chips vanish and reappear. A status that moves the user's click targets is worse than a quiet one.

## What Changes

- A folder whose worktree is being pulled or deleted shows an animated activity icon in the place of its folder icon or branch icon on its title line, instead of a line of its own beneath the label. The header band keeps exactly the lines it had, so nothing in the tree moves.
- Pulling shows a downward arrow that drops into a line; deleting shows a trash can that pulses. Under a reduced-motion preference neither moves.
- The icon has a tooltip and an accessible status saying what git is doing: `Pulling from origin…` or `Deleting worktree…`. The folder's row stays marked busy.
- The facts line stays shown while the folder is busy, rather than giving way to a busy line.
- A worktree being deleted still dims its whole card to 40%, and deleting still outranks pulling.
- Out of scope: the Git panel's Changes pane, whose `pulling…`/`deleting…` word sits inline on its branch line and moves nothing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-folders`: the Folders tree's title line holds an activity icon in the place of the folder or branch icon while git works on the folder; the "being deleted" and "being pulled" requirements are replaced by ones that show that icon instead of a busy line and keep the facts line; the linked-folder details tooltip gives way to the activity icon's own tooltip.

## Impact

- `src/components/folders/FoldersTree.tsx` and `src/components/folders/foldersTree.css` (renderer only).
- `scripts/folders-tree-row.test.mjs`: the deleting and pulling render tests.
- `e2e/linked-folders.spec.ts`: the Deleting and Pulling card tests, plus a check that General's header band keeps its height while it is pulled.
- No protocol, server, Electron, or persistence changes.
