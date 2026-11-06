## 1. Stop the D-Bus leak (container)

- [x] 1.1 In `docker/terminay-bot/bin/terminay-desktop-session`, once inside `dbus-run-session`, atomically write `$DBUS_SESSION_BUS_ADDRESS` to `/run/terminay/desktop-bus` (mode 0644) and remove the file on exit. Verify with a new `docker/terminay-bot/test_desktop_bus.py` case: the file holds the running bus's address and is removed after exit.
- [x] 1.2 In `docker/terminay-bot/bin/terminay-run`, always set `DBUS_SESSION_BUS_ADDRESS`, overriding any inherited value: use the file's address when its `unix:path=` socket exists, and `disabled:` otherwise. Verify with `test_desktop_bus.py` cases for a present bus, a missing file, a stale socket, and caller values of empty, `autolaunch:` and a stale path.
- [x] 1.3 Add a regression case to `test_desktop_bus.py` that opens the session bus 20 times under `terminay-run` with `DISPLAY` set and asserts that the `dbus-daemon` count does not grow. Wire it into `scripts/run-bot-mcp-real-tests.mjs` beside `test_desktop_control.py`. Verify by running `python3 -m unittest docker/terminay-bot/test_desktop_bus.py` and the real-test script against a built image, and confirm the case fails without 1.2.

## 2. Structured failure cause and process-exhaustion reason

- [x] 2.1 Add `BotFailureCause` and an optional `cause` to `BotSessionRecord`, `BotTriggerFiring` and `BotSourceHealth`, and an optional persisted `failureEpisode` to the trigger checkpoint. Accept these fields when loading. Verify with `bot-protocol.test.mjs`, `bot-session-store.test.mjs` and `bot-sources.test.mjs`: old files load with no cause and no episode.
- [x] 2.2 Set `cause` where `runNow` chooses `failureReason` (engine, agent, image, disabled), where a firing cannot start, and in the source runner's error path (an engine `EngineCommandError` gives engine; a disabled bot gives disabled). Verify with `bot-sessions.test.mjs`, `bot-triggers.test.mjs` and `bot-sources.test.mjs`, one case per cause.
- [x] 2.3 Add an `EAGAIN` classifier (`spawn … EAGAIN`, `fork: Resource temporarily unavailable`, `pthread_create: Resource temporarily unavailable`, engine exec-start `EAGAIN`). Verify with unit tests for each wording and a non-match.
- [x] 2.4 Extend the `socketDriver` stats call with `pids_stats.current` and `pids_stats.limit`. Verify with `bot-engine.test.mjs` cases where they are present and missing.
- [x] 2.5 Wire the classifier and stats into the native-agent failure path, the `runNow` catch, the source runner and exec-start failures, applying D2's precedence: the cause is `processes` only when the limit is known and the count is within 16 of it, and otherwise the neutral reason with no cause. Verify with integration tests through each of the four paths, covering at-limit, below-limit and stats-error.

## 3. Runtime visibility

- [x] 3.1 Change `summary()` to a compact origin and add `reason` (up to 256 B) and `cause`. Make `sessions_get` add `reason` (up to 1 KiB) and the failures, trimmed to 8 KiB with `failuresOmitted`. Verify with `bot-runtime.test.mjs`: a failed sibling's reason is returned, and 25 failure-origin rows of worst-case multibyte reasons page within 8 KiB per page.
- [x] 3.2 Add `sliceTextBackward` to `messages.ts` and the `sessions_output` tool (ended executions only, slices of at most 6 KiB, tail first, bot-scoped through `target()`). Verify with `bot-runtime.test.mjs` and `bot-messages.test.mjs`: tail read, continuation to the start, UTF-8 boundaries, conflict for a running target, a forged or other-bot cursor refused, and another bot's session refused without revealing it exists.
- [x] 3.3 Add `recentFailures` and `unhealthyTriggers` to `briefing()`, with the ordered trim (messages, then triggers, then failures, then executions). Verify with `bot-runtime.test.mjs`: bounds and trim order hold with 10 and 10 worst-case entries.

