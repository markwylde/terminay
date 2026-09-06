## 1. Server-owned removal

- [x] 1.1 Stop treating a Git lock as a protected worktree kind in `assertRemovableWorktree`. Verified by `packages/server-core/test/git-service.test.mjs`: `git worktree lock` then `removeWorktree` no longer throws `worktree-locked`; main and bare still throw `worktree-main` / `worktree-bare`.
- [x] 1.2 Invoke `git worktree remove --force --force -- <path>` for confirmed removal. Verified by the same test: a locked linked worktree is gone from the listing and its directory is deleted.
- [x] 1.3 Keep pull and move rejecting locked worktrees. Verified by existing or added assertions in `git-service.test.mjs` that `pullWorktree` / `moveWorktree` on a locked linked worktree still fail.

## 2. Dirty and desktop force-remove

- [x] 2.1 Remove a locked worktree that also has uncommitted or untracked files. Verified by `git-service.test.mjs` covering locked+dirty confirmed removal.
- [x] 2.2 Pass `--force` twice from `electron/fileViewer/gitDiffService.ts` when force-removing. Verified by `scripts/git-worktree-status.test.mjs` locking a worktree and force-removing it (directory gone, porcelain listing no longer names it).

## 3. Validation

- [x] 3.1 `openspec validate --all` succeeds for this change.
