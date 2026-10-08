## 1. Server measurement

- [x] 1.1 Add `hasUnpushedCommits`, `unpushedLineAdditions`, and `unpushedLineDeletions` to `GitWorktreeSummary` in `packages/server-core/src/gitService/types.ts` and fill them in the worktree listing. Verified by `npm run build:shared` compiling.
- [x] 1.2 Measure unpushed commits in `packages/server-core/src/gitService/service.ts`: the status header's ahead count under a live upstream, sized with `git diff --numstat @{upstream}...HEAD` only when ahead; otherwise `git rev-list --count HEAD --not --remotes`, skipped when the branch's tree is already on the default branch, sized with the delta against the default branch. Verified by the test "GitService reports a worktree's unpushed work apart from what the default branch lacks" in `packages/server-core/test/git-service.test.mjs`, which uses a real bare remote and covers a new worktree, a never-pushed commit, a pushed branch, a commit ahead of the upstream with an uncommitted edit, a squash-merged branch whose remote branch was deleted, and the default branch ahead of its upstream.
- [x] 1.3 Name the unpushed fields in the cache-mismatch report so a watch that misses a push is diagnosable. Verified by `npx turbo run test:ci --filter=@terminay/server-core` passing.

## 2. Client projection

- [x] 2.1 Carry the three fields on `GitWorktreeStatus` (`src/types/terminay.ts`) and parse them in `src/services/git/serverGitWorkspaceAdapter.ts`. Verified by the new assertions in `scripts/server-git-workspace-adapter.test.mjs`.
- [x] 2.2 Fill the three fields in `electron/fileViewer/gitDiffService.ts`, which does not measure against a remote, by reporting unmerged work as unpushed. Verified by `npx tsc --noEmit -p .` exiting zero and `scripts/git-worktree-status.test.mjs` passing.

## 3. Folder cards

- [x] 3.1 Make `worktreeChange` in `src/workspace/folderTreeSources.ts` read the unpushed fields, and add `worktreeUnmerged` for the commits the default branch lacks. Leave `isWorktreeShownClean` and the clean sweep on the strict rule. Verified by the rewritten `worktreeChange` case in `scripts/folders-tree-row.test.mjs`, the new case in `scripts/folder-tree-sources.test.mjs`, and `scripts/clean-worktree-sweep.test.mjs` passing unchanged.
- [x] 3.2 Carry `unmerged` on `FolderTreeWorktree` and `FolderTreeFolderRow` in `src/workspace/folderTreeModel.ts`. Verified by the new case in `scripts/folder-tree-model.test.mjs`.
- [x] 3.3 Draw the mark after the branch name in `src/components/folders/FoldersTree.tsx` with its accessible name and tooltip, style it muted and non-shrinking in `foldersTree.css`, show `no PR` for a linked folder that is dirty or unmerged, and reword the change chip's tooltip. Verified by the new card case and the extended `showsNoPullRequest` and `unmergedMark` cases in `scripts/folders-tree-row.test.mjs`, under `npm run test:linked-folders`.
- [x] 3.4 Cover it end to end with a bare remote: a pushed branch is drawn in the ordinary colour with `↑1`, `no PR`, and no change size; an unpushed one is in the accent colour with its size; a push from a shell clears the card without a refresh; an uncommitted edit makes a pushed branch dirty again. Verified by the test "a pushed branch is not dirty and still shows the commits the default branch lacks, and a push from a shell clears a dirty card" in `e2e/linked-folders.spec.ts` passing under `npm run test:e2e -- e2e/linked-folders.spec.ts`.

## 4. Specs and delivery

- [x] 4.1 Run `openspec validate folders-dirty-means-unpushed --strict`, `npm run lint`, and `npx tsc --noEmit -p .`. Verified by all three exiting zero.
- [ ] 4.2 Before archiving, check that `linked-folders` and `folders-sidebar-cards` have archived and that `openspec/specs/project-folders/spec.md` has a requirement named "Linked folder presentation"; rebase this change's delta onto it if its text moved. Verified by `openspec validate --all` passing and a read-through of the folded requirement showing one definition of dirty.
- [ ] 4.3 Open the pull request on `origin` (Gitea) with `tea` and read back the commit statuses on the head SHA. Verified by every status being `success` or `skipped`.
