## Why

The Folders sidebar goes stale and only corrects itself when the folder
workspace remounts, which a sidebar resize or an Explorer refresh causes. A
worktree you delete stays listed, and a folder card keeps its old "+N −M" and
ahead counts after a push or a pull. Two server-side bugs cause this. The
renderer's habit of measuring fresh on every mount has been hiding both.

That same habit is expensive. Every renderer connection re-measures Git for
every worktree of every open project, and each repository is measured twice
after binding. With nine worktrees that's about 150 CPU ticks per attach
natively, against about 28 for one repository, all in spawned `git`. In the
browser demo's emulated VM it's a minute or more per visit. The accidental
cleanup has to be replaced by a correct watch before that cost can be removed
(issue #652).

## What Changes

- **Status-change publication covers what a listing shows.** The server
  publishes `git.status.changed` for a worktree whenever any value its listing
  summary shows has changed since the last one it published. That includes the
  ahead-of-default count, the line counts, unpushed work, prunable and locked.
  Values that vary on every measurement without a real change are never
  compared, so an unchanged re-measure publishes nothing.
- **A removed working tree closes only its own watch.** When a worktree's root
  directory goes away (`git worktree remove`, or `rm -rf` before `prune`), the
  server closes that worktree's watch and re-lists the repository. The
  repository's other watches stay live, on Linux's built-up watch and on the
  native macOS and Windows watches alike.
- **An unavailable observation re-arms on demand.** A repository whose
  observation became unavailable tries to re-establish its watches when the
  next client asks for a listing, never on a timer. If that works, it goes back
  to change-driven updates and cached listings.
- **Mounting a folder workspace reads the cache.** A new `'mount'` sync trigger
  is answered from the watched cache like any other non-fresh listing. `'root'`
  (a real project-root change) and `'refresh'` (an explicit Explorer refresh)
  stay fresh.
- **Only ready watches vouch for a cache.** Watches report when they cover
  their whole scope, which matters for Linux's asynchronously armed tree watch.
  A listing is cached only if every watch was ready before its measurement
  began. A listing raised while watches are still arming waits for them, so the
  first measurement is cached instead of being taken twice. Sharing one fresh
  measurement between concurrent fresh requests was considered and left out
  (see design Non-Goals).
- **Real-watch tests.** Tests delete a worktree root, push a branch with no
  upstream, and move the default branch with a pull, all against the real
  watcher and without asking for a fresh listing. They run on Linux and on the
  macOS CI runner.

The order matters. The publication and watch fixes, with their tests, land
before the `'mount'` trigger stops measuring fresh. Doing it the other way round
would make the sidebar staler.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `git-worktrees-and-quick-push`:
  - Status-change events follow every value a listing shows.
  - A removed working tree is a removal, not an observation failure.
  - Unavailable observation re-arms on the next request.
  - A folder mount is answered from the cache.
  - Listings are cached only under ready watches, and the first listing waits
    for them.

## Impact

- `packages/server-core/src/gitService/service.ts`: status-change
  fingerprinting, working-tree watch error handling, re-arming unavailable
  observations, and watch readiness.
- `packages/server-core/src/gitService/watcher.ts`, `treeWatch.ts` and
  `types.ts`: a distinguishable "watched root went away" error on every
  platform, and an `onReady` notification.
- `src/workspace/gitPaneSyncLog.ts` and
  `src/workspace/useFileExplorerController.ts`: the `'mount'` trigger.
- `packages/server-core/test/`: new real-watch tests. The test that asserts a
  failed watch is permanent is updated to the re-arm contract.
- `.gitea/workflows/ci.yml`: the macOS job also runs the real-watch Git tests.
  There is no Windows runner, so Windows is covered only by injected-watch
  tests.
- No protocol shape change. `git.status.changed` keeps its fields and is only
  published in more of the cases where something changed.
