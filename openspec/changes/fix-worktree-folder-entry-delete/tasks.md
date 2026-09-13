## 1. Directory state on Git status entries

- [x] 1.1 Add a failing test to
      `packages/server-core/test/git-worktree-symlinked-directory.test.mjs` that
      builds a worktree whose `node_modules` is a symlink at the main checkout
      and asserts the status entry is a directory. Verified by the test failing
      on `isDirectory` being undefined before the fix.
- [x] 1.2 Add `isDirectory` to `GitStatusEntry`, set from the trailing separator
      Git prints for an untracked directory, with the separator stripped from
      the path. Verified by `test/git-status-normalization.test.mjs` staying
      green.
- [x] 1.3 Stat the remaining untracked entries against the worktree root in
      `GitService`, for both `status` and the per-worktree listing. Verified by
      1.1 passing.

## 2. Deleting a symlink

- [x] 2.1 Add a failing test that deletes a link pointing outside the project and
      asserts the link is gone and its target intact. Verified by the test
      failing with `path_escape` — the same refusal the user sees as "Explorer
      access was denied".
- [x] 2.2 Replace the blanket symlink refusal in `FileCatalog.delete` with a
      canonical-parent lookup: resolve the parent, append the leaf, confirm it is
      a link with `lstat`, and remove it non-recursively. Verified by 2.1
      passing and by traversal still rejecting.
- [x] 2.3 Update `packages/server-core/test/file-catalog.test.mjs` to state the
      new rule and keep rename refusing symlinks. Verified by the suite green.

## 3. A symlinked directory is a folder

- [x] 3.1 Add `targetKind` to listed catalog entries and validate it in
      `@terminay/client-core`. Verified by the listing test asserting
      `targetKind` for a linked directory and a linked file.
- [x] 3.2 Classify Explorer entries through `isDirectoryEntry` so a link to a
      directory is expandable. Verified by
      `scripts/git-worktree-folder-entry.test.mjs`.
- [x] 3.3 Render a directory change row in `GitPanel` with a folder icon, the
      folder context menu, and Folder-panel opening. Verified by the same test.
- [x] 3.4 Carry `isDirectory` through `serverGitWorkspaceAdapter` and the local
      `gitDiffService`. Verified by typecheck and the projection test.

## 4. Handing the borrowed project root back

- [x] 4.1 Add a failing test for `rootFolderToRestoreAfter`: a delete or rename
      in another worktree restores the previous root, an open does not, and a
      mutation already in scope restores nothing. Verified by the test failing
      to import the missing export.
- [x] 4.2 Record the pre-switch root on the pending action and restore it when
      the mutation settles. Verified by 4.1 and the controller assertions.
- [x] 4.3 Register `test:git-worktree-folder-entry` and add it to `smoke` so CI
      runs it. Verified by the script appearing in both.

## 5. Specification and verification

- [x] 5.1 Run `npx openspec validate fix-worktree-folder-entry-delete --strict`.
      Verified by the command reporting the change valid.
- [x] 5.2 Run `npm run lint`, `npm run typecheck`, and the unit suites touched by
      this change. Verified by all commands exiting zero.
- [ ] 5.3 Open the pull request with the change branch and confirm CI is green.
      Verified by the PR checks passing.
