## 1. Protocol and stored shapes

- [x] 1.1 Add `BotStartupFailure` (`stage`, `temporary`, `code`), `dispatchedAt`, `attempts` (history), `retryLimit`, `retryAt` and `outcome` (`disposition`, `reason`, `action`, `at`) to `BotSessionRecord` in `packages/protocol/src/bots.ts`. Verify: the protocol package builds, and `bot-protocol.test.mjs` round-trips a session with and without the new fields.
- [x] 1.2 Add optional `startupRetries`, `onNeedsHuman` and `blocker` (`id`, `reason`, `action`, `sessionId`, `at`, `notice`) to `BotTrigger`/`BotTriggerDraft`, with validation (retries 0–3, the two enum values) and defaults for absent fields. Verify: a protocol/trigger store test shows that a stored trigger without the fields reads as 3/`pause`/no blocker, and an out-of-range value is refused naming Startup retries.
- [x] 1.3 Add the `trigger.resume` command and the `outcome_report` tool schema (including `revision` and `idempotencyKey`) to the protocol and runtime tool list. Verify: `bot-io-protocol.test.mjs` covers the command, and `BOT_RUNTIME_TOOLS` lists `outcome_report` with its bounded input schema.

## 2. Honest startup errors

- [x] 2.1 Add `startDeadlineMs` to `EngineCallOptions` in `socketDriver.ts`/`engine.ts`. It bounds create/start/attach, and `deadlineMs` starts on `ready`. Verify: a unit test with a fake transport delaying start by 9 s and a 1 s command passes with `startDeadlineMs: 60000, deadlineMs: 10000`, and a command still running past `deadlineMs` after start rejects with `deadline`.
- [x] 2.2 Carry the exit status on `EngineCommandError` (`exitCode`), set by `SocketDriver.collect` from the exec inspect result. Verify: an engine test where a command exits 75 rejects with `exitCode: 75`.
- [x] 2.3 Introduce `BotStartupError` and classify engine deadline, connection reset/premature close, relay not ready/closed, and adapter exit 75/69/1/126/127. Never match message text. Verify: `bot-failure-cause.test.mjs` cases for each code map to the stated stage, temporary flag and code.
- [x] 2.4 Rewrite the `runtimeBridge.ts` startup error handling to throw `BotStartupError` with the real cause, keep adapter stderr, and advise rebuilding only on exit 126/127. Verify: `bot-runtime-bridge.test.mjs` asserts the deadline message names the adapter check and possible overload without rebuild advice, that exit 69 names the problem without rebuild advice, and that exit 127 gives rebuild advice. No socket token appears in any output.
- [x] 2.5 Make `terminay-bot-mcp` exit 75 for timeout/refused/reset/broken pipe/disconnect, and 69 for missing socket, permission denied or capability refused. Verify: `bot-runtime-real.test.mjs` (real container) runs `--check-runtime` against a missing socket (69) and a socket that never answers (75).

## 3. Hand-over marker and retry loop

- [x] 3.1 Patch `dispatchedAt` durably in `service.ts` immediately before `client.prompt`. Verify: a service test with a fake runner shows `dispatchedAt` set before the prompt call is observed, and null for a failure in the bridge.
- [x] 3.2 Run the startup section of `runNow` in a retry loop (stages before agent launch only):
  - end the attempt with confirmed cleanup; if cleanup is unconfirmed, make no retry and write a cleanup-failure record;
  - give each attempt a fresh bridge and runtime token, revoking the previous one;
  - append the runner line and patch `attempts`/`retryAt`;
  - use one jittered timer (10/30/60 s ±20 %);
  - apply the deadline min(first + 5 min, nextDue) and the snapshotted `retryLimit`;
  - write `startupFailure` only as the final failure, and clear it at hand-over.

  Verify: tests with fake timers cover the second attempt succeeding, retries exhausted (4 attempts), retries 0, failure after hand-over not retried, a deadline reached before the delay, unconfirmed cleanup with no retry, a late callback from attempt 1 ignored, each attempt using a fresh token, and a recovered startup followed by an agent failure carrying no `startupFailure`.
- [x] 3.3 Stop and replacement:
  - stopping a waiting execution clears its timer and ends it as stopped;
  - when the trigger comes due, an execution in retry wait or permit wait is ended as "replaced by the next firing", and the new firing proceeds;
  - an execution mid-attempt becomes its final attempt: the new firing is skipped as bot busy if that attempt hands over, and proceeds after it if the attempt fails.

  Verify: tests for stop, retry-wait replacement, permit-wait replacement, mid-attempt success and mid-attempt failure.
- [x] 3.4 Restart: an execution waiting for a retry or a startup slot becomes interrupted on load. Verify: `bot-restart.test.mjs` case.
- [x] 3.5 Add `TriggerService.nextDue(triggerId)`. It returns a time for schedule triggers and for observation sources with a scheduled check, and null for once (already fired), event, disabled and other triggers. Verify: a trigger test for cron, every, command, once and event sources, and a service test that a null nextDue gives a 5-minute deadline.

## 4. Machine-wide startup budget

- [x] 4.1 Add a FIFO `StartupBudget` (2 permits) to `BotService`, acquired at the start of each attempt and released at hand-over, failure, stop or retry wait. Recheck the deadline when a permit is granted, and remove waiters that were stopped, replaced or expired. Runner output says when an execution is waiting. Verify: a test with three bots starting at once shows two in startup and the third starting after a release; a retry wait frees its permit; and a permit granted after the deadline ends that execution without an attempt.

