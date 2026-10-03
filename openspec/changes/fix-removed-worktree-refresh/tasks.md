## 1. Server

- [x] 1.1 List a project's worktrees without resolving the worktree the listing
      names. Verified by
      `packages/server-core/test/git-worktree-removed-scope.test.mjs`, which
      scopes a listing to a worktree removed through the service and to one
      removed with `git worktree remove`.
