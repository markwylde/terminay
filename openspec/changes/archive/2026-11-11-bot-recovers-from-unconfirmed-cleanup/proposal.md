## Why

`bot-cleanup-failure-tolerance` (#546) made a blocked bot much rarer. Each kill
now gets 5 minutes, and a bot blocks only after 3 consecutive cleanup failures.
A blocked bot still has no way back except restarting Terminay, though. Until
then, every trigger firing and every chat message is refused, and Chat says
"The execution could not start. Check sign-in and the container engine". That
sends the user to sign in again when nothing is wrong with sign-in.

This was seen on a Codex bot. One failed cleanup at 15:38 blocked it (before
#546), and every firing and the user's next message were refused for over an
hour while its container ran normally.

## What Changes

- A blocked bot still refuses new work until cleanup is confirmed: confirmed
  process-group cleanup stays mandatory.
- Before admitting a new execution for a blocked bot, the server retries
  ending the process groups of only the executions whose cleanup is
  unconfirmed. When every retry is confirmed, the bot is unblocked and runs the
  new execution. No restart is needed.
- While a retry still fails, a chat message is refused with a reason that
  names the unconfirmed cleanup and the container engine, not sign-in.
- Enabling a blocked bot or saving its profile no longer fails.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminay-bots`: a blocked bot recovers through a retried cleanup, as well
  as through startup reconciliation.

## Impact

- `packages/server-core/src/botService/queue.ts`: the lane remembers which
  sessions have unconfirmed cleanup since the last confirmed one, and lifts the
  block when the last of them is confirmed.
- `packages/server-core/src/botService/service.ts`: retries cleanup before
  dispatch, and gives the specific refusal reason.
- Tests: `packages/server-core/test/bot-cleanup-recovery.test.mjs`.
- No protocol, client, MCP or container image change.
