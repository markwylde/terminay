## 1. Report types and identity

- [x] 1.1 Add `GitObservationReport` (watch opened/closed/failed, changes summary, measurement completed/failed/abandoned, cache mismatch) and `onObservation` to `gitService/types.ts`, exported from `gitService/index.ts`. Verified by `npm run typecheck` passing for `@terminay/server-core`.
- [x] 1.2 Add the process-local diagnostic id allocator (`r<n>`, `w<n>`, with `role` and `listIndex`) to the Git service. Verified by a new unit test asserting ids are stable per canonical id within a process, never equal to a canonical id, and absent from no report.
- [x] 1.3 Add `classifyGitDirEntry` to `observation.ts` beside `attributeGitDirChange`, mirroring it branch for branch. Verified by extending `git-observation-attribution.test.mjs` with one case per class, including `unnamed` and `lock`, and by asserting class and scope agree for every case.

## 2. Watch lifecycle reports

- [x] 2.1 Report `watch.opened` and `watch.closed` from `addWatch`, `syncWorkingTreeWatches`, `watchForRepository`, `disposeObservation`, and `stopObserving`, with kind and recursive flag. Verified by a fake-watcher test asserting one opened and one closed report per watch across bind, worktree add, worktree removal, and release.
- [x] 2.2 Report `watch.failed` from `observationFailed` and the discovery watch's `onError`, carrying the error code and message. Verified by a fake-watcher test that fails a watch with `ENOSPC` and asserts the report's code, message, and that the repository is subsequently measured on demand.
- [x] 2.3 Guard every report call so a throwing observer changes nothing. Verified by a test whose observer throws on every report and whose listing results equal those of a run with no observer.

## 3. Change and measurement reports

- [x] 3.1 Accumulate per-observation counters by class and scope in `observedChange`, and count listings answered by `cachedListing`. Verified by a test emitting a burst of mixed events and asserting no report is produced until a measurement or the flush.
- [x] 3.2 Emit the accumulated summary on the next measurement record, and from a single unref'd one-shot timer when no measurement follows. Verified by a test with only lock and inert events asserting exactly one `changes` report and no Git command, using a shortened `observationFlushMs`.
- [x] 3.3 Emit `measurement.completed` from `measureWorktrees` with claim, trusted, re-measured and carried counts, per-worktree ahead/additions/deletions/changedFiles (first 32), duration, cached, published and suppressed counts, and `raisedBy`. Verified by a test moving the default branch and asserting `claim: all`, `carried: 0`, and the sibling worktree's delta in the record.
- [x] 3.4 Emit `measurement.failed` and `measurement.abandoned` on the throw and released-mid-measurement paths. Verified by tests that fail a Git command and that release the project mid-measurement, asserting the report and that the claim was restored.
- [x] 3.5 Count published and suppressed status-change events in `publishStatusChange`. Verified by a test in which a sibling's delta changes while its fingerprint does not, asserting `suppressed: 1` for it.
- [x] 3.6 Assert no report carries a path, ref or branch name, canonical id, or project id. Verified by a test that serialises every report from a full scenario and searches it for the repository root, each branch name, and each canonical id.

## 4. Forced measurement and cache mismatch

- [x] 4.1 Accept optional boolean `fresh` on `git.worktrees.list` in `gitService/adapter.ts` and `client-core/gitClient.ts`, validated by the bounded-object check. Verified by adapter contract tests for `true`, `false`, absent, and a non-boolean value being refused.
- [x] 4.2 Make `GitService.worktrees` with `fresh` skip the cache, claim everything, and compare against the trusted cached listing, emitting `cache.mismatch` with differing worktree diagnostic ids and fields. Verified by a test that changes the default branch with the fake watcher silent, requests `fresh`, and asserts the corrected listing and one mismatch report naming the sibling's `lineAdditions`.
- [x] 4.3 Verify the no-mismatch and event-driven paths. Verified by tests asserting a `fresh` listing over an unchanged repository reports no mismatch, and that a listing without `fresh` over a clean trusted observation runs no Git command.

## 5. Host wiring

- [x] 5.1 Pass `onGitObservation` through `ServerTerminalAuthority` to the Git service. Verified by the source-contract assertion in `scripts/local-desktop-diagnostics-git-observation.test.mjs` that the authority constructs the service with `onObservation` forwarding to the option, and end to end by task 6.3.
- [x] 5.2 Record reports in Desktop diagnostics from `electron/main.ts` on the lifecycle channel with component `local-server`, source `local-server-git`, and stable event names (`local-server.git.watch.failed`, `…measurement.completed`, `…cache.mismatch`, and the rest). Verified by a diagnostics test asserting each report kind produces one parseable JSON line with the expected event name and severity (`warning` for failed, failed measurement, and mismatch; `info` otherwise).
- [x] 5.3 Write reports to stderr as single JSON lines from `apps/terminay-server/src/cli.ts`. Verified by the source-contract assertion in `scripts/local-desktop-diagnostics-git-observation.test.mjs` that the standalone Git service is constructed with an observer writing one `[terminay-server] git observation` JSON line per report.

## 6. Git pane sync evidence

- [x] 6.1 Give `refreshGitStatusesForRoot` a `trigger` argument and name it at every call site (`event`, `resync`, `root`, `refresh`, `directory`, defaulting to `action` for refreshes that follow a worktree action); send `fresh` for `root` and `refresh`, and make the Explorer refresh control re-measure Git. Verified by a renderer unit test asserting the list request's `fresh` flag per trigger.
- [x] 6.2 Emit the `[terminay] git.pane.sync` console line from `applyGitWorkspaceRefresh` for applied-changed, superseded, and failed outcomes, folding applied-unchanged into `unchangedSince`. Verified by a unit test for each outcome and by a test that ten unchanged refreshes produce no line.
- [x] 6.3 Confirm the records reach the Diagnostics folder from the running app. Verified by an Electron E2E test run through `npm run test:e2e` that moves the default branch under a linked worktree, sees the row lose its delta, reloads the Explorer, then reads the diagnostic segment and finds the default-branch measurement, a refresh-raised measurement, and a `git.pane.sync` record, with no project path, worktree name, or branch name in any of them.

## 7. Real-watcher coverage

- [x] 7.1 Add `git-real-watch-default-branch-move.test.mjs` using the default `NodeGitStateWatcher`: bare remote, clone, nested linked worktree, remote merge, `git pull --ff-only` in the main checkout. Verified by the test asserting the linked worktree's additions and deletions reach zero within its deadline and that the reports include a `default-branch-ref` change with scope `all`.
- [x] 7.2 Add the same scenario driven by `pullWorktree`. Verified by the test passing with the same assertions.

## 8. Specs, validation, and delivery

- [x] 8.1 Run `openspec validate --all`. Verified by it exiting zero.
- [x] 8.2 Run the server-core, client-core, and `scripts/` Node test suites and `npm run test:e2e` for the affected spec. Verified by all passing.
- [ ] 8.3 Open the pull request on `origin` with `tea` and read back the commit statuses. Verified by every status on the head SHA being `success` or `skipped`.
