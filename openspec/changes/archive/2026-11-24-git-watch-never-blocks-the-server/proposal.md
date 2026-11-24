## Why

A Terminay Server on Linux stops answering every client for minutes at a time
while a build or dependency install runs in a project it observes. Clients show
"Session connect timed out" and every retry fails until the build settles. On
the affected host the server's main thread sat at 100% CPU for over two minutes,
twice. Every inspector sample was inside Node's own recursive `fs.watch`. On
Linux, Node implements that watch in JavaScript: each created directory makes it
re-walk the subtree synchronously with `readdirSync`. The Git service puts that
watch on every working tree and on the Git directory, so a build that deletes and
recreates `dist/` in a 70,000-entry repository keeps the event loop busy until
the churn stops.

## What Changes

- On Linux, the Git service no longer uses Node's recursive `fs.watch`. A
  recursive Git watch becomes a set of one-level watches, one per observed
  directory. They are discovered and extended by asynchronous scans that yield
  to the event loop between bounded batches, so no watch event ever walks a
  tree synchronously.
- Working-tree watches skip the directories Git ignores (for example
  `node_modules/`, `dist/`, build output), every `.git` directory, and nested
  repositories such as submodules. Churn in ignored output therefore costs no
  watch work and no Git refresh. Git decides what is ignored, and the decision
  is re-checked when `.gitignore`, `info/exclude`, `config` or the index
  changes.
- The watch follows the tree: renamed, replaced and deleted directories are
  handled. Any other loss of coverage fails the watch instead of degrading
  silently.
- The Git-directory watch skips the entries that cannot change status
  (`objects/`, `logs/`, `hooks/`, and the like), the same entries observation
  already classifies as inert.
- Each recursive watch has a ceiling on how many directories it observes. Going
  over the ceiling, or hitting the host's inotify limit, fails the watch through
  the existing "Unavailable Git watches do not fall back to polling" path.
- New directories that arrive in bursts are scanned in one queued batch, not
  once per event.
- macOS and Windows keep the native recursive watch, which is
  kernel-implemented and does not walk the tree in JavaScript.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `git-worktrees-and-quick-push`: Git observation gains requirements that
  watching never blocks the server's event loop and that closing a watch stops
  its work. On Linux, built-up watches follow the tree and its ignore rules,
  skip Git-ignored directories, and fail rather than degrade, including at
  their directory ceiling.

## Impact

- `packages/server-core/src/gitService/watcher.ts`: a Linux tree watcher behind
  the existing `GitStateWatcher` interface.
- `packages/server-core/src/gitService/types.ts`: `GitWatchOptions` gains an
  exclusion hook so the service can name ignored and inert directories.
- `packages/server-core/src/gitService/service.ts`: supplies Git-ignore
  knowledge for working trees and inert-entry exclusion for the Git directory.
- Tests in `packages/server-core/test/` for the Linux watcher. These cover
  ignored directories, burst creation without blocking, the directory ceiling,
  and the existing file-save, commit and branch-switch observations.
- Affects both the standalone Terminay Server and the embedded Local server on
  Linux. No protocol, client, or persisted-state change.
