## 1. Classify source runs that end without a result

- [x] 1.1 In `packages/server-core/src/botService/sourceRunner.ts`, record the stream's `exit` code, whether the deadline timer fired, and any stream error. Fold them into one outcome after the read loop, with the precedence cancelled → deadline → exit 126/127 → interrupted. Cleanup failure must not replace the primary error, and is recorded as `cleaned`. Verify: `packages/server-core/test/bot-sources.test.mjs` uses a fake `execStream` to cover exit 127, exit 126, unknown exit, a stream `error` event, a deadline kill (test window naming 10 s), an abort, and a failed cleanup (`cleaned: false`).
- [x] 1.2 Keep a 4 KiB stderr tail while reading, drop the partial first line after overflow, and attach `{exitCode, stderr}` diagnostics to the error, outside `message`. Verify: a test writing several MiB of stderr, including multibyte characters, sees a bounded tail and no leading fragment.

## 2. Redacted reasons in trigger health

- [x] 2.1 In `packages/server-core/src/botService/triggers.ts`, build the health error from the message, `exit N` or `exit unknown`, and the stderr tail. Redact the tail with `service.redactMessage` before it is stored in health or passed to failure follow-ups, cut it to its last 1 KiB, and omit it if redaction throws. Verify: a test puts a bot secret in stderr and asserts that the stored health error and the follow-up reason contain `[redacted]`.
- [x] 2.2 Keep `classified()` mapping process-limit failures to the `processes` cause. Verify: the existing process-limit tests still pass, and a no-result run with process-limit stats keeps the cause and does not retry.

## 3. Retry an interrupted polled check once

- [x] 3.1 In `launch`, for a non-test command or HTTP check whose run throws `interrupted` with `cleaned: true`, set health to `retrying` with the reason and `nextRetry`, wait an abortable `sourceRetryDelayMs` (injectable, default 5000), and run once more under the same worker entry. Verify: tests cover command and HTTP checks that are interrupted and then return a result (health ends healthy, observation accepted), and a check interrupted twice (failed with the second reason).
- [x] 3.2 Do not retry tests, deadline errors, `cleaned: false`, missing-worker errors or ordinary failures, and leave continuous-source reconnect unchanged. Verify: tests assert a single run for each of these, plus the existing continuous-source tests passing.
- [x] 3.3 Confirm that disable, edit, delete, bot disable and server stop during the delay cancel the retry, and that a scheduled check falling due during the delay does not start alongside it. Verify: tests for disable, delete and bot disable during the delay assert no second run, and a test advancing the schedule past a due tick during the delay asserts no overlapping run.

## 4. Failure follow-up behaviour

- [x] 4.1 Add tests in `packages/server-core/test/bot-triggers.test.mjs` with Investigate failures on: an interruption that recovers starts no investigation; an interruption whose retry is also interrupted starts exactly one, naming the trigger and the interruption reason; and in an episode that is already open, the episode stays open through retrying and ends on success. Verify: the server-core test script passes.

## 5. Validation

- [x] 5.1 Run the server-core build and unit tests, `npx biome check` on the changed files, and `openspec validate bot-source-interruptions-do-not-wake`. Run `openspec validate --all` and report any failures that already exist on main separately. Verify: the change validates and every new or changed test passes.
