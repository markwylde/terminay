## Context

The Git service observes a bound repository through a host watch
(`GitStateWatcher`, implemented by `NodeGitStateWatcher` in
`packages/server-core/src/gitService/watcher.ts`). It opens one recursive watch
on the common Git directory and one on each working-tree root returned by
`workingTreeWatchRoots`. That function drops a root nested inside another,
because a recursive watch on the outer root already covers it. Events are
attributed (`attributeGitDirChange`, `attributeWorkingTreeChange`) and fed to the
ramping refresh schedule (ADR-0028, which carries ADR-0022's ramp forward).

`fs.watch(path, { recursive: true })` behaves differently by platform. On macOS
it is FSEvents and on Windows it is `ReadDirectoryChangesW`; both are
kernel-side. On Linux, Node (v20+, here v24.15.0) emulates it in
`lib/internal/fs/recursive_watch.js`: it opens one inotify watch per file and
directory. On every change it calls `#watchFolder`, which walks the changed
folder with `readdirSync` and `path.join`/`path.relative` on the main thread.
It has no exclusions, so it walks into `node_modules/`, `dist/` and every other
ignored tree.

We captured this on a production Linux host. Six inspector pauses of the busy
main thread all landed in `#watchFolder` → `readdirSync`, while an agent ran
`npm run build:app` in a 70,000-entry repository. The thread stayed at 100% for
more than two minutes. The signaling sockets closed with 1006 and every client
session connect timed out. The Git service's ramp could not help, because the
work happens inside Node before any event reaches it.

The boundary involved is the **server process's event loop**, which the
remote-access transport, PTY fan-out, MCP and every other service share. Nothing
here crosses the project/window or terminal-session boundary. Watches stay
per-repository, attribution is unchanged, and Git still runs only in the
repository's own worktrees through the service's bounded runner.

## Goals / Non-Goals

**Goals:**

- No Git watch on any platform performs synchronous directory traversal on the
  server's event loop. Every synchronous step has a fixed bound.
- On Linux, changes inside Git-ignored directories cost no watch, no event, and
  no refresh. Native recursive watches on macOS and Windows keep reporting them,
  and the ramp damps them as it does today.
- A built-up watch's cost is bounded by a directory ceiling.
- Any loss of coverage fails into the existing unavailable-watch path. It never
  degrades silently.
- The observations the spec already promises keep working on Linux: file save,
  commit, branch switch, and worktree add/remove.

**Non-Goals:**

- Changing macOS or Windows watching.
- Moving Git observation into a worker thread or child process.
- Adding a native watcher dependency.
- Observing inside submodules or other nested repositories (Decision 6).
- Observing edits to an external `core.excludesFile` (Decision 5).

## Decisions

### 1. A Linux tree watcher replaces Node's recursive emulation

On Linux, `NodeGitStateWatcher.watch(path, { recursive: true })` returns a
`TreeWatch`. The other platforms keep `fs.watch(path, { recursive: true })`.
The platform is chosen once at construction and can be injected, so tests run
the tree watch on any OS.

A `TreeWatch` holds a map from relative directory path to
`{ watcher, dev, ino, excluded: Set<name> }`. Each `watcher` is one
non-recursive `fs.watch(dir)`. It also holds a work queue and an
`AbortController`.

**Bounded steps.** All discovery runs from the work queue, one step per
macrotask (`setImmediate` between steps). Each step has separate limits:

- at most `ENTRIES_PER_STEP` (512) directory entries read, using
  `fs.promises.opendir` and resuming a wide directory across steps rather than
  reading it whole;
- at most `WATCHES_PER_STEP` (64) `fs.watch` calls;
- at most one filter call (Decision 2), carrying at most `FILTER_BATCH` (64)
  candidates.

The queue holds paths, not listings, as a set. A burst of events for the same
directory collapses into one entry, and the queue never holds more entries than
there are directories under the ceiling plus pending candidates.

**Arm, then list.** Taking up a directory opens its watch first, then lists it.
The listing enqueues every child directory that is not already watched or
excluded, and reports one change for the directory itself. Anything created
between the creation event and the arm is therefore still seen, and the save
that follows is still observed.

### 2. Events are classified before they are delivered

A one-level watch reports `(event, name)` for its directory. The tree watch
handles each event as follows:

1. If `name` is in the directory's `excluded` set, drop the event. This covers
   deleting and recreating an ignored `dist/`, which emits events on the watched
   parent even though `dist/` itself is never watched.
2. If `name` is a watched child directory, `lstat` it asynchronously. If it is
   gone, close that subtree (Decision 3) and deliver one change. If its
   `dev`/`ino` differ from the recorded ones, it was replaced: close the subtree,
   re-enqueue the path, and deliver one change. If it is unchanged, deliver the
   change.
3. Otherwise, `lstat` the entry asynchronously.
   - A file or symlink: deliver the change.
   - A directory: hand it to the filter. If the filter excludes it, record the
     name in `excluded` and drop the event. If the filter keeps it, enqueue the
     directory and deliver the change.
   - `ENOENT` for a name never seen as a directory: deliver the change. This
     covers a deleted untracked file.
4. `name === null` (the host could not name it): deliver `null`, as today.

The `lstat` calls are async and run within the step limits. Events for the same
path that arrive while one is pending collapse.

### 3. Removal is confirmed; anything else fails the watch

A subtree is closed only when `lstat` or `opendir` returns `ENOENT` or
`ENOTDIR` for its root, or its `dev`/`ino` changed (replacement). In those cases
the tree watch closes that directory's watcher and every descendant's, and
forgets them. A rename within the tree is a removal at the source plus a new
directory at the destination, which Decision 2 then takes up.

Removal is not detected only through the parent's event. Any event a
directory's own watcher reports also queues a check of that directory: an
async `lstat`, compared on `dev`/`ino`. A deletion is therefore seen even if
the parent's event is lost or coalesced. A directory that still matches costs
nothing more.

Any other signal fails the whole watch through `onError`: an `error` or `close`
from a child watcher whose directory still exists, an unexpected `opendir` or
`lstat` error, a filter rejection, or the root itself disappearing. A failed
watch reaches the existing "Unavailable Git watches do not fall back to polling"
path: one unattributed status-change event, listings measured on demand, and
the cache no longer trusted.

### 4. Working-tree watches skip what Git ignores, decided by Git

`GitWatchOptions` gains an optional
`filterDirectories(relativeDirs: readonly string[], signal: AbortSignal): Promise<readonly string[]>`.
The tree watch calls it with at most 64 candidates and keeps only those
returned. Native recursive watches ignore it.

- **Working tree.** The service's filter first drops `.git` and any directory
  that is the root of another registered worktree, which has its own watch
  (Decision 7). It asks Git about the rest with
  `git -c core.quotePath=false check-ignore -- <path>…`, run in that worktree
  through the existing bounded runner. The paths are passed as arguments: the
  runner has no stdin, and 64 relative paths stay well inside argument limits.
  `-z` is not used because Git accepts it only with `--stdin`; output is one
  path per line, and a C-quoted line (a name with a newline or quote) is
  unquoted. Exit 0 lists the ignored paths and exit 1 means none are ignored. This follows `.gitignore`,
  `.git/info/exclude` and `core.excludesFile`, the same rules `git status` uses,
  and a tracked directory is never reported ignored. Any other outcome rejects
  the filter and fails the watch (Decision 3): another exit code, a spawn
  failure, truncated output, or output naming a path that was not asked about.
- **Git directory.** The filter is synchronous, using the same vocabulary as
  `classifyGitDirEntry`. It drops the top-level `INERT_GIT_DIR_ENTRIES` except
  `info`, which stays watched so that `info/exclude` edits are seen; its events
  are still classified inert for refresh purposes. It also drops `refs/tags`,
  `refs/stash`, and the inert entries under `worktrees/<name>/`.

Running `git check-ignore` is change-driven: when a watch opens, when a new
directory appears, and when ignore inputs change (Decision 5). It never runs on
a timer, so ADR-0028 holds. Git already runs on change for the refresh, so this
adds no new class of work.

### 5. Ignore inputs changing re-filter through a handle method

`GitWatchHandle` gains an optional `refilter(): void`. Calling it bumps the tree
watch's filter generation. A filter result from an older generation is
discarded and its candidates re-asked. The watch then re-queues two checks, in
bounded steps:

- every recorded `excluded` name, so newly un-ignored or newly tracked
  directories are taken up;
- when the trigger was a rule change, every watched directory, so newly ignored
  ones are closed.

The service calls `refilter()` on a repository's working-tree handles when:

- a working-tree event names a `.gitignore` leaf (rules changed);
- a Git-directory event names `info/exclude` or `config` (rules changed:
  `core.excludesFile` may have moved);
- a Git-directory event names `index` (tracking changed; only the `excluded`
  set is re-checked).

Edits to the *contents* of an external `core.excludesFile` are not observed;
that file lives outside the repository. A directory that such an edit newly
un-ignores is taken up at the next `refilter()` or rebind. This limit is
recorded in the spec delta.

### 6. Nested repositories are boundaries

When a listing shows that a non-root directory contains a `.git` entry (file or
directory), that directory is a submodule or another nested repository. The tree
watch closes that directory's watch and records it as `excluded`, without
passing any path inside it to the filter. Git rejects such paths in
`check-ignore`. The superproject's status reports a submodule through its
gitlink, which the index watch covers.

### 7. Every worktree root gets its own watch on Linux

With ignore-aware filtering, a linked worktree under the main checkout is
usually inside an ignored directory (for example `.claude/worktrees/`, ignored
through `core.excludesFile`), so the outer watch no longer covers it. When the
watcher builds watches, the service therefore gives every worktree root its own
watch, and each root's filter excludes the other roots it contains.
`attributeWorkingTreeChange` already picks the innermost worktree. Native
recursive watches keep the nesting collapse.

### 8. A ceiling bounds each built-up watch

A tree watch holds at most `MAX_WATCHED_DIRECTORIES` (16,384, overridable for
tests). Exceeding it fails the watch with an error whose code is `ETOOMANYDIRS`
and whose message names the ceiling. `ENOSPC` (the inotify watch limit) and
`EMFILE` from `fs.watch` fail it with their own codes. All three go through
Decision 3's failure path, and the watch-failed report carries the code.
Native recursive watches have no ceiling of ours, and the spec scopes the
ceiling to built-up watches.

### 9. Teardown cancels everything

`close()` and any failure abort the tree watch's `AbortController`. Every
continuation checks the signal after each `await` and before each `fs.watch`,
filter call or callback. The filter receives the signal and passes it to the
runner, so a pending `check-ignore` is killed. After `close()` returns, no new
watch is opened, no callback runs and no Git command starts. Closing a project
that shares the repository with another keeps the shared watches (existing
behaviour), and the remaining project keeps its observation.

### 10. Evidence

The inspector stack samples and the timeline are recorded in
`openspec/adr/evidence/linux-recursive-watch-stall.md` for ADR-0114.

## Risks / Trade-offs

- [Coverage lag on a large first scan] Deep directories are armed a few steps
  after the watch opens. → Arm-then-list loses nothing, an explicit Explorer
  refresh always measures (existing requirement), and the delay is bounded by
  the directory count ÷ 64 steps.
- [Ignored files (not directories) in watched directories still emit events,
  for example `*.log`] → Those events go through the ramp as today. Only ignored
  *directories* are excluded, which is where build churn lives.
- [`check-ignore` spawns] → At most one per step, each for at most 64
  candidates. An ignored tree is never descended into, so a `node_modules`
  install costs one check for `node_modules` itself.
- [An `index` change re-checks the excluded set] → Usually a handful of names,
  in a single 64-path call.
- [Repositories with more than 16,384 non-ignored directories lose live status]
  → They are measured on demand, as the spec allows. The ceiling can be raised
  with evidence.
- [External `core.excludesFile` edits are unobserved] → Documented. The effect
  is a directory staying excluded until the next re-filter or rebind.

## Migration Plan

No migration is needed: there is no persisted state or protocol change. It
ships with the next server and Desktop release. Rollback is the previous
release.

## Open Questions

None. ADR-0028 (no polling without owner approval, which supersedes ADR-0022)
stays in force and is honoured. ADR-0114 records the new commitment.
