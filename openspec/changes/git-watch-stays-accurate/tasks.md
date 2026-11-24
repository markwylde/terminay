## 1. Status-change publication follows every listed value

- [x] 1.1 Add `listedSummaryFingerprint(summary)` to the Git service: every `GitWorktreeSummary` field except an explicit, documented exclusion list (empty today). Verified by a unit test asserting that summaries differing in any single field give different fingerprints, and identical summaries give equal ones.
- [x] 1.2 Keep a per-worktree summary fingerprint beside `statusFingerprints`. Pass the summary from `measureWorktrees` into `publishStatusChange`, and publish when either fingerprint changed. A listing stores both, `status()` stores only the status fingerprint, and both maps are cleared together wherever one is cleared today. Verified by tasks 1.3–1.6.
- [x] 1.3 Real-watch test: a clean linked worktree whose branch has no upstream pushes it to a new remote branch from a shell. Without a fresh listing, a `git.status.changed` event arrives for that worktree, and the next ordinary listing shows `hasUnpushedCommits: false` and a zero unpushed line delta. Verified by the test passing, and failing against the unpatched service.
- [x] 1.4 Real-watch test: the same push with an uncommitted tracked change. An event arrives, and the next ordinary listing shows no unpushed commits and an unpushed line delta equal to the uncommitted change. Verified by the test passing.
- [x] 1.5 Real-watch test: a pull moves the default branch and changes a linked worktree's ahead count or line delta. An event is published for that worktree, and the next ordinary listing shows the new values. Verified by the test passing, and failing against the unpatched service.
- [x] 1.6 Unit test: re-measuring an unchanged worktree publishes nothing, both from a watch refresh and from a fresh listing, including when `status()` and listing calls alternate for that worktree. Verified by the test passing.

## 2. A vanished working-tree root closes only its own watch

- [x] 2.1 Add `WatchedRootGoneError` and `isWatchedRootGone(error)` to the watcher module. The Linux tree watch raises it from `closeSubtree('')`, and when arming the root fails with `ENOENT` or `ENOTDIR`. Verified by `git-tree-watcher` tests that delete the root after arming, and before arming with an injected `fs` whose root watch throws `ENOENT`.
- [x] 2.2 Native watcher: make `fs.watch` and `lstat` injectable, and record the root's identity at open. On an `error`, an unexpected `close`, or a `rename` that names the root or no file, `lstat` the root:
  - missing (`ENOENT`/`ENOTDIR`) or a different identity: report root-gone;
  - unchanged, after a `rename`: pass the rename on as a change;
  - unchanged, after an `error` or `close`: report the original error;
  - `lstat` fails with any other code: report the original error;
  - the handle was closed before the check settled: report nothing.

  Verified by injected tests for each of those paths, plus intentional close, plus one real-fs test deleting a watched root on the host.
