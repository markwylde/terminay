## 1. Matching and regression coverage

- [x] 1.1 Implement local-first Gitea PR matching with distinct upstream fallback; verify mapping tests cover main tracking, conflicting matches, renamed upstream, fork exclusion, detached worktrees, missing repository metadata, invalid publication suppression, deleted-branch labels, and local merged versus upstream open precedence.
- [x] 1.2 Add refresh regression coverage proving the selected PR and its head SHA checks are published without extra requests; verify the Gitea extension suite passes.
- [x] 1.3 Document PR selection and no-PR checks fallback in the extension README; verify against source and tests.

## 2. Verification and specifications

- [x] 2.1 Run Gitea tests and typecheck; record results and review all changed behavior against delta scenarios.
- [x] 2.2 Sync the completed delta into the canonical spec and archive this change in the same worktree; verify `openspec validate --all` and `openspec validate --all --archived` run, this change passes, and unrelated baseline failures are recorded separately.
