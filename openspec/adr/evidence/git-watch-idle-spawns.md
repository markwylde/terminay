# Git spawns with watch-driven status (change `git-status-watch-and-project-release`)

Date: 2026-09-24 · macOS (Darwin 27), Node 24.14 · server layer, not the packaged app

## Method

`GitService` from `packages/server-core/dist` with the production
`NodeGitCommandRunner` and `NodeGitStateWatcher`. Every Git child was counted at
the runner (ADR-0021: spawns are the cost). Projects were bound and listed once,
then left idle for 60 s, then released and left for another 60 s.

Repositories: this repository's main checkout (seven linked worktrees, a large
`node_modules`) and AppFlowy. A third, non-repository directory was also bound
in the first run, to exercise the `.git` discovery watch.

## Results

| Run | Bind + first listing | Idle 60 s, projects open | 60 s after close |
| --- | --- | --- | --- |
| 1 (3 projects) | 68 | 8 | **0** |
| 2 (2 projects) | 58 | **0** | **0** |

The previous design ran about nine commands per worktree every 10 s for every
bound project. On this repository alone that is about 430 spawns a minute, and
it never stopped after close.

## The eight spawns in run 1

These were real changes, not a feedback loop. The installed Terminay 5.9.0 was
running during the measurement with the old 10 s poll. Its `git status` takes
optional locks, so it writes `index.lock` and rewrites each worktree's `index`.
The watch correctly treated those rewrites as changes. The lock and object
writes were filtered as inert. The new runner sets `GIT_OPTIONAL_LOCKS=0`, so
the server's own reads no longer produce such writes, and with this change
shipped that external source goes away too.

## Not measured here

The packaged desktop app, measured from the process table on the machine that
reported the problem (ten projects with five terminals each). That remains
task 4.3.
