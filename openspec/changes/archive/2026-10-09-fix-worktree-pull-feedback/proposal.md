## Why

Choosing **Pull from origin** on a worktree row looks like it does nothing: the
row never indicates work is in progress, and when the server refuses the pull
the refusal is discarded, so the user is left with a menu that closed and a
branch that never moved. The common case that triggers this is a branch pushed
without `-u` — `branch.<name>.remote` is unset, the server reports "worktree has
no configured upstream remote", and the UI stays silent even though
`git pull origin <branch>` would have worked.

## What Changes

- The Worktrees panel marks a worktree as pulling while its pull runs, and the
  context menu will not start a second pull for the same worktree.
- A pull the server does not apply is reported to the user with the server's
  own failure message, exactly as a failed worktree removal already is.
- The server pulls a clean, attached branch that has no configured upstream by
  fast-forwarding from the matching branch on its remote, and still refuses
  when no such remote branch exists.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `git-worktrees-and-quick-push`: the worktree pull requirement gains in-progress
  presentation, mandatory failure reporting, and a defined behaviour for a
  branch whose upstream is not configured but whose remote branch exists.

## Impact

- `packages/server-core/src/gitService/service.ts` — pull resolution for
  branches with no configured upstream.
- `src/workspace/useFileExplorerController.ts` — pull progress state and
  assertion of the server result.
- `src/components/git-panel/WorktreesPanel.tsx` and its stylesheet — pulling
  presentation on a worktree row.
- Tests: `packages/server-core/test/git-worktree-pull.test.mjs`,
  `src/workspace/useFileExplorerController.test.ts`.
