## 1. Remove turn limits

- [x] 1.1 Remove `maxTurnMs` from the protocol profile and snapshot, the store default and validation, and session parsing, keeping stored records loadable. Verify with `bot-store` and `bot-session-store` tests that load records holding the old field.
- [x] 1.2 Remove the service turn timer, the `timeout` close reason path and the native-client turn timer. Verify with a fake-clock `bot-runtime` test that a turn outlives 30 minutes and several hours.
- [x] 1.3 Set `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` in the Claude bot contribution only. Verify with a test asserting Claude's launch environment has it and Codex's does not, and a `BotAgentProcess` test asserting the value reaches the spawned command's environment.
- [x] 1.4 Verify the native client lifecycle with a controlled agent stream: a `result`, a long quiet period with input closed, then a second `result` and exit 0 complete the turn. Verify in `bot-process` tests.
- [x] 1.5 Keep unanswered permission requests open until the turn ends. Verify with tests that Stop and an agent crash each reject an unanswered request.
- [x] 1.6 Remove the Maximum turn field and validation from `BotProfilePanel.tsx`. Verify with `botsModel`/`bots-ui` tests and the E2E profile screenshot.

## 2. Interrupted sessions

- [x] 2.1 Detect the full Claude background-stop stderr line across chunk boundaries and reject the turn on exit 0. Verify with `bot-process` tests, including split chunks and imitation on stdout.
- [x] 2.2 Record the execution as failed with a fixed reason, and run normal failure follow-up. Verify with a `bot-failure-records` test.
- [x] 2.3 Post exactly one idempotent chat notice whenever that failure is recorded. Verify with tests for Investigate failures on and off, an open trigger episode, and failure and check-in origins.

## 3. Check-ins

- [x] 3.1 Add the `check-in` session origin to protocol, session parsing, runtime summaries and failure-follow-up exclusion. Verify with session-store and follow-up tests.
- [x] 3.2 Add the `BotCheckIns` scheduler and exact prompt, with an ADR-0028 citation at the timer. Verify with fake-clock tests for 15/30/45-minute marks, real ID and duration, hand-over-based timing, and a late timer (37 minutes, next mark 45).
- [x] 3.3 Enforce no recursion, no overlap, skipped marks, needs-you skip, full-queue skip, and cancellation when the watched session ends. Verify with one scheduler test per rule.
- [x] 3.4 Add the dedicated per-bot check-in slot to the queue. Verify with `bot-queue` tests that a check-in runs with all other slots full, and that a stuck check-in does not block a user message.
- [x] 3.5 Re-check the watched execution before a queued check-in runs, and refuse `sessions_stop` and `sessions_replace` from a check-in against a `needs-you` watched execution. Verify with service and runtime tests for both transitions.
- [x] 3.6 Rebuild schedules on reconcile for running executions only. Verify with a restart test showing an interrupted execution gets no check-in.

## 4. Inspecting a running session

- [x] 4.1 Let `sessions_output` read started, non-ended executions, returning the latest slice, `lastActivityAt` and at most 10 kind-and-status entries. Verify with fixtures showing commands, titles, plan text, tool input, tool output and message text are absent, that the response stays within budget, and that another bot's execution is refused.
- [x] 4.2 Refuse a cursor on a non-ended execution. Verify with a runtime test covering a capped-tail output and the transition to ended.
- [x] 4.3 Update the tool description and keep `bots_sessions_output` ended-only. Verify with `bot-inspect` tests.

## 5. Workspace UI

- [x] 5.1 Add check-in labels, chip, title, watched-session detail and origin filter. Verify with `botsModel` tests.
- [x] 5.2 Show the stopped-background reason on the failed session. Verify with a `bots-ui` test.

## 6. Verification

- [x] 6.1 Run package builds, typecheck, Biome and affected unit suites with bounded `node --test` flags. Verify all pass.
- [x] 6.2 Extend `e2e/bots.spec.ts` for the profile without Maximum turn, cover the check-in session view in the `bots-ui` browser harness (a real 15-minute mark is covered by fake-clock tests), capture screenshots, and run `npm run test:e2e`. Verify the suite passes and screenshots exist.
- [x] 6.3 Run `openspec validate --all`. Verify this change has no errors and no new failures appear.
