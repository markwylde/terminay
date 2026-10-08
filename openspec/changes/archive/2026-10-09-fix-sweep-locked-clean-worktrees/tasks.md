## 1. Server

- [x] 1.1 Keep the lock's reason when parsing `git worktree list --porcelain`,
      and in clean-only removal lift the lock before the unforced removal and
      restore it when Git refuses. Verified by the clean-only case in
      `packages/server-core/test/git-service.test.mjs`: a locked clean worktree
      is removed and its branch kept; a locked worktree that gained a file is
      refused as `worktree-dirty` and keeps its lock and reason.

## 2. Renderer

- [x] 2.1 Nominate locked clean worktrees in `isBulkDeletableWorktree` and mark
      them in the confirmation. Verified by `scripts/clean-worktree-sweep.test.mjs`.

## 3. Specs

- [x] 3.1 Reword the unarchived `delete-clean-worktrees` requirements that said
      locked worktrees are skipped and rejected. Verified by
      `openspec validate --all`.