## 4. Failure follow-up dispatcher

- [x] 4.1 Add the `failure` origin, `BotFailureRef` and `investigateFailures?: boolean` (a missing value reads as true) to the protocol and bot store. Verify with `bot-store.test.mjs`: the default is on, an explicit value round-trips and a non-boolean is refused.
- [x] 4.2 Create `failureFollowUps.ts` with per-bot rebuildable state (`pending` of at most 20, `overflow`, `dispatching`) under `bots/failure-follow-ups/`. Derive the active execution and the starts from failure-origin sessions. Verify with a new `bot-failure-follow-ups.test.mjs`: state reloads, a missing file is empty, and a corrupt file is set aside and treated as empty.
- [x] 4.3 Emit events from `sessions.patch` into failed or timed-out, from condition-episode starts (the `failureEpisode` flag, cleared only by success, reset, disable or delete), and once from the firing-start catch. Verify with `bot-triggers.test.mjs`: `failed → checking → failed` gives one event, a restart mid-episode gives none, recovery followed by failure gives a new one, and a firing-start failure gives exactly one.
- [x] 4.4 Apply the filters: setting off, failure origin, any `cause` (including on health), and a firing that has a session. Verify with one test per filter, including a condition check with cause `processes`.
- [x] 4.5 Redact `reason` and `triggerName` through a fresh credential lease when a failure is accepted, cut to 1 KiB, before anything is persisted. Verify with a test that rotates the credential before dispatch and checks the prompt, the origin and `sessions_get`.
- [x] 4.6 Implement the crash-safe dispatch order (write `dispatching`, call `dispatchExecution` with the reserved id, clear) and reconcile. Return failures to the front of `pending` when dispatch throws. Verify with tests that simulate a crash after each step and see exactly one execution, and a full-queue rejection that later drains.
- [x] 4.7 Implement the drain checks, coalescing, overflow and the deadline timer (set, re-armed on reconcile, cleared on shutdown). Verify with fake-clock tests: a burst of 5 gives 1 then 1 more; 30 failures give 20 listed and 10 overflow; the hourly cap holds; the timer fires once; no interval timers exist; concurrent arrivals never start two executions.
- [x] 4.8 On a profile save with the setting off, a bot disable or a bot delete, clear `pending` and the timer. On delete, remove the state file. Verify with tests: failures waiting behind the cap never start after the setting is turned off, and the file is gone after delete.
- [x] 4.9 Build the prompt from the fixed template (refs, overflow, untrusted notice, tool names, no runner output). Verify with a snapshot test.

## 5. UI

- [x] 5.1 Add the **Investigate failures** switch to `BotProfilePanel.tsx`. Verify with `botsModel.test.ts` (default-on mapping) and a `packages/client-core/test/bots.test.mjs` case that saves `false`, reloads and still reads `false`.
- [x] 5.2 In `BotSessionsPanel.tsx`, add the Failure origin filter, the "Investigate failure" label and the detail failure links. Verify with `botsModel.test.ts` for the filter and label mapping.
- [x] 5.3 Extend `e2e/bots.spec.ts` with a stubbed failure session and the profile switch, and capture screenshots. Verify with `npm run test:e2e -- e2e/bots.spec.ts`.

## 6. Checks, verification and spec sync

- [x] 6.1 Run the app typecheck (`npx tsc -p tsconfig.json --noEmit`; there is no `typecheck` script), `npm run lint` and the server-core and client-core test suites. Verify that all pass.
- [x] 6.2 Run `openspec validate bot-failure-awareness --strict`, then `openspec validate --all`, and confirm that the only failures are the four already on `main` (`linked-folders`, `one-window-one-server`, `outbound-bot-triggers`, `server-notification-manager`). Verify from the command output.
- [x] 6.3 Run `/opsx:verify` for this change and fix every gap. Verify that its report is clean.
- [x] 6.4 Archive the change so its deltas fold into `openspec/specs/`, then run `openspec validate --all --archived`. Verify that the main specs contain the new requirements and that the archive validation introduces no new errors.
