## 1. Instructions

- [x] 1.1 Add the cleanup rule to the execution briefing in `runtime.ts`. Verify: a server-core test asserts the rule names shells, Monitors, wakeups and background subagents for a chat and a check-in execution.

## 2. Native driver

- [x] 2.1 In `native.ts`, enter and leave background-wait, tracking listed tasks (id, type, description, parent) and the follow-up count; arm one injected 5-minute timer that sends the check with a fresh nonce, re-arms, skips while a permission is open, and is cleared on `init`, cancel, failure and close; skip one `init` per check when counting follow-ups; cite the 2026-11-28 owner approval (ticket 680, ADR-0028) where the timer is armed. Verify: `bot-native.test.mjs` with fake timers covers waiting, early wake, open permission, unanswered check, cancel, nothing pending, a notification arriving before and during a check, and work ending by itself after a not-done reply; the citation is in the code.
- [x] 2.2 Accept a done answer and shut down: whole nonce line in a successful result; `stop_task` subagents first and for late tasks; close stdin when the list is empty; keep an earlier recorded error and the background-ceiling report as failures; deny later permission requests and ignore only later result, assistant and approval-stream errors and the exit status; resolve after 30 seconds if the process has not closed. Verify: tests cover done with three task kinds, late task, stale nonce, line in tool output or mid-sentence, errored answering turn, earlier error, ceiling report after done, permission and error after done, non-zero exit after done, grace expiry, and not-done re-asked with a new nonce.
- [x] 2.3 Pass timers through `BotAgentProcess` from service hooks. Verify: server-core builds and the service tests drive the timer.

## 3. Record and service

- [x] 3.1 Add optional `backgroundWait` to `BotSessionRecord` and validate it in `sessions.ts`. Verify: tests round-trip it, accept records without it and reject out-of-bounds values.
- [x] 3.2 In `service.ts`, redact, bound and persist wait snapshots, refresh last activity at most once a minute, append the check to the transcript, record the answer, and mark the wait over when the execution ends. Verify: service tests with the native fixture and the test supervisor cover done → completed with a surviving child and an agent that ignores end of input, the lease released only after the group is confirmed gone and runtime tools revoked, unconfirmed cleanup following the existing rules with the lease held, a user stop racing the done answer → stopped, not done → running and re-asked, a check-in execution, and a redacted description.
- [x] 3.3 Return the diagnostics from `sessions_get` within its size limit. Verify: runtime test reads them for a waiting execution, and with 32 items of escaped and multibyte descriptions gets a successful result within the limit that keeps the summary facts and counts the omitted items.

## 4. Session details

- [x] 4.1 Show the background wait in `BotSessionsPanel.tsx`, live and after the end. Verify: unit test of the summary wording in `botsModel.test.ts`, and the e2e in 5.2.

## 5. Verification

- [x] 5.1 Run server-core, protocol and renderer tests, typecheck, lint and `openspec validate --all`. Verify: tests, typecheck and lint exit 0; this change validates and `--all` reports no failure that `main` does not.
- [x] 5.2 Extend `e2e/bots.spec.ts` to show a held session's details, and capture screenshots. Verify: `npm run test:e2e` passes for that spec.
- [x] 5.3 Run the real pinned Claude Code through the built driver with a shortened interval. Verify: a left-behind Monitor is asked about and the turn resolves as completed.
