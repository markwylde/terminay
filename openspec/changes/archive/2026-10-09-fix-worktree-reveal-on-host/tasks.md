## 1. Server

- [x] 1.1 Add `canRevealOnHost` to `ServerGitAdapter`; report `revealAvailable`
      on listings and refuse reveal for clients it rejects. Verified by a new
      case in `packages/server-core/test/git-adapter.test.mjs`.
- [x] 1.2 Record embedded renderer client IDs in `ServerTerminalAuthority` and
      wire a reveal handler that resolves the worktree path server-side and calls
      `revealPathOnHost`, supplied by Desktop main as `shell.showItemInFolder`.

## 2. Client

- [x] 2.1 Drop the client-side `nativeWindows` requirement from
      `TerminayGitClient.reveal`. Verified by
      `packages/client-core/test/terminay-git-client.test.mjs`.
- [x] 2.2 Carry `revealAvailable` into `WorktreePanelStatus`; omit **Reveal in
      OS** from the worktree menu without it and report reveal failures.
      Verified by `scripts/git-worktree-pull-feedback.test.mjs`.
- [x] 2.3 Gate **Reveal worktree** in the shared Git route on
      `revealAvailable`; update the shared-production-routes fixture.
