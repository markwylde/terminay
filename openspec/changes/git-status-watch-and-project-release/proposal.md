## Why

With ten projects open, Terminay keeps running Git in the background, and
closing every project does not stop it. The Activity Monitor shows a steady
stream of `git` children long after the last tab is gone, costing CPU and
endpoint-security scans for projects the user is no longer using.

Two defects cause this:

- **Closing a project never releases its Git binding.** Opening a project calls
  `GitService.bindProject`, which starts a 10 s status poll. `unbindProject`,
  the only thing that stops that poll, has no caller. Every project closed this
  session keeps running about nine Git commands per worktree every 10 s until
  the app quits. `packages/server-core/test/project-close-releases-resources.test.mjs`
  reproduces it: terminals are killed correctly, but after `project.close`
  the runner records `worktree list`, `status`, `merge-tree`, `diff --numstat`,
  and so on, every poll interval.
- **The status poll should not exist.** ADR-0022 already names it a defect:
  Git state and working-tree edits are filesystem changes a watch can observe.
  Even for open projects, the poll re-runs the full command set every 10 s
  whether or not anything changed.

## What Changes

- Closing a project releases every piece of server-held state the project
  opened: its Git binding, its Git watchers, its file observations, and its
  per-project file, documentation, MDX runtime, and agent-scope records. This
  happens whether the project had terminals or not.
- The Git service stops polling. Each bound project watches its repository's
  Git directory (`HEAD`, `index`, `refs`, `packed-refs`, the worktree registry,
  and each linked worktree's gitdir) and each worktree's working tree. A watch
  event schedules one worktree-scoped refresh through the shared 1–20 s ramp.
  With no change, no Git command runs.
- The server keeps the last measured worktree listing while its watch is live,
  and serves listing requests from it until a watch event invalidates it. A
  client listing after a status-change event no longer repeats the Git work the
  server just did.
- If a watch cannot be established or fails, the server reports the watch as
  unavailable, measures on demand whenever a client asks, and schedules no
  timer.
- **BREAKING (internal API):** `GitServiceOptions.statusPollIntervalMs` is
  removed. The only callers are tests.
- A new ADR (0028) supersedes ADR-0022. It keeps ADR-0022's watch-first rule
  and ramp, and adds that no poll of any kind may be introduced unless it is
  the last resort and the repository owner has explicitly approved it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `git-worktrees-and-quick-push`: Git status follows repository and
  working-tree changes through watches rather than a timer; an idle repository
  runs no Git; a closed project runs no Git.
- `server-owned-workspace-state`: closing a project releases all server-held
  per-project resources, not only its terminal sessions.

## Impact

- `packages/server-core/src/gitService/` — remove the status poll; add a
  watch-driven invalidation and refresh path; add project release; drop
  `statusPollIntervalMs` from `types.ts`.
- `packages/server-core/src/composition.ts`, `workspaceProtocol.ts` — a
  project-release hook that runs after every `project.close`, independent of
  terminal count.
- `electron/serverTerminalAuthority.ts` and `apps/terminay-server/src/cli.ts` —
  implement the release hook for their per-project maps and file observations,
  and give the Git service a Node filesystem watcher.
- `src/workspace/gitRefreshSchedule.ts` — moved to a shared package so the
  server and the UI use one ramp implementation, as ADR-0022 requires.
- `openspec/adr/0028-*.md` — the new polling rule, superseding ADR-0022.
- Linux: recursive working-tree watches use one inotify watch per directory,
  so very large trees can hit `fs.inotify.max_user_watches`. That case falls
  back to on-demand measurement (see design).
