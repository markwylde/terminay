## Context

The server treats a worktree as prunable only when `git worktree list
--porcelain` says so. Git never says so for a locked worktree, and an agent
session that dies holding its lock leaves exactly that. For a prunable entry the
server then ran `git worktree remove --force --force`, which Git refuses unless
the path is entirely absent: a removed `.git` file, an emptied folder, or a file
at the path all fail validation.

Separately, the workspace banner cleared a Git failure whenever any Git refresh
succeeded, and every worktree delete ends with a refresh.

## Goals / Non-Goals

**Goals:**

- Every registration with no working tree lists as prunable and can be deleted.
- Deleting one never affects anything but that registration.
- A failed worktree action stays on screen.

**Non-Goals:**

- Deleting files left at a lost worktree's path. They are no longer a worktree
  and may belong to someone else.
- Letting the clean-worktree sweep remove prunable entries.

## Decisions

- **Mirror Git's prunable test for locked entries.** A locked linked worktree
  whose `<path>/.git` is absent (`ENOENT`, or `ENOTDIR` when the path is a file)
  is prunable. Other stat errors leave the entry as Git reported it.
- **Remove the one administrative directory.** For a prunable entry the server
  reads `--git-common-dir`, finds the `worktrees/<id>` entry whose `gitdir`
  points at the canonical worktree path, and removes it. That is exactly what
  `git worktree prune` does for one entry. `prune` itself was rejected because
  it sweeps every stale registration; recreating a `.git` file so that `remove`
  validates was rejected because `remove` would then delete whatever is at the
  path. The existing post-removal listing still confirms the identity is gone.
- **Tag failures by origin.** A visible feature failure records whether a
  background refresh raised it. A successful refresh clears only such failures;
  action failures are cleared by the next successful action, as before.

## Risks / Trade-offs

- [Git changes its administrative layout] → The post-removal listing check
  reports the delete as failed rather than silently succeeding.
