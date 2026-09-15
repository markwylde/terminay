## 1. Baseline the right quantity

- [x] 1.1 Count child processes spawned per idle second from the process table,
  not from a syscall trace of the main process. Measured 7.30/s against the
  shipped app, and the breakdown corrected the report's attribution: `lsof` and
  `ps` are ~97% of spawns, Git 3 in 20 s. Recorded with the command in
  `openspec/adr/evidence/idle-subprocess-spawn-cost.md`.

## 2. Scope Git refreshes to the worktree that changed

- [x] 2.1 Give the worktree listing an optional worktree scope, so the
  per-worktree command set runs only for the named worktree and the others are
  carried forward from the previous listing. The fan-out is in
  `packages/server-core/src/gitService/service.ts` `worktrees()`, not in
  `electron/fileViewer/gitDiffService.ts` as first reported: that file's
  `getWorktreePanelStatus` has no production caller and runs only from
  `scripts/git-worktree-status.test.mjs`. Verified by
  `packages/server-core/test/git-worktree-refresh-scope.test.mjs`, which counts
  commands through the injectable runner and asserts **zero** against the
  out-of-scope worktree.
- [x] 2.2 Pass the worktree from the `git.status.changed` event through
  `refreshGitStatusesForRoot` -> `loadServerGitWorkspace` -> `client.list`, and
  keep the unfiltered path for a first load, a root change, or a resubscribe.
  Several distinct worktrees in one interval, or any event naming none, force a
  full refresh rather than scoping to one of them. Verified by the scoped,
  never-seen, and unattributed cases in the same test file.

## 3. Bound the refresh cadence

- [x] 3.1 Replace the 120 ms trailing debounce at
  `src/workspace/useFileExplorerController.ts:31` with a throttle: refresh
  promptly on the first event after a quiet period, then collapse further
  events into one refresh per minimum interval. Verified by a test that feeds a
  steady event stream and asserts the refresh count over a window.
- [x] 3.2 Set the minimum interval above the measured cost of one refresh
  (~0.28 s for a single `git status` here). Verified by the value being stated
  with its justification in a comment at the constant.

## 4. Make disabled agent integration cost nothing

- [x] 4.1 Propagate `setIntegrationEnabled` from
  `packages/server-core/src/activity/agentService.ts` to
  `ExtensionAgentRuntime`. Verified by a test asserting the runtime observes
  the change.
- [x] 4.2 On disable, cancel each tracked terminal's timers and retire its
  context through the existing identity-checked release path. Verified by a
  test that arms topology polling, disables integration, and asserts no further
  observation call is made for that terminal.
- [x] 4.3 On re-enable, resume observation for terminals that are still alive
  without restarting them. Verified by a test that disables then re-enables and
  asserts the live terminal is observed again.
- [ ] 4.4 Confirm the disabled idle cost is zero spawns per second, measured
  from the process table.

## 5. Stop spawning per topology sample

- [x] 5.3 Taken. Measurement showed the fan-out accounts for essentially all of
  the 8.6 spawns/s and `lsof`/`ps` for the smaller ~0.43/s batch, so streaming
  `lsof` was scoped out rather than half-built: the
  `Topology sampling does not spawn per sample` requirement is removed from the
  delta spec, the existing back-off behaviour is specified in its place, and the
  streaming/native direction is recorded as an open item on ADR-0021. Verified
  by the delta spec containing no requirement the code does not meet.

## 6. Prove the result

- [x] 6.1 Prove each reduction at the unit level, where it is exact and
  reproducible: zero Git commands against an out-of-scope worktree; 10 s of
  120 ms events costing at most 11 refreshes rather than ~83; one shared `ps`
  per sampling round instead of one per terminal; no observation scheduled while
  integration is off. Verified by the four new test files.
- [ ] 6.2 Re-measure spawns per idle second and endpoint-security CPU end to
  end. **Deliberately not claimed here.** The 7.30/s baseline came from a
  machine running five worktrees and several live Claude Code sessions; that
  workload cannot be reproduced on the build machine, so an end-to-end figure
  taken here would not be comparable to it. This needs re-running on the
  reporting machine against a build of this branch.

## 7. Gate

- [x] 7.1 `npm run test:ci --workspace @terminay/server-core` passes.
- [x] 7.2 `npm run lint` and `npm run typecheck:workspaces` pass.
- [ ] 7.3 `npm run smoke` passes.
- [ ] 7.4 `npm run test:e2e` passes in Docker.
- [x] 7.5 `npx openspec validate --all` reports every item valid.
- [ ] 7.6 Every pull-request status on the head commit is `success` or
  `skipped`, read back from
  `/repos/markwylde/terminay/commits/<head>/statuses` on Gitea. `.github/` has
  no `pull_request` trigger and is not the gate.
