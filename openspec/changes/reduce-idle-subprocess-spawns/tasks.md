## 1. Baseline the right quantity

- [ ] 1.1 Count child processes spawned per idle second from the process table,
  not from a syscall trace of the main process. Verified by recording the
  baseline figure and the exact command used in
  `openspec/adr/evidence/idle-subprocess-spawn-cost.md`.

## 2. Scope Git refreshes to the worktree that changed

- [ ] 2.1 Give the worktree panel refresh in
  `electron/fileViewer/gitDiffService.ts` an optional worktree filter, so the
  per-worktree command set at `:314` runs only for the named worktree and the
  other worktrees' last known entries are carried forward. Verified by a unit
  test asserting that a refresh naming one worktree issues no Git command
  against the others.
- [ ] 2.2 Pass the worktree from the `git.status.changed` event through
  `refreshGitStatusesForRoot`, and keep the unfiltered path for a first load,
  a project root change, or a resubscribe. Verified by a test covering both the
  attributed and unattributed cases.

## 3. Bound the refresh cadence

- [ ] 3.1 Replace the 120 ms trailing debounce at
  `src/workspace/useFileExplorerController.ts:31` with a throttle: refresh
  promptly on the first event after a quiet period, then collapse further
  events into one refresh per minimum interval. Verified by a test that feeds a
  steady event stream and asserts the refresh count over a window.
- [ ] 3.2 Set the minimum interval above the measured cost of one refresh
  (~0.28 s for a single `git status` here). Verified by the value being stated
  with its justification in a comment at the constant.

## 4. Make disabled agent integration cost nothing

- [ ] 4.1 Propagate `setIntegrationEnabled` from
  `packages/server-core/src/activity/agentService.ts` to
  `ExtensionAgentRuntime`. Verified by a test asserting the runtime observes
  the change.
- [ ] 4.2 On disable, cancel each tracked terminal's timers and retire its
  context through the existing identity-checked release path. Verified by a
  test that arms topology polling, disables integration, and asserts no further
  observation call is made for that terminal.
- [ ] 4.3 On re-enable, resume observation for terminals that are still alive
  without restarting them. Verified by a test that disables then re-enables and
  asserts the live terminal is observed again.
- [ ] 4.4 Confirm the disabled idle cost is zero spawns per second, measured
  from the process table.

## 5. Stop spawning per topology sample

- [ ] 5.1 Start `lsof` in repeat mode (`-r`) once per terminal set in
  `packages/server-core/src/extensions/localAgentObservation.ts`, parse its
  per-cycle marker, and restart it only when a terminal opens or closes.
  Verified by a test asserting repeated samples over a steady terminal set
  spawn one process, and that a terminal-set change restarts it.
- [ ] 5.2 Fall back to per-sample invocation when the stream cannot start or
  exits unexpectedly, still gated and still cadence-bounded. Verified by a test
  that fails the stream and asserts observation still reports.
- [ ] 5.3 If 5.1 cannot be made reliable within this change, remove the
  `Topology sampling does not spawn per sample` requirement from the delta spec
  rather than ship a requirement the code does not meet, and record why in the
  proposal.

## 6. Prove the result

- [ ] 6.1 Re-measure spawns per idle second from the process table, with agent
  integration both on and off. Verified by both figures recorded in the
  evidence file alongside the baseline.
- [ ] 6.2 Re-measure endpoint-security CPU across a 90-second idle window, for
  comparison with the 45 s baseline. Verified by the figure in the evidence
  file, with the caveat that it is machine-specific.

## 7. Gate

- [ ] 7.1 `npm run test:ci --workspace @terminay/server-core` passes.
- [ ] 7.2 `npm run lint` and `npm run typecheck:workspaces` pass.
- [ ] 7.3 `npm run smoke` passes.
- [ ] 7.4 `npm run test:e2e` passes in Docker.
- [ ] 7.5 `npx openspec validate --all` reports every item valid.
- [ ] 7.6 Every pull-request status on the head commit is `success` or
  `skipped`, read back from
  `/repos/markwylde/terminay/commits/<head>/statuses` on Gitea. `.github/` has
  no `pull_request` trigger and is not the gate.
