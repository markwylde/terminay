## Context

`GitService` (`packages/server-core/src/gitService/service.ts`) keeps one
binding per project. `bindProject` stores the binding and starts
`startStatusPoll`, a self-rescheduling 10 s `setTimeout` that calls
`worktrees({ projectId })`. Each listing runs `worktree list`, the
default-branch probe, and about five commands per worktree (`status`,
`rev-list --count`, `rev-parse <branch>^{tree}`, `merge-tree`,
`diff --numstat`). When the fingerprint changes, it publishes
`git.status.changed`. The UI (`useFileExplorerController`) reacts by calling
`client.list`, which runs the same commands a second time.

Bindings are created in three places: the Electron authority when it opens a
project or changes its root (`serverTerminalAuthority.ts:1300`, `:1354`), the
standalone server CLI (`cli.ts:797`, `:1178`), and lazily in
`ServerGitAdapter.ensureProjectBound`. Nothing calls `unbindProject`.
`project.close` goes through `workspaceProtocol.ts`, which kills the project's
terminal sessions (proven by `server-composition.test.mjs:366`) but has no hook
for any other per-project state. The Electron authority also keeps per-project
file catalogs, documentation catalogs, MDX runtimes, content streams, file
session contexts, and agent scope, and never releases any of them.

ADR-0022 already rules the status poll a defect and names the fix: watch
`.git/HEAD`, `.git/index`, `.git/refs`, and the working tree, and damp the work
with the 1/2/3/5/10/20 s ramp (`src/workspace/gitRefreshSchedule.ts`). The
server file-observation host already uses Node `fs.watch`, so the server can
watch the filesystem.

## Goals / Non-Goals

**Goals:**

- A closed project costs nothing: no Git, no watches, no retained per-project
  state.
- An open, idle project runs no Git.
- Changes to Git state or the working tree reach the sidebar within the ramp's
  first step (about 1 s).
- A status-change event followed by a client listing costs one measurement,
  not two.

**Non-Goals:**

- Removing the other timers ADR-0028 inventories, such as PTY foreground
  sampling, the Dockview reconcile loop, and the file viewer's refresh
  fallback. Each needs its own change.
- Filtering gitignored paths out of working-tree events. The ramp bounds the
  cost, and the fingerprint suppresses redundant events.
- Watching remote refs on the network. Remote state changes only when a local
  `fetch` or `pull` writes `refs/remotes`, and that write is watched.

## Decisions

### 1. Release is a composition-level project lifecycle hook

`workspaceProtocol` calls a new `releaseProject(projectId)` after it applies
`project.close`, whatever the terminal count. The composition implements it
by calling `git.releaseProject(projectId)`, then the host's
`workspaceOperations.releaseProject`. The Electron authority's version deletes
the project from every per-project map, calls `mdxRuntime.disposeAll()`,
aborts that project's file observations, and calls
`agentScope.removeProject`. The CLI implements the same hook for the maps it
owns.

*Why not the renderer?* The renderer is untrusted, and one project can be
closed by any client or by MCP. Release belongs to the command, on the server,
where the workspace state changes. *Why not piggy-back on
`closeProjectTerminalSessions`?* It only runs when sessions exist, which is
why releasing on that path would miss projects with no terminals.

Boundary: this is the project security boundary. After release,
`ServerGitAdapter.ensureProjectBound` resolves the root from the workspace,
finds nothing, and must not re-bind. Git requests for the closed project then
fail with `invalid-project` rather than silently resurrecting a binding.

### 2. The Git service owns a host-injected watcher; server-core ships the Node one

`GitServiceOptions` gains `watcher?: GitStateWatcher`, shaped like
`GitCommandRunner`: a small interface with a `NodeGitStateWatcher` default built
on `fs.watch`. `recursive: true` is used for working trees, since Node supports
it on macOS, Windows, and Linux. Tests inject a fake watcher, as they already
inject a fake runner.

Per repository (keyed by `repositoryId`, reference-counted across the projects
bound to it) the service watches:

