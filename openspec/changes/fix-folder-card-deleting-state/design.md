## Context

`useFileExplorerController` keeps `deletingWorktreePaths`: the worktrees this
device has confirmed the removal of and not yet heard the end of. A path is
added when the confirmation is accepted, before the removal is queued behind
any other, and dropped when its own removal settles, applied or not. The folder
menu reads the set to disable its actions and the Changes pane reads it to
write `deleting…` beside the branch of the folder on screen.

The Folders tree is built by `buildProjectFolderTree` from the projection, the
inventory, and the worktree listing. The set was never one of its inputs, so a
card cannot tell that its worktree is being removed.

## Goals / Non-Goals

**Goals:**

- Every card whose worktree is being removed says so, selected or not.
- The same presentation for a single deletion and a bulk one.

**Non-Goals:**

- Showing a removal started from another device. The set is this device's own
  record of what it asked for; the server publishes no in-flight removal, and
  adding one is a protocol change this defect does not need.
- Changing the confirmation, the serialization, or the failure report.
- The compact switcher and the project tab peek, which list folders without
  their facts.

## Decisions

**The row model carries the state; the tree only draws it.** `FolderTreeInput`
takes the set and `FolderTreeFolderRow` gains `isDeleting`, true only for a
linked folder whose worktree path is in the set. General and plain folders have
no worktree that can be removed, so they are never deleting whatever the set
holds. This keeps `FoldersTree` a renderer of the model it is given, as its
other facts already are.

Alternative considered: pass the set to `FoldersTree` and look each card up
there. Rejected — the tree would start deciding what a folder's state is, which
the model exists to do, and the peek and the unit tests would each need the set.

**The line replaces the facts line.** `Deleting…` sits beneath the label, where
the facts line sits, and the facts line is not drawn while it is shown. The
change size, pull request, and checks of a worktree being removed are no longer
something to act on, and a card that keeps its height does not make the cards
below it jump when a removal starts and ends.

**No boundary is crossed.** The renderer reads state it already holds and sends
nothing new. Removal stays server-owned and identity-bound; the card's line is
presentation only and no authority is derived from it.

## Risks / Trade-offs

- The line is cleared when the removal settles, and the card goes when the
  server's projection drops the folder, so a card can be drawn without the line
  for a moment before it disappears → accepted; the folder is removed by the
  server, and holding the line until then would leave it on a card whose
  removal was refused.
