## 1. Server pull resolution

- [x] 1.1 Add a failing test to `packages/server-core/test/git-worktree-pull.test.mjs`
      that pulls a branch pushed without `-u` (no `branch.<name>.remote`) whose
      remote branch has advanced. Verified by the test failing with
      "worktree has no configured upstream remote" before the fix.
- [x] 1.2 Add a test that a branch with neither a configured upstream nor a
      matching remote branch is reported as an absent remote. Verified by the
      test asserting `applied === false` and a remote-branch message.
- [x] 1.3 In `GitService.executePullWorktree`, resolve the pull ref: use the
      configured upstream when present, otherwise probe
      `refs/remotes/*/<branch>` and fast-forward from the single match with
      `git pull --ff-only <remote> <branch>`. Verified by 1.1 and 1.2 passing.
- [x] 1.4 Confirm the existing configured-upstream and no-remote tests still
      pass. Verified by `node --test test/git-worktree-pull.test.mjs` green.

## 2. Renderer failure reporting

- [x] 2.1 Add a failing test for an exported `assertWorktreePulled`: accepts an
      applied pull, throws the server's message on a `command-error` result,
      throws on a null result. It goes in a new
      `scripts/git-worktree-pull-feedback.test.mjs` bundled with esbuild, the
      pattern the repository's other renderer tests use, because
      `src/workspace/useFileExplorerController.test.ts` is wired to no runner.
      Verified by the test failing to import the missing export.
- [x] 2.2 Implement and export `assertWorktreePulled`, and call it from
      `handlePullWorktreeFromOrigin` before `onSetError(null)`. Verified by 2.1
      passing.

## 3. Pull progress presentation

- [x] 3.1 Add `pullingWorktreePaths` state to `useFileExplorerController`,
      populated for the duration of the pull and cleared in `finally`; return it
      from the hook. Verified by typecheck and by the hook's returned value
      including the set.
- [x] 3.2 Render it in `WorktreesPanel`: `pulling…` in the row meta, `aria-busy`
      on the section, and the "Pull from origin" menu item disabled while the
      worktree is pulling. Verified by typecheck and by the panel rendering the
      pulling state in the running app.
- [x] 3.3 Pass `pullingWorktreePaths` from `App.tsx` to the panel and add the
      `worktrees-panel__pulling` style beside the deleting style. Verified by
      typecheck and a visual check of a pull in progress.

## 4. Specification and verification

- [x] 4.0 Register the renderer test as `test:git-worktree-pull-feedback` and add
      it to `smoke` so CI runs it. Verified by the script appearing in both.
- [ ] 4.1 Run `npx openspec validate fix-worktree-pull-feedback --strict`.
      Verified by the command reporting the change valid.
- [ ] 4.2 Run `npm run lint`, `npm run typecheck`, and the unit suites touched by
      this change. Verified by all commands exiting zero.
- [ ] 4.3 Open the pull request with the change branch and confirm CI is green.
      Verified by the PR checks passing.
