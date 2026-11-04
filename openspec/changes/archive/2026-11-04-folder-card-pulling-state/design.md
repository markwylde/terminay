## Context

`useFileExplorerController` keeps `pullingWorktreePaths`: the worktrees this
device has asked the server to pull and not yet heard back about. A path is
added when the pull is requested and dropped when it settles, applied or not.
The folder menu reads the set to disable a second pull, and the Changes pane
reads it to write `pulling…`. `buildProjectFolderTree` never took the set, so a
card cannot tell that its worktree is being pulled.

The card already has a busy presentation for a worktree being removed:
`Deleting…` beneath the label in place of the facts line, with the row marked
busy and the card dimmed.

## Goals / Non-Goals

**Goals:**

- Every card whose worktree is being pulled says so, selected or not.
- A presentation that reads as work in progress, consistent with `Deleting…`.

**Non-Goals:**

- Showing a pull started from another device; the server publishes no
  in-flight pull.
- Showing progress beyond started and settled. `git pull` reports none the
  server forwards.
- Changing how a pull is requested, serialized, or reported when it fails.

## Decisions

**The row model carries the state; the tree only draws it.** `FolderTreeInput`
takes `pullingWorktreePaths` and `FolderTreeFolderRow` gains `isPulling`, true
when the folder's resolved worktree — the root checkout for General, its own
worktree for a linked folder — is in the set. A plain folder has no worktree
and is never pulling. This is the same split `isDeleting` uses.

**The line replaces the facts line, as `Deleting…` does.** `Pulling…` sits
beneath the label with an 11px spinning `LoaderCircle` before it. The change
size and pull request chips are about to be re-measured, and keeping the card's
height steady stops the cards below from jumping as a pull starts and ends.

**Deleting wins over pulling.** The menu offers no pull on a worktree being
removed, but a removal confirmed while a pull runs would otherwise draw two
lines. The card shows `Deleting…` alone.

**Not dimmed.** Dimming says the folder is going. A pulled folder stays, and
its terminals remain fully usable while the pull runs.

**The spinner respects reduced motion.** It stops turning under
`prefers-reduced-motion: reduce`; the word still says what is happening.

**No boundary is crossed.** The renderer draws state it already holds and sends
nothing new.

## Risks / Trade-offs

- A fast pull clears the line within a frame or two, so it may barely be seen
  → accepted; holding it longer would claim work that is not happening.
