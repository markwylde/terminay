## Why

An idle Terminay window still costs Microsoft Defender about half a CPU core,
continuously, on a managed Mac. The previous change removed the main process's
own polling — the project-root re-listing, the settings re-reads, and the
`workspace.v4.json` rewrites are all gone, and the syscall counts confirm it.
The load did not go away with them; it moved into spawned children, where a
`fs_usage` trace of the main process cannot see it.

Idle, the app spawns roughly **8.6 child processes per second**: a
`git status --untracked-files=all` per worktree, plus `git diff --numstat`,
`git rev-list --count`, `lsof` and `ps`. For an endpoint-security agent this is
worse than the `stat` traffic it replaced — every `exec` is a fresh binary to
authorise and scan, and git still walks the ~10,000-file tree, just out of
sight. Measured over 90 idle seconds, Defender burned ~45 seconds of CPU across
`wdavdaemon_unprivileged`, `wdavdaemon`, and `wdavdaemon_enterprise`.

Three separate mechanisms combine. A refresh fans out across every worktree
regardless of which one changed, so five worktrees cost ~20 spawns per refresh.
The refresh debounce is 120 ms, which is shorter than the 0.28 s a single
`git status` takes on this repository, so the debounce cannot keep up with the
work it schedules and free-runs at roughly 8 Hz. And agent observation's
`lsof`/`ps` polling runs whether or not the agent-integration setting is on.

## What Changes

- A Git refresh triggered by a change in one worktree queries **only that
  worktree**, instead of re-running the whole command set for every worktree in
  the repository.
- Git status refreshes are bounded by a **minimum interval**, not only by a
  trailing debounce. A trailing debounce alone re-fires on every event spaced
  wider than its delay, which is why 120 ms produced ~8 refreshes a second.
- Agent observation performs **no process or open-file inspection while the
  agent-integration setting is off**. Today `ExtensionAgentRuntime` has no
  reference to that flag at all, so its topology polling continues after the
  feature is disabled.
Streaming `lsof` in repeat mode, so a fixed terminal set costs one process
instead of one per sample, was scoped out after measurement: the fan-out
accounts for essentially all of the 8.6 spawns per second (20 per refresh at
~0.43 refreshes per second), and `lsof`/`ps` for the smaller ~0.43/s batch.
Introducing a long-lived child with its own lifecycle and marker parsing for
that remainder was not worth the risk in the same change. It is recorded as an
open item on ADR-0021.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `git-worktrees-and-quick-push`: a status-change refresh is scoped to the
  worktree whose change raised it, and the refresh cadence is bounded by a
  minimum interval rather than only debounced.
- `agent-status-and-sidebar`: observation is gated on the agent-integration
  setting — while it is off, no topology polling, process enumeration, or
  open-file inspection runs — and sampling for a terminal that keeps finding
  nothing backs off rather than sampling at its fastest cadence indefinitely.

## Impact

- `packages/server-core/src/gitService/service.ts` — `worktrees()` gains a
  worktree scope. This, not `electron/fileViewer/gitDiffService.ts`, is the live
  fan-out: that file's `getWorktreePanelStatus` has no production caller and is
  reached only from `scripts/git-worktree-status.test.mjs`.
- `packages/server-core/src/gitService/adapter.ts`,
  `packages/client-core/src/gitClient.ts`,
  `src/services/git/serverGitWorkspaceAdapter.ts` — carry the scope from the
  event to the query. `GitReadOnlyRequest` already had an optional
  `worktreeId`, so no protocol shape changed.
- `src/workspace/useFileExplorerController.ts` — `WATCH_REFRESH_DELAY_MS` at
  `:31` and the debounce at `:1037`.
- `packages/server-core/src/activity/extensionAgentRuntime.ts` — gating the
  topology poll on the integration setting.
- `packages/server-core/src/activity/agentService.ts` — propagating
  `setIntegrationEnabled` to the runtime.
- `packages/server-core/src/extensions/localAgentObservation.ts` — the `lsof`
  and `ps` invocations at `:1318`, `:1382`, `:1411`, `:1439`.

No protocol or persistence changes. The measurement to beat is spawns per idle
second, which must be counted from the process table rather than from a
syscall trace of the main process — tracing the parent is exactly what hid this
the first time.
