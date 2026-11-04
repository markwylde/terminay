## Context

The server measures every worktree against the repository's default branch: `aheadOfDefaultBranchCount`, `lineAdditions`, `lineDeletions`, and `hasCommittedChanges` (false when the branch's resulting tree is already on the default branch, which is how a squash-merged branch reads as merged). The Folders tree derives one `change` from those and calls anything but `clean` dirty. Nothing measures a worktree against its remote, although the status header the listing already parses carries the upstream and how far ahead of it the branch is.

## Goals / Non-Goals

**Goals:**

- Dirty on a folder card means work that exists only on this machine.
- A branch with work the default branch lacks stays visible, by a separate mark.
- No new watch, timer, or poll; no more Git commands for a worktree with nothing to measure.

**Non-Goals:**

- Changing what "Delete all clean worktrees" or clean-only removal considers clean. They stay on the strict rule, which is the safe one for a destructive action.
- Changing the status bar's branch chip, which already shows uncommitted and ahead-of-default counts separately.
- Showing how far a branch is behind its upstream or the default branch.

## Decisions

**Unpushed commits are measured against the upstream when there is a live one, and against every remote-tracking branch otherwise.** With a live upstream the status header's ahead count answers the question with no further command. Without one (never pushed, or the remote branch was deleted) the branch has unpushed commits when `git rev-list --count HEAD --not --remotes` is above zero. Alternative considered: treating every branch with no upstream as wholly unpushed. Rejected because a worktree freshly made from the default branch, with no commits of its own, would read as dirty.

**A branch with no live upstream whose resulting tree is already on the default branch has no unpushed commits.** The ordinary end of a worktree here is a squash merge followed by the forge deleting the remote branch. Its local commits are then on no remote, but their effect is on the default branch, so nothing is at risk. Without this rule every merged worktree would turn dirty the moment its remote branch was pruned. The rule is not applied under a live upstream, where the default branch checkout itself, ahead of its remote, must read as dirty.

**The unpushed size is the unpushed commits plus the tracked working-tree delta, summed.** This is how the existing size against the default branch is built, so the two numbers stay comparable. Under a live upstream the commits are sized with `git diff --numstat @{upstream}...HEAD`, run only when the branch is ahead. With no live upstream the size already measured against the default branch is reused. When a size cannot be measured it is reported as unknown and the card says `changed`, as it does today.

**The server reports facts; the renderer decides what dirty means.** The listing gains `hasUnpushedCommits`, `unpushedLineAdditions`, and `unpushedLineDeletions` and keeps every existing field. The card's dirty rule and the sweep's clean rule are then two readings of one listing, and clean-only removal on the server is untouched. No authority moves: these are read-only facts of a worktree the project is already bound to, inside the existing bounded query (ADR 0011, ADR 0050).

**The unmerged mark is `↑N` after the branch name**, N being the commits the default branch lacks, shown only while the branch's effect is not on the default branch. It matches the status bar's branch chip. It keeps a muted colour whether or not the checkout is dirty, never truncates, and gives its meaning as a tooltip and accessible name. When the count is unknown the arrow is shown alone.

**A push needs no new observation.** A push or fetch writes under `refs/remotes/` or `packed-refs`, which the Git directory watch already attributes to every worktree, so the unpushed measurement is refreshed by the change that alters it (ADR 0028).

## Risks / Trade-offs

- A remote-tracking ref is only as fresh as the last fetch or push from this machine → the card can call a branch pushed after someone force-pushed over it elsewhere. Accepted: every Git tool's ahead count has this property.
- One more Git command for each worktree that is ahead of its upstream, or has no upstream and is unmerged → bounded by the number of such worktrees and run only when that worktree is remeasured (ADR 0021).
- A repository with no remote can never push, so a feature branch there is dirty for as long as it is unmerged → this is the behaviour before this change, and the right reading of "exists only on this machine".
- The delta targets a requirement two unarchived changes also write → the tasks pin the archive order.