| Path | Scope of refresh |
| --- | --- |
| common gitdir: `HEAD`, `index`, `refs/**`, `packed-refs` | the main worktree; `packed-refs` → unscoped |
| common gitdir: `worktrees/` (registry) | unscoped, and re-derive the watch set |
| each linked worktree's gitdir: `HEAD`, `index` | that worktree |
| each worktree's working tree, recursive, excluding its `.git` entry | that worktree |

Events under `objects/`, `logs/`, `hooks/`, and any `*.lock` are dropped.
Working-tree events whose path is inside a nested worktree are attributed to
the innermost worktree. Directories come from `rev-parse --git-common-dir` and
`worktree list --porcelain`, which binding and listing already run.

*Alternative: watch only `.git`.* Rejected by the owner during planning,
because unstaged edits would not show until the next Git operation.
*Alternative: reuse the file-observation registry.* It is client-subscription
scoped and bounded per client. Git observation is server-internal and must
exist with no client attached.

### 3. Watch events drive one scheduler per repository through the shared ramp

`createRefreshSchedule` moves from `src/workspace/gitRefreshSchedule.ts` into
a shared package that server-core and the UI both import. ADR-0022 requires one
ramp implementation, used everywhere. The service keeps one schedule per
repository and accumulates the pending worktree IDs the way the UI does today:
one ID means a scoped refresh, several or an unattributed event mean
unscoped. The refresh calls the existing `worktrees()` with that scope, which
publishes `git.status.changed` only when the fingerprint changes.

### 4. Watch-validated listing cache

`lastWorktreeSummaries` is already kept per repository. Each summary gains a
`dirty` bit. A watch event sets it for the worktrees it names, or for all of
them when unscoped. A measurement clears it. `worktrees()` re-measures only
dirty worktrees, and only while that repository's watch is live. With no dirty
summary and a live watch, it returns the cached listing and spawns nothing.
This turns the UI's follow-up `client.list` into a cache hit. Mutating
operations (pull, remove, move, quick push) mark the affected worktrees dirty
before they return, so they never read a stale cache.

### 5. Watch failure means on-demand, never a timer

A watcher `error` (including `ENOSPC` from inotify limits, or `EMFILE`), or
failing to set a watch up, marks the repository `observation: unavailable`,
closes its partial watches, clears the cache, and publishes one unattributed
`git.status.changed` event. From then on, `worktrees()` always measures. No
timer is created. This is the ADR-0028 rule: the fallback for an
unobservable source is to answer when asked, not to sample. Re-binding the
project, for example through a root change or a restart, tries again.

### 6. Delete the poll

Remove `startStatusPoll`, `stopStatusPoll`, `statusPollTimers`, and
`statusPollIntervalMs`. `close()` closes the watchers and cancels the
schedules instead.

## Risks / Trade-offs

- [Linux inotify: one watch per directory; large monorepos can exhaust
  `max_user_watches`] → Decision 5: that project degrades to on-demand
  measurement, visibly, rather than polling. Watches are shared across
  projects on the same repository.
- [`node_modules` or build output churn triggers refreshes even though Git
  ignores it] → The ramp caps a churning repository at one refresh per 20 s,
  and the fingerprint stops those refreshes from producing client events.
  Ignore-aware filtering is a follow-up if measurement shows it matters.
- [macOS FSEvents coalesces and may deliver events late or merged] → Events
  only mark the cache dirty and request a refresh. A coalesced event still
  names a path inside the right worktree, and a dropped fine-grained name
  falls back to an unscoped refresh.
- [A cache served while the watch is silently dead] → The cache is trusted
  only while the watcher has emitted no error. Node surfaces a torn-down watch
  as `error` or `close`, and both flip the repository to unavailable.
- [Release racing an in-flight listing] → Release bumps a per-project
  generation. A listing that finishes after release discards its result and
  publishes nothing.

## Migration Plan

Nothing is persisted, so nothing needs migrating. Removing
`statusPollIntervalMs` only affects tests that pass it; they switch to an
injected fake watcher. Rollback is a revert.

## Open Questions

- ADR-0022 is superseded by ADR-0028, which this change records. It adds the
  owner-approval gate for any poll. The adr step records the supersession.
