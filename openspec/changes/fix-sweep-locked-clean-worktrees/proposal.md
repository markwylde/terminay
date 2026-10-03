## Why

"Delete all clean worktrees" regularly leaves rows that read `clean`, and then
disables itself, so each leftover has to be deleted by hand.

The leftovers are locked. An agent session that creates a worktree locks it, and
the lock outlives the session. The sweep treated a lock as a reason to keep the
worktree: the client never nominated a locked one and the server refused one if
asked. Nothing said so — the row reads `clean` like its neighbours, the
confirmation simply omits it, and with only locked worktrees left the menu item
is disabled without explanation.

## What Changes

- The bulk delete nominates a clean worktree whether or not it is locked, and
  the confirmation marks each locked one.
- Clean-only removal lifts the lock on a clean worktree and removes it without
  forcing. A worktree Git then refuses to remove gets its lock back.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `git-worktrees-and-quick-push`: a lock no longer exempts a clean worktree
  from bulk deletion or from clean-only removal.

## Impact

- `packages/server-core/src/gitService/service.ts` — clean-only removal unlocks
  before its unforced removal and re-locks on refusal.
- `packages/server-core/src/gitService/parse.ts` — the worktree listing keeps
  the lock's reason.
- `src/workspace/cleanWorktreeSweep.ts`,
  `src/workspace/useFileExplorerController.ts` — eligibility and confirmation.
- `openspec/changes/delete-clean-worktrees/` — its unarchived requirements said
  locked worktrees are skipped and rejected; they are reworded to match.
- A workspace bundle connected to a server that predates this change still
  nominates locked worktrees; that server refuses each as locked and the sweep
  reports them as not deleted.
