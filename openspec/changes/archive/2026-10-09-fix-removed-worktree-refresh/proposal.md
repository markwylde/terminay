## Why

Deleting a worktree sometimes leaves the workspace banner reading `Git scope is
no longer available. Refresh the workspace before retrying project …`, although
the delete succeeded and the project's own root was never the deleted worktree.
The same banner appears when an agent removes a worktree from a terminal.

Removing a worktree deletes its files, and each deletion is a status change
naming that worktree. When it is the only worktree that changed in the refresh
interval, the Git pane asks for a listing scoped to it. By then it has left the
repository, and the server resolved the named worktree as though it were the
target of the request, so it refused the whole listing as `worktree-not-found`.
Nothing raises another refresh afterwards, so the banner stays.

## What Changes

- A worktree listing that names a worktree no longer in the repository answers
  with the repository's current worktrees instead of failing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `git-worktrees-and-quick-push`: a listing's named worktree narrows what is
  re-measured and is never required to exist.

## Impact

- `packages/server-core/src/gitService/service.ts` — the listing resolves the
  project's repository, not the worktree it names.
