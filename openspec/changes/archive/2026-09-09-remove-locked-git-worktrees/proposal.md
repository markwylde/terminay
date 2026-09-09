## Why

Deleting a worktree from Terminay currently fails when Git has that worktree marked locked, even after the user confirms the destructive delete. The lock is often leftover from another tool (agent isolation, `git worktree lock`) rather than a Terminay protection, so a confirmed delete is reported as a Git load failure instead of removing the folder.

## What Changes

- Confirmed linked-worktree deletion succeeds when Git reports the worktree as locked.
- Main and bare worktrees stay protected and are still rejected.
- Pull and move of a locked worktree stay rejected; lock remains a read-only safety flag except for confirmed delete.
- Listing still reports `locked` so the sidebar can show that state; it is no longer a removal veto.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `git-worktrees-and-quick-push`: confirmed server-owned removal deletes a locked linked worktree; only main and bare remain non-removable kinds.

## Impact

- `packages/server-core` GitService removal path (pre-check and `git worktree remove` flags).
- Server-core GitService tests covering locked (and locked+dirty) confirmed removal.
- Desktop `electron/fileViewer/gitDiffService.ts` force-remove path, if it still issues `git worktree remove --force` once.
- No protocol, identity, or confirmation-dialog copy change. The existing confirmation already authorizes deleting the folder including uncommitted and untracked files.