## 5. Failure follow-ups

- [x] 5.1 Update the wake rule in `failureFollowUps.ts` to list its exclusions: temporary startup failures, blocking causes, failures of failure executions, and open trigger episodes. Verify: covered by the 5.2 and 5.3 tests and the existing "Trigger run fails" test.
- [x] 5.2 Skip failure executions only when the execution ended failed with `dispatchedAt === null` and a final `startupFailure.temporary`. Verify: `bot-failure-follow-ups.test.mjs` cases:
  - a temporary exhausted execution accepts nothing;
  - a lasting adapter failure accepts one;
  - temporary attempt history followed by an agent failure accepts one.
- [x] 5.3 Add per-trigger execution episodes (`openEpisodes`) to the follow-up state:
  - the episode is opened in the same `save()` that appends the failure to `pending`;
  - excluded failures neither open nor close an episode;
  - an episode closes on a completed execution, reset, disable, resume or delete;
  - missing state reads as none open.

  Verify: tests for:
  - 10:00/10:05/10:10 failures giving one acceptance;
  - recovery then failure giving a second;
  - a crash injected before and after the single save (never two acceptances, and never an open episode without its failure);
  - Investigate failures off opening nothing;
  - the burst of five failures from different origins still coalescing;
  - chat failures unaffected.

## 6. Outcome reporting and trigger blockers

- [x] 6.1 Implement `outcome_report` in `runtime.ts`:
  - the three dispositions, size bounds, and a required action for needs-human;
  - own-trigger resolution, with a required observed revision for trigger-affecting reports (conflict when stale);
  - per-bot serialization through the `mutations` chain;
  - redaction and the idempotency key;
  - refusal when the execution is revoked or ended;
  - the outcome stored on the session.

  Verify: runtime tool tests for each scenario in bot-execution-resilience and bot-message-log, including a stale revision refused as conflict, another bot's trigger refused as not found, and two concurrent needs-human reports giving one blocker and one post.
- [x] 6.2 Trigger blocker: `needs-human` records the blocker with `notice: 'pending'`, posts with idempotency key `blocker:<id>`, then marks it posted. Pending notices are re-posted at startup. `fixed` and Resume clear the blocker. Verify: tests for the first post, no second post while blocked, a crash after the blocker write (exactly one message after restart), fixed clearing, and the notification raised once.
- [x] 6.3 Pause enforcement:
  - enforce the pause in the firing drain, at queue admission, and when a blocker is recorded (skip that trigger's unstarted queued items with "waiting for you");
  - read `onNeedsHuman` live: Keep running fires, and switching to Keep running unpauses at the next due firing;
  - Run now works and keeps the blocker;
  - no catch-up after Resume;
  - the blocker survives restart.

  Verify: trigger tests for each bot-triggers scenario, including a blocker recorded while a firing is queued and switching a waiting trigger to Keep running.
- [x] 6.4 Trigger tools and editor validation accept and return the new settings, and Startup retries is snapshotted into the execution at creation. Verify: the runtime trigger tool test sets both settings and is refused for 5, and a service test shows an edit from 3 to 0 does not change an execution already retrying.

## 7. Briefing and execution details

- [x] 7.1 Extend briefing `recentFailures` with stage, temporary and attempts, plus the outcome disposition. List triggers waiting for the user with the blocker reason. Add the guidance lines about temporary failures and `outcome_report`, and keep the trim order. Verify: briefing tests for the overloaded-host and waiting-trigger scenarios, and the worst-case budget test still within 8 KiB.
- [x] 7.2 Extend execution list/get results with the startup failure fields and the outcome. Verify: the startup failure detail test, and the failure-origin 8 KiB test still passes.

## 8. Workspace UI

- [x] 8.1 `BotTriggerEditor.tsx`: a Startup retries control (0–3) and When the bot needs you (Pause this trigger / Keep running), each with a plain-words description. Verify: a component test saves both, and the defaults show for a new trigger.
- [x] 8.2 `BotTriggersPanel.tsx`: a Needs you status in the attention tone with reason, action and Resume in the row and sheet. Disabled takes precedence, and Resume is offered while disabled. Verify: component tests for the row, the sheet, and disabled precedence.
- [x] 8.3 Sessions view: show attempts ("Started on attempt 2 of 4" / "Failed after 4 attempts"), a retrying state with its next attempt time, and the reported outcome. Verify: component test.

## 9. Specs, docs and end-to-end

- [x] 9.1 Extend the bots E2E (`e2e/.../bots.spec.ts`) with a trigger shown as Needs you (the fake agent reports `needs-human` through `outcome_report`), one chat post, Resume, and the new editor settings. Capture screenshots of the Needs you row, the editor banner and the editor settings; the session with retry attempts is captured by the bots UI harness. Verify: `npm run test:e2e` passes for the bots shard, and the screenshots are saved in the scratchpad.
- [x] 9.2 Run `openspec validate --all` and the server-core bot test suites with the bounded `node --test --test-force-exit --test-timeout=120000` flags. Verify: `bot-failure-resilience` validates, `--all` reports no failures beyond those already present on `main`, and the bot suites pass.
