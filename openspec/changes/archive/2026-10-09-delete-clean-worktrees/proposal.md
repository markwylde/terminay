## Why

Agent-driven work leaves a trail of finished worktrees. A project routinely
shows a dozen rows marked `clean` — merged, nothing uncommitted — and the only
way to clear them is one at a time: right-click, Delete worktree, confirm,
repeat. The Git pane has no pane-level action at all; its header spends that
space on the current branch name, which the current worktree's row already
shows.

The single-worktree removal is also the wrong tool to loop over. It is a forced
removal by design, because the user has just read a warning about that one
worktree. A bulk action acts on a listing that may be seconds old, so it needs a
removal that refuses when the worktree is no longer clean.

## What Changes

- The Git pane header shows a pane menu button (a "more" icon) where the current
  branch name was. The branch name leaves the header.
- The pane menu offers **Delete all clean worktrees**. It is disabled when no
  worktree is eligible.
- Eligible means: shown as clean, and not the main worktree, a bare worktree, the
  project's current worktree, locked, prunable, or already being deleted or
  pulled.
- One confirmation names every worktree that will be deleted. Nothing is removed
  before it is accepted.
- The server gains a clean-only removal, `git.worktree.remove-clean`. It requires
  the reviewed HEAD, rechecks effective cleanliness immediately before invoking
  Git, and uses Git's unforced removal, so a worktree that gained changes after
  the listing is refused rather than deleted.
- The batch runs through the existing per-repository deletion queue. Rows show
  `deleting…` as they go. A refusal or failure of one worktree does not stop the
  rest, and the outcome reports how many were deleted and which were skipped and
  why.
- Branches are not deleted, matching single-worktree removal.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `git-worktrees-and-quick-push`: adds the Git pane menu, the bulk clean-worktree
  deletion and its confirmation, and the server's clean-only removal; extends the
  protocol adapter's operation list.

## Impact

- `src/App.tsx` — the `git` pane descriptor's `accessory` becomes the menu button
  and its `ContextMenu`; `.sidebar-pane__branch` in
  `src/components/sidebar/sidebar.css` goes unused and is removed.
- `src/workspace/cleanWorktreeSweep.ts` — the eligibility predicate shared by
  the row's `clean` label in `WorktreesPanel.tsx` and the bulk action, plus the
  confirmation and outcome text.
- `src/workspace/useFileExplorerController.ts` — `deleteCleanWorktrees`, reusing
  `deletingWorktreePaths` and `worktreeDeleteQueueRef`; `currentGitBranch` loses
  its only consumer.
- `packages/client-core/src/gitClient.ts` — `removeClean` and the
  `git.worktree.remove-clean` operation name.
- `packages/server-core/src/gitService/` — `removeCleanWorktree` in `service.ts`,
  the adapter handler and operation map in `adapter.ts`, the request type in
  `types.ts`.
- Tests: `packages/server-core/test/git-service.test.mjs`,
  `git-worktree-remove-clean-adapter.test.mjs`,
  `packages/client-core/test/terminay-git-client.test.mjs`,
  `scripts/clean-worktree-sweep.test.mjs`, and E2E cases in
  `e2e/file-explorer-sidebar.spec.ts`.
- No new dependencies. The icon comes from `lucide-react`, already in use.
