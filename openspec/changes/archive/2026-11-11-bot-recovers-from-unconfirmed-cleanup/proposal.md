## Why

A bot can stop answering until Terminay restarts. When an execution ends, the
server asks the container engine to end its process group. If that one engine
request fails (a dropped socket, a busy engine), the execution is marked
"session cleanup failed; bot remains blocked" and the bot's lane is latched
shut. Nothing but the startup reconcile clears the latch. From then on every
trigger firing and every chat message is refused, and Chat shows "The
execution could not start. Check sign-in and the container engine", which
sends the user to sign in again when nothing is wrong with sign-in. The
engine's own error is thrown away, so neither the user nor the diagnostics log
can tell what happened.

This was seen on a Codex bot whose two-minute monitor trigger failed its
cleanup once at 15:38. Every firing after that, and the user's next message,
was refused for over an hour while the bot's container ran normally.

## What Changes

- The bot still refuses new work while an execution's cleanup is unconfirmed:
  confirmed process-group cleanup stays mandatory.
- Before each new execution, the server retries the cleanup of only the
  executions whose cleanup failed. When the retry is confirmed, the bot runs
  the new execution. No restart is needed.
- While the retry still fails, a chat message is refused with a reason that
  names the unconfirmed cleanup and the container engine, not sign-in.
- The engine's error is written to the failed execution's runner output.
- Enabling a bot or saving its profile no longer fails while a cleanup is
  unconfirmed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminay-bots`: closing an agent says what happens when the engine cannot
  confirm cleanup.

## Impact

- `packages/server-core/src/botService/queue.ts`: the lane remembers which
  sessions failed cleanup and lifts the block when the last one is confirmed.
- `packages/server-core/src/botService/service.ts`: retries cleanup before
  dispatch, records the engine error, and gives the specific refusal reason.
- Tests: `packages/server-core/test/bot-cleanup-recovery.test.mjs`, and a
  `killFailures` option in the bot test runtime fixture.
- No protocol, client, MCP or container image change.
