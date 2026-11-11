## 1. Kill deadline

- [x] 1.1 Add `BOT_KILL_DEADLINE_MS = 5 * 60_000` in `engine.ts` and use it for the agent `--kill` in `agentProcess.ts` and both relay `--kill` execs in `runtimeBridge.ts`. Verified by driver-spy tests that close a `BotAgentProcess` and a runtime bridge and assert each `terminay-run --kill` exec receives `deadlineMs: 300000`.
- [x] 1.2 Use the same constant for the startup `terminay-run --kill-all` in `BotService` reconcile. Verified by a `bot-triggers.test.mjs` driver-spy assertion on the reconcile exec options.

## 2. Typed cleanup result

- [x] 2.1 Make `BotAgentProcess.close` reject with a new `BotCleanupError` when ending the agent's process group is not confirmed, and still run `cleanupRuntime` in that case. Verified by a test where the agent `--kill` exec rejects: `close` rejects with `BotCleanupError` and `cleanupRuntime` was called.
- [x] 2.2 Make the runtime bridge's relay close log each relay's kill error (`[terminay] bot relay cleanup failed`) instead of dropping it, and keep it non-throwing. Verified by a test where one relay's kill rejects: the other relay still closes and the error is logged.
- [x] 2.3 In `BotService.closeLive`, when the runner close rejects, still release the runtime, remove the live entry and record the close state, then rethrow. Verified by the stopped and timed-out outcome tests in 4.3.
- [x] 2.4 In `BotService.runNow`'s `finally`, catch `BotCleanupError` around `closeLive`/`live.stop`, run the remaining steps (images, revoke, release, commit, retain), and resolve with `{ cleanup: 'failed', error }`; otherwise resolve `{ cleanup: 'ok' }`. Other errors still reject. Verified by the reproduction test passing and by 4.2's ownership test.

## 3. Queue threshold and failure hook

- [x] 3.1 In `BotTurnQueue`, add per-lane `cleanupFailures`: increment on a `failed` result and block at 3 (failed, stopped, waiting cancelled); reset on `ok` only while not blocked; block at once on rejection; reset on `unblock(botId, true)`. Verified by new `bot-queue.test.mjs` cases: two failures keep admitting; an `ok` resets; three consecutive block and cancel waiting work; an `ok` finishing after the block leaves it blocked; out-of-order completion counts by finish order; `unblock(botId, true)` clears.
- [x] 3.2 Update the existing queue test "cleanup failure blocks admission until reconciliation resets the lane" so a rejecting `run` still blocks at once. Verified by `bot-queue.test.mjs` passing.
- [x] 3.3 Make the queue `failure` hook async and awaited, with its own rejection caught and logged. In `BotService`, the hook redacts the error (fallback "cleanup error unavailable"), appends `Cleanup failed: …` to runner output, commits the session, and logs `[terminay] bot cleanup failed`. At the threshold, it also marks the session failed, cause `engine`, reason "bot blocked after 3 consecutive cleanup failures". Verified by 4.1 and 4.4.

## 4. Service tests (`bot-triggers.test.mjs`)

- [x] 4.1 The reproduction test passes: one failed cleanup leaves the turn completed and the next firing reaches the agent. Extend it to reopen the session store from disk and find the redacted `Cleanup failed:` runner line.
- [x] 4.2 A trigger turn that holds shared-work ownership and then fails cleanup releases it: a later execution can acquire work ownership. Verified by the test passing.
- [x] 4.3 A stopped turn and a timed-out turn whose cleanup fails keep `stopped` and `timed-out`. Verified by the test passing.
- [x] 4.4 Three consecutive failed cleanups: the third session is failed with cause `engine` and the blocking reason, no failure investigation is queued for it, and the fourth firing does not reach the agent. Verified by the test passing.
- [x] 4.5 A failing error message that contains a bot secret is redacted in runner output and in the logged line. Verified by the test passing, with `console.error` captured.
- [x] 4.6 Reconciliation: with a blocked bot, a failing `--kill-all` leaves it blocked, and a succeeding one unblocks it. Verified by the test passing.

- [x] 4.7 Harden the `bot-test-runtime.mjs` kill helper, because relays are now closed after a failed agent kill: tolerate macOS `EPERM` for an exiting group it spawned, tolerate a concurrent removal of the same record, and never signal pid 0 or 1. Add an `execFailure` option, and add `bot-cleanup.test.mjs` (deadlines, failed agent kill, failed relay kill). Verified by `bot-recovery`, `bot-sessions` and `bot-cleanup` passing, and the full parallel bot suite exiting 0.

## 5. Regression

- [x] 5.1 Build with `timeout 600 npx turbo run build --filter=@terminay/server-core...`, then run `timeout 900 node --test --test-force-exit --test-timeout=120000 test/bot-*.test.mjs` in `packages/server-core`. Verified by zero failures.
- [x] 5.2 Run `npx biome check` on the changed files and `openspec validate --all`. Verified by biome passing and no new validation failures, compared with `main`.
