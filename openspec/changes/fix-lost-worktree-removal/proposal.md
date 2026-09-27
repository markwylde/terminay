## Why

A linked worktree that has lost its working tree cannot be deleted from the Git
panel, and the failure is hidden. The common case is an agent session that
creates `.claude/worktrees/<name>`, locks it, and exits: once the folder is
removed by hand, Git keeps a locked registration that it never marks prunable,
so the server runs status inside a missing folder and fails. The same dead end
follows when a worktree's `.git` file is removed, its folder is emptied, or its
path is replaced by a file: Git lists those as prunable but refuses
`git worktree remove`. The panel also labels such a row `clean`.

The failure message then flashes for a moment and disappears, because the Git
refresh that follows every delete clears any Git failure when it succeeds.

## What Changes

- A locked linked worktree whose `.git` is gone is treated as prunable, as Git
  would treat it without the lock.
- Deleting a prunable worktree removes only that worktree's registration from
  Git's administrative directory. It never touches what now sits at the old
  path, and never sweeps other stale registrations.
- The Worktrees panel labels a prunable row `missing`, and its delete
  confirmation says that nothing on disk is deleted.
- A successful refresh clears only a failed refresh. A failed worktree action
  stays visible until the user acts again.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `git-worktrees-and-quick-push`: prunable detection covers locked worktrees,
  prunable removal covers every lost working tree, the panel and confirmation
  describe a missing worktree, and action failures stay visible.

## Impact

- `packages/server-core/src/gitService/service.ts` — locked-worktree prunable
  detection and single-registration removal.
- `src/shared/featureQueryAuthority.ts`, `src/App.tsx`,
  `src/workspace/useFileExplorerController.ts` — failures record whether a
  refresh raised them.
- `src/components/git-panel/WorktreesPanel.tsx` — `missing` label and message.
