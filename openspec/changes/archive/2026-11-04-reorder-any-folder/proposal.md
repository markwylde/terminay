## Why

In the Folders sidebar a user can drag every card into a new place except General. General has no grip and the server pins it first, so in a project that is one checkout and its worktrees, the row the user most wants to place is the one that cannot move. Reordering was meant to apply to every row. The drag that does exist is also abrupt: the card does not follow the pointer, and the other cards jump to their new places with no motion, where the project bar above it lifts the tab, carries it, and settles it into its slot.

## What Changes

- General shows the same drag grip as every other folder card and is reordered the same way, by pointer and from the keyboard. Any folder may be placed above it.
- **BREAKING** (server rule): the server no longer requires General to be first in a project's folder order. `folder.reorder` accepts any permutation of the project's folders. General still exists exactly once in every project and still cannot be renamed or deleted.
- General is found by its kind wherever the server or the renderer means "the General folder", and no longer by being first in the order. A panel created without a folder still lands in General, and a deleted folder's panels still move to General, wherever General sits.
- Dragging a card by its grip lifts it and carries it under the pointer, vertically only. The other cards slide to open the slot it would land in, and on release it settles into that slot. This is the project bar's reorder effect turned to the vertical axis.
- A device that asks for reduced motion gets the same reordering with no animation.
- Unchanged: the grip is still the only place a reorder starts, a peek still has no grips, the server still owns the order, and a refused or unanswered order still falls back to the server's.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-folders`: General may be anywhere in the folder order and is reordered like any other folder; every card in the tree has a grip; a dragged card follows the pointer vertically and the others make room. This capability is introduced by the `linked-folders` change and extended by `folders-sidebar-cards`, neither of which is archived yet, so this change's delta modifies requirements those two add and must be archived after them.
- `server-owned-workspace-state`: the server no longer refuses a folder reorder because it moves General. The requirement being modified is likewise added by `linked-folders`.

## Impact

- **Server** (`packages/server-core/src/workspace.ts`): `folder.reorder` validation, the project-folders invariant checked on every state, and each place that reads `folderIds[0]` to mean General (`folderForNewPanel`, `panel.reorder`, `folderReconciler.removeFolder`, `terminalService/launchResolver.ts`).
- **Snapshot validation in the renderer** (`src/shared/serverWorkspaceReconciliation.ts`): accepts a snapshot whose General is not first.
- **Renderer models** that read the first folder as General or as the default: `src/workspace/folderTreeModel.ts` (`folderOrderAfterMove`, the default selected folder), `folderWorkspaces.ts`, `compactSwitcherModel.ts`, `useFolderMenuController.tsx`.
- **Folders tree** (`src/components/folders/FoldersTree.tsx`, `foldersTree.css`): grip on General, and the drag rebuilt on `framer-motion`'s `Reorder` with a vertical axis. `framer-motion` is already a dependency, used by the project bar.
- **Stored state**: no migration. Every stored order is valid under the looser rule. Rollback is unchanged: the documented procedure restores the pre-update data root with the previous artifact.
- **Protocol**: no command, event, or field is added or changed in shape. One refusal is removed.
- **Tests**: `packages/server-core/test/workspace-folders.test.mjs`, `scripts/folders-tree-row.test.mjs`, `scripts/folder-tree-model.test.mjs`, `scripts/server-workspace-reconciliation.test.mjs`, and the reorder test in `e2e/linked-folders.spec.ts` each assert today's rule and change with it.
