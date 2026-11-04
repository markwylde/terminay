## Why

A folder card in the Folders tree calls its checkout dirty whenever it holds anything the default branch does not have. A branch that is committed, pushed, and waiting in a pull request is therefore drawn exactly like one with work that exists nowhere but this machine, and the card cannot answer the question a person asks of it: is anything here at risk if I walk away? Everywhere else in Git tooling, dirty means local work that has not been pushed.

The fact the card shows today is still wanted: whether a branch holds work the default branch lacks. It is a different fact and needs its own mark.

## What Changes

- A checkout is dirty when it holds work that exists only on this machine: uncommitted or untracked changes, or commits that are not on a remote. The accent colour of the branch and the change size chip follow this definition.
- The change size chip measures the unpushed work only, not the whole branch against the default branch.
- A checkout is unmerged when it holds commits whose effect the default branch does not have, pushed or not. The card marks it with `↑` and the number of those commits after the branch name, as the status bar's branch chip already does.
- `no PR` is shown for a linked folder that is dirty or unmerged and has no pull request, so a pushed branch with no pull request still says so.
- The server measures unpushed work for each worktree and reports it beside the measurement against the default branch.
- "Delete all clean worktrees" and clean-only removal are unchanged: they still require that the default branch lacks nothing the worktree has.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-folders`: "Linked folder presentation" redefines dirty as unpushed work, measures the change size chip against what is pushed, and adds the unmerged mark on the branch line.
- `git-worktrees-and-quick-push`: adds the requirement that a worktree listing reports unpushed work.

## Impact

- `packages/server-core/src/gitService/` — `GitWorktreeSummary` gains `hasUnpushedCommits`, `unpushedLineAdditions`, and `unpushedLineDeletions`; the listing runs at most one more Git command for a worktree that has commits to measure.
- `src/services/git/serverGitWorkspaceAdapter.ts`, `src/types/terminay.ts` — the client projection carries the three fields.
- `src/workspace/folderTreeSources.ts`, `src/workspace/folderTreeModel.ts`, `src/components/folders/` — the card's dirty rule, chip, `no PR` rule, and the new mark.
- `electron/fileViewer/gitDiffService.ts` — fills the three fields so the shared type still holds.
- `project-folders` is not yet a main spec: `linked-folders` and `folders-sidebar-cards` introduce it and are not archived. This change's delta is written against the requirement as `folders-sidebar-cards` leaves it and must archive after both.
