## 1. Server

- [x] 1.1 Treat a locked linked worktree whose `.git` is missing as prunable.
- [x] 1.2 Remove a prunable worktree by deleting only its administrative
      registration. Verified by
      `packages/server-core/test/git-worktree-broken-remove.test.mjs`, which
      covers ten ways of losing a working tree.

## 2. Client

- [x] 2.1 Record whether a refresh raised a feature failure and clear only those
      on a successful refresh. Verified by
      `scripts/git-banner-reconnect-recovery.test.mjs` and
      `src/shared/featureQueryAuthority.test.ts`.
- [x] 2.2 Label prunable worktree rows `missing` and word their delete
      confirmation for a registration-only removal. Verified by
      `e2e/file-explorer-sidebar.spec.ts`.
