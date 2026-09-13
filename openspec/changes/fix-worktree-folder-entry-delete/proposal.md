## Why

A worktree that links its `node_modules` at the main checkout — the usual way to
avoid a second install — shows that link in the Git tree as a **file**, and
deleting it fails. Three defects stack up:

1. `.gitignore` patterns ending in `/` match directories only, so a symlinked
   `node_modules` is not ignored and Git reports it as an ordinary untracked
   path. Git status carries no type, so the row renders with a file icon, offers
   no folder actions, and opens a diff instead of the folder.
2. Deleting it switches the project root to that worktree and leaves it there.
   The user's project silently becomes a different checkout.
3. The delete is then refused. The server resolves the path through `realpath`,
   lands outside the worktree root, and returns `path_escape` — which the
   Explorer renders as "Explorer access was denied. The selected server account
   cannot access project …". Nothing was deleted, and the message names a
   permission problem that does not exist.

## What Changes

- Git status entries carry whether the path is a directory, including a symlink
  that resolves to one, so the Git tree shows a folder as a folder, offers the
  folder context menu, and opens the Folder panel.
- A cross-worktree create, rename, or delete still switches the project to the
  owning worktree to authorize itself, and hands the project root back once the
  mutation settles. Opening an entry is navigation and still stays put.
- Deleting a symlink removes the link and never its target, so a link that
  points outside the project can be deleted from inside it. The link is
  addressed through its canonical parent, so no intermediate link can redirect
  the removal out of the project. Renaming a symlink stays refused.
- A listed symlink reports the kind it resolves to, so a linked directory is an
  expandable folder in the Explorer tree rather than a leaf that cannot open.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `git-worktrees-and-quick-push`: Git change rows carry directory state, and the
  cross-worktree mutation requirement gains the root hand-back.
- `file-explorer-and-folder-tabs`: the catalog reports a symlink's resolved kind
  and defines symlink deletion.

## Impact

- `packages/server-core/src/gitService/` — `isDirectory` on status entries,
  from the untracked trailing separator and a bounded stat per untracked entry.
- `packages/server-core/src/fileService/catalog.ts` — symlink deletion through
  the canonical parent, and `targetKind` on listed symlinks.
- `packages/client-core/src/fileViewer.ts` — `targetKind` validation.
- `src/components/git-panel/GitPanel.tsx`, `src/services/git/serverGitWorkspaceAdapter.ts`,
  `src/workspace/` — folder presentation and the borrowed-root hand-back.
- `electron/fileViewer/gitDiffService.ts` — the same directory state locally.
- Tests: `packages/server-core/test/git-worktree-symlinked-directory.test.mjs`,
  `packages/server-core/test/file-catalog.test.mjs`,
  `scripts/git-worktree-folder-entry.test.mjs`.
