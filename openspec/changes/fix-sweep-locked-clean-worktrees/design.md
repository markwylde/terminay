## Context

`isBulkDeletableWorktree` excluded `isLocked`, and `assertSweepableWorktree`
threw `worktree-locked`. Both followed the `delete-clean-worktrees` decision
that a lock is an explicit "keep this".

In practice the locks are not explicit. Claude Code locks every worktree it
creates with a reason naming its session and process, and does not unlock on
exit, so nearly every agent worktree is locked for the rest of its life. The
rule excluded exactly the worktrees the sweep exists to clear.

## Goals / Non-Goals

**Goals:**

- Every worktree whose row reads `clean` and that the user could delete from its
  own row menu is deleted by the sweep.
- The sweep still cannot destroy work.

**Non-Goals:**

- Deciding whether a lock is stale. A lock's process may be on another host,
  and a live session in a clean worktree has nothing to lose.
- Sweeping prunable registrations or the project's current worktree.
- Changing forced single removal, which already removes locked worktrees.

## Decisions

- **Unlock, then remove unforced.** Git removes a locked worktree only with
  `--force --force`, and that also discards modified and untracked files. The
  unforced removal is the sweep's second guard against work that lands after
  the server's recheck, so it is kept: the server runs `git worktree unlock`
  and then the same unforced `git worktree remove`. Forcing after the recheck
  was rejected because it reopens the window that guard closes.
- **Re-lock on refusal.** If Git refuses the removal, the worktree stays and is
  locked again with the reason it carried. The reason is read from
  `git worktree list --porcelain` immediately before unlocking. A reason Git
  C-quotes is not replayed; that lock is restored without one.
- **The cleanliness recheck runs before the lock is touched.** A locked
  worktree that is no longer clean is refused as `worktree-dirty` with its lock
  never lifted.
- **The confirmation marks locked targets** as `name (locked)`, so lifting a
  lock is something the user confirmed rather than something that happened.
- **Boundary.** Unchanged: the request carries opaque IDs and the reviewed
  HEAD, every path comes from the server's own listing, and the operation needs
  write scope.

## Risks / Trade-offs

- [A live agent session's clean worktree is swept from under it] → The user
  confirmed it by name, marked locked, and nothing is lost; the branch is kept.
- [The server stops between unlock and a refused removal] → The worktree
  survives unlocked. Nothing is deleted, and the next sweep treats it as before.
