## Why

A bot that monitors work through a trigger can stop doing so after one slow cleanup. On 2026-11-11 a bot's two-minute monitor trigger finished a turn normally. Then the step that ends the session's processes did not answer within 20 seconds, because the Podman machine took 45 seconds to create and start that one exec. Terminay marked the turn failed, blocked the bot's queue, and refused every later firing ("Bot cleanup must be reconciled") and every chat message until the server restarted. The thrown error was discarded, so nothing on disk said why.

## What Changes

- Each engine request that ends a session's process group (the `terminay-run --kill` and `--kill-all` execs) may take up to 5 minutes before Terminay treats it as failed, instead of 20 or 30 seconds.
- A cleanup failure means the agent's process group was not confirmed ended. Relay kill failures are logged but don't count.
- A cleanup failure no longer blocks the bot on its own. The bot is blocked only after 3 consecutive finished executions fail cleanup. An execution with confirmed cleanup resets the count.
- After a cleanup failure, the execution's capability is still revoked, its shared desktop/shell ownership is released, and its record is committed. Today the release and the commit are skipped.
- A turn keeps its recorded outcome (completed, stopped, timed out) when its cleanup fails. The redacted cleanup error is added to its runner output and logged to the server diagnostics.
- When the third consecutive failure blocks the bot, that execution is marked failed with cause `engine` and a reason saying the bot is blocked after repeated cleanup failures. Startup reconciliation unblocks it once it confirms every session process group is gone.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminay-bots`: "Stopping a turn and closing an agent" gains the cleanup deadline, the consecutive-failure threshold that blocks a bot, and the rule that a cleanup failure does not rewrite a finished turn.

## Impact

- `packages/server-core/src/botService/queue.ts`: per-bot consecutive cleanup-failure count and blocking threshold; error passed to the failure hook.
- `packages/server-core/src/botService/service.ts`: failure hook keeps the turn outcome, appends runner output, logs; reconcile `--kill-all` deadline.
- `packages/server-core/src/botService/engine.ts`, `agentProcess.ts`, `runtimeBridge.ts`: shared 5-minute kill deadline.
- Tests in `packages/server-core/test/bot-triggers.test.mjs` and `bot-queue.test.mjs`.
- No protocol, UI, or persisted-format change.