- [x] 2.3 In the service, a `working-tree` watch whose error is root-gone closes that watch only, marks the observation `dirtyAll`, counts a registry change and requests the ramp. Other errors still call `observationFailed`. Verified by tasks 2.4–2.7.
- [x] 2.4 Real-watch test: `git worktree remove` a linked worktree. Without a fresh listing an event arrives, the next ordinary listing omits the worktree, no `watch.failed` is reported, and a later edit in the main worktree still publishes an event. Verified by the test passing, and failing against the unpatched service on Linux.
- [x] 2.5 Real-watch test: `rm -rf` a linked worktree folder. The next ordinary listing shows it as prunable. After `git worktree prune` an event arrives, and the next ordinary listing omits it. Verified the same way as 2.4.
- [x] 2.6 Service test with an injected watcher whose working-tree watch for one root fails at arm time with root-gone. The observation stays available, the other watches stay open, and an unscoped refresh is scheduled. Verified by the test passing.
- [x] 2.7 Real-watch test: delete a linked worktree folder, restore it (same path, same `.git` file) without touching the registry, then request a fresh listing. The worktree is listed with its working tree, and a later edit in it publishes an event without a request. Verified by the test passing.
- [x] 2.8 Add a step to the macOS job in `.gitea/workflows/ci.yml` that runs the real-watch Git test files (2.2's real-fs test, 1.3–1.5, 2.4, 2.5, 2.7) with `node --test --test-force-exit --test-timeout=120000` after building `@terminay/server-core`. Verified by the macOS status on the PR being `success`, with those files in its log. The PR description states that Windows is covered only by 2.2's injected tests.

## 3. Watch readiness

- [x] 3.1 Add `onReady` to `GitWatchOptions`. The native watch reports it on a microtask after `fs.watch` returns. The tree watch reports it once, when discovery first finishes after arming the root; changed entries still being classified don't hold it back. Verified by watcher tests: native is ready after open, a tree watch over a nested tree reports ready only after every kept directory is armed (checked against the injected `fs` watch calls), and a tree watch under sustained writes still becomes ready.
- [x] 3.2 Track per-watch readiness in the service. `observationTrusted` requires every open watch to be ready, and `watchesReady` is a promise that settles when every current watch is ready or the observation becomes unavailable or closed. `listWorktreesFrom` awaits it, together with the caller's signal, before claiming, and waits again if a rebind replaced the observation meanwhile. Verified by tasks 3.3–3.5, and a test that rebinds a project while a listing waits.
- [x] 3.3 Test: bind and list twice with no change. Exactly one `measurement.completed` is reported, with `trusted: true`, and the second listing is served from the cache. Verified by the test's report log.
- [x] 3.4 Test with an injected tree-watch `fs` that holds a subdirectory's arm. Edit a file in that subdirectory while a listing waits, then release the arm. The listing includes the edit. Verified by the test passing.
- [x] 3.5 Test: a ready watch fails afterwards with ENOSPC. The cached listing is dropped, and the next listing is measured. Verified by the test passing.

## 4. Unavailable observation re-arms on request

- [x] 4.1 Add `rearm(observation)`. A non-watch listing request against an unavailable, not closed observation starts it, with at most one in flight. It marks every worktree dirty, so the first measurement under the new watches covers worktrees changed while unwatched, even from a scoped request; a failed attempt restores what was owed. It succeeds only when `watchesReady` settles with every watch ready. A failed attempt returns to unavailable and reports `watch.failed` without publishing an unattributed event. Verified by tasks 4.2–4.3, and a test that re-arms through a scoped request after a sibling changed unwatched.
- [x] 4.2 Rewrite the `git-built-watch-service` test "a host watch refusal makes observation unavailable…" to the new contract. While the watch is refused, listings are measured on demand and no Git runs between requests. After the refusal is lifted, the next listing re-arms, and a later edit publishes an event without a request. Verified by the test passing.
- [x] 4.3 Test with a watcher that always refuses. Each listing makes exactly one re-arm attempt, no timer is armed (manual timers stay empty), no Git runs between requests, and no extra status-change event is published per attempt. Verified by the test passing.

## 5. Mounting reads the cache

- [x] 5.1 Add `'mount'` to `GitPaneSyncTrigger`, with `isFreshGitPaneSync('mount') === false`. Verified by a unit test of `isFreshGitPaneSync` covering every trigger.
- [x] 5.2 Add the pure helper `rootLoadTrigger(previousLoadedRoot, root)`, and use it in the root-load effect with a `lastLoadedRootRef` that changes only when a non-empty root is actually loaded. Verified by a unit test covering:
  - the first load;
  - a dependency-only rerun with the same root;
  - creation becoming ready;
  - a direct root change;
  - a root going empty and then to a different root;
  - a root going empty and then back to the same root.
- [x] 5.3 Update stale comments and tests that call mounting a `'root'` sync, if any exist. Verified by `grep` for `'root'` sync triggers in `src/` and the unit test suite passing.

## 6. Verification

- [x] 6.1 Run `npx turbo run build --filter=@terminay/server-core...`, then the server-core tests with `node --test --test-force-exit --test-timeout=120000`. Verified by them all passing locally.
- [x] 6.2 Run lint, typecheck and the root unit tests. Verified by them passing locally.
- [x] 6.3 Run `openspec validate --all`. Verified by this change validating clean, with failures elsewhere unchanged from main.
- [x] 6.4 Re-measure the attach cost from issue #652 (6 projects, 9 worktrees, 40 s after attach) against a native server built from this branch, plus the first-listing wait after binding. Verified by recording the before and after numbers in the PR description.
