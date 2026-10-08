## 1. Server: clean-only removal

- [x] 1.1 Add `GitWorktreeRemoveCleanRequest` (required `expectedHead`) to `packages/server-core/src/gitService/types.ts`. Verified by `npm run typecheck:workspaces`.
- [x] 1.2 Share the relist / resolve-canonical-path / verify-identity-disappeared steps between both removals by giving `executeRemoveWorktree` a `cleanOnly` mode in `service.ts`. Verified by the existing removal cases in `packages/server-core/test/git-service.test.mjs` passing unchanged.
- [x] 1.3 Implement `removeCleanWorktree` in `service.ts`: reject main, bare, locked, prunable; require and compare `expectedHead`; recompute status and `worktreeDelta`; refuse `worktree-dirty`; run `git worktree remove -- <path>` without `--force`; verify; run through `enqueueRepositoryMutation`. Verified by new cases in `git-service.test.mjs`: clean worktree removed, untracked file added after listing is refused and survives, moved HEAD is stale, omitted HEAD rejected, locked rejected, main rejected, squash-merged branch removed, branch still exists afterwards.
- [x] 1.4 Add `git.worktree.remove-clean` to the adapter operation map and a `removeClean` handler with `requireScope('write')` and `requireProject` in `adapter.ts`. Verified by `packages/server-core/test/git-worktree-remove-clean-adapter.test.mjs`: write scope required, foreign project rejected, request carries only IDs and HEAD.

## 2. Client: protocol method

- [x] 2.1 Add `removeClean(reference, expectedHead, options)` and the operation name to `packages/client-core/src/gitClient.ts`, with `expectedHead` mandatory and bounded. Verified by new cases in `packages/client-core/test/terminay-git-client.test.mjs`: sends `git.worktree.remove-clean`, throws without a HEAD, never sends `git.worktree.remove`.

## 3. Renderer: eligibility and batch

- [x] 3.1 Export `isWorktreeShownClean` and `isBulkDeletableWorktree` from `src/workspace/cleanWorktreeSweep.ts` and make the row's `clean` label in `WorktreesPanel.tsx` call `isWorktreeShownClean`. Verified by `scripts/clean-worktree-sweep.test.mjs` (in the `smoke` list) covering clean, dirty entries, dirty branch, line deltas, main, bare, current, locked, prunable, unknown HEAD, status error, and busy.
- [x] 3.2 Add `deleteCleanWorktrees` to `src/workspace/useFileExplorerController.ts`: snapshot eligible worktrees, build the confirmation text (count, names, 20-name truncation), mark all targets in `deletingWorktreePaths`, chain `removeClean` calls on `worktreeDeleteQueueRef` with per-item error capture, refresh once, and alert only when something was skipped. Skip reasons are the server's own messages. Verified by unit tests of the pure helpers (confirmation text, outcome text) in `scripts/clean-worktree-sweep.test.mjs`.
- [x] 3.3 Remove `currentGitBranch` from the controller and `.sidebar-pane__branch` from `src/components/sidebar/sidebar.css`. Verified by `grep -rn "currentGitBranch\|sidebar-pane__branch" src` returning nothing and `npm run typecheck:workspaces` passing.

## 4. Renderer: pane menu

- [x] 4.1 In the `git` pane descriptor in `src/App.tsx`, drop `accessory` and set `actions` to a `MoreHorizontal` button (`aria-label="Git actions"`, `aria-haspopup="menu"`) that opens the shared `ContextMenu` anchored to the button's bounding rect, with a danger "Delete all clean worktrees" item disabled when no worktree is bulk-deletable. Verified by the E2E case: the menu opens from the button, Escape closes it, and the pane stays expanded.
- [x] 4.2 Give the button the shared `sidebar-pane__action-button` class the Files pane refresh button uses, so no new CSS is needed. Verified by the E2E case locating and operating the button.

## 5. End-to-end and validation

- [x] 5.1 Add an E2E case to `e2e/file-explorer-sidebar.spec.ts`: a repository with two clean linked worktrees, one dirty linked worktree, and the main worktree; decline once and assert nothing is removed and the confirmation names only the clean ones; then accept and assert the clean rows disappear, the dirty and main rows remain, and the branches still exist. Assert in the existing single-worktree case that the item is disabled when nothing is eligible. Verified by `npm run test:e2e` (Docker) passing.
- [x] 5.2 Run `npm run lint`, `npm run typecheck:workspaces`, and the unit suites for `server-core`, `client-core`, and the renderer. Verified by all exiting zero.
- [x] 5.3 Run `openspec validate --all`. Verified by it reporting no errors.
