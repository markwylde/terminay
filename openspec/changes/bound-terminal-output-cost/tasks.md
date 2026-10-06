## 1. Reproduce and baseline

- [x] 1.1 Reproduce the report with a deterministic repaint workload against
  the production composition and attribute the cost by ablation. Verified by
  the figures in `openspec/adr/evidence/terminal-output-main-process-cost.md`
  (32.4% main CPU and 41.7 `ps`/s as shipped; 2.7% and 0.7 with the three
  defects off).
- [x] 1.2 Add failing regression tests for each defect, each beside a passing
  guard for the behaviour that must survive. Verified by running them at
  `85e53368`: `terminal-replay-cost` (1 fail, 1 pass),
  `session-holder-foreground-rate` (1 fail), `node-pty-adapter` (1 new fail,
  1 new pass, 13 existing pass), `server-terminal-authority-output-cost`
  (1 fail, 2 pass).

## 2. Bounded chunk queue

- [x] 2.1 Add the bounded chunk queue to
  `packages/server-core/src/terminalService/`: running byte total, head-index
  eviction with amortised compaction, iteration over the live range, and a
  tail read that returns exactly the last N bytes. Verified by a unit test
  covering push, both eviction rules, compaction across the threshold, an
  empty queue, and a tail read that trims the oldest surviving chunk.
- [x] 2.2 Export it from `server-core`'s index for `electron/`. Verified by
  `npm run check:boundaries` and `npm run typecheck:workspaces`.

## 3. Terminal service replay

- [x] 3.1 Hold `MutableSession.replay` in the queue and replace the
  `replayBytes` re-sum and `Array.shift()` in `appendOutput` with the queue's
  eviction, keeping whole-chunk eviction and `replayFrom` exactly as they are.
  Verified by `terminal-replay-cost.test.mjs` passing both cases.
- [x] 3.2 Move every other reader and writer of `mutable.replay` to the queue
  (subscription replay, `readReplayBytes`, adopted-session seeding, the
  retained-bytes check near `service.ts:1133`) and delete `replayBytes`.
  Verified by `terminal-service`, `terminal-output-read`,
  `terminal-congestion-recovery`, `terminal-hydration-loop`,
  `terminal-multi-client-streaming`, `terminal-adopted-presentation` and the
  `session-holder-*` suites passing unmodified.

## 4. Authority recent output

- [x] 4.1 Replace `ServerTerminalAuthority.buffers`' per-session `Uint8Array`
  with the queue under the cover-the-bound eviction rule, so `handleEvent`
  only pushes. Keep the buffer's lifecycle: seeded before creation, deleted
  only where it is deleted today, kept after exit. Verified by the cost case
  in `scripts/server-terminal-authority-output-cost.test.mjs` passing.
- [x] 4.2 Route `getBuffer`, `aiReplay` and `generateAiMetadata` through one
  tail read. Verified by the exact-tail and empty/unknown cases in the same
  file, and by `scripts/server-terminal-authority-host-bookkeeping.test.mjs`
  passing unmodified.

## 5. Foreground sampling behind the shared ramp

- [x] 5.1 Give `createForegroundObserver` a `noteOutput()` backed by its own
  `createRampSchedule` whose run is the existing `requestSample()`, disposed
  with the observer, with the ramp's clock and timer injectable through
  `NodePtyForegroundPollingOptions`. Leave `poll`, `observeFresh`, the
  in-flight/pending coalescing and the 1500 ms interval as they are. Verified
  by a test with an injected clock: first output samples synchronously, output
  inside an interval yields exactly one sample at its end, and a quiet period
  resets to the floor.
- [x] 5.2 Call `noteOutput()` in place of `void foreground.poll()` in
  `nodePty.ts` and `sessionHolder/factory.ts`, and update the comment at
  `nodePty.ts:141` to say what output now does. Verified by both new rate
  tests passing, and by `node-pty refreshes foreground activity when output
  advances while timer delivery is starved` and `node-pty coalesces continuous
  output into one in-flight sample and one pending sample` passing unmodified.
- [x] 5.3 Confirm close protection is not behind the ramp. Verified by
  `node-pty close observation is not delayed by output pacing`,
  `terminal-close-observation-isolation.test.mjs`, and
  `npm run test:close-protection`.
- [x] 5.4 If `check:boundaries` rejects `terminalService/` importing
  `activity/rampSchedule`, move the ramp to a neutral module in `server-core`
  and import it from both places. Verified by `npm run check:boundaries`
  passing and `ramp-schedule.test.mjs` passing against the single
  implementation. Not needed: `check:boundaries` accepts the
  import, so the ramp stays where it is.

## 6. Close preflight reaches the server

- [x] 6a.1 Find why two end-to-end close-warning tests failed on the first
  version of this change. Verified by a probe that sends
  `activity.closePreflight` through a real client and fails in `encodeFrame`
  with `invalid operation`, before anything is written to the transport.
- [x] 6a.2 Rename the operation to `activity.close-preflight` in
  `packages/client-core/src/activityClient.ts`,
  `packages/server-core/src/activity/protocol.ts` and
  `packages/server-core/src/automationSpaceVisibility.ts`, and in the tests
  that name it. Verified by
  `packages/server-core/test/activity-close-preflight-wire.test.mjs`: a real
  `ActivityClient` over a real connection, with a stale committed projection,
  causes exactly one fresh PTY observation and reports the session running.
- [x] 6a.3 Assert that every activity operation name encodes on the wire and
  that client and server agree on the names. Verified by the first case in the
  same file.
- [x] 6a.4 Confirm both end-to-end close-warning tests pass. Verified by
  `npm run test:e2e -- e2e/workspace.spec.ts` and by the pull request's E2E
  shards.

## 7. Prove it

- [x] 6.1 Re-run the evidence harness on the fixed build and append the
  figures to the evidence file. Verified by main CPU at or below ~4% and `ps`
  at or below ~2/s under the same workload, with chunks per second not lower
  than the baseline.
- [x] 6.2 Add `scripts/server-terminal-authority-output-cost.test.mjs` to `smoke`,
  after `build:app`, so it gates pull requests. The rest of
  `test:server-terminal-runtime` is not wired in:
  `scripts/task9-embedded-agent-authority.test.mjs` has two source-pattern
  assertions against `electron/main.ts` that already fail on `main` and are
  unrelated to this change. Verified by the test path appearing in the `smoke`
  script and passing when run.
- [ ] 6.3 Run `npm run lint`, `npm run typecheck:workspaces`,
  `npm run test:workspaces`, and `npm run test:e2e`. Verified by all passing.
- [x] 6.4 `openspec validate --all`. Verified by a clean result.
- [ ] 6.5 Open the pull request on `origin` with `tea` and read back every
  commit status on the head SHA. Verified by each being `success` or `skipped`.
