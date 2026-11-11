## Context

After `bot-cleanup-failure-tolerance`, `BotTurnQueue` counts consecutive
cleanup failures per bot. On the third, or on any other failure while finishing
an execution, it sets `lane.failed` and `lane.stopped`. `unblock(botId)` throws
"Bot cleanup must be reconciled" while `lane.failed` is set. Only `reconcile()`
at server start passes `reset`, after `terminay-run --kill-all`.

`postUserMessage` catches every dispatch error with a bare `catch {}`. For every
bot that has a sign-in method, it shows the sign-in message.

`terminay-run --kill <sid>` is idempotent. A missing record returns 0, and a
live group is signalled only when its leader or nonce matches. `closeLive`
always drops the live runner, even when its kill failed, so a retry is a direct
exec.

## Goals / Non-Goals

**Goals:**

- A blocked bot recovers without a restart once the engine can confirm
  cleanup.
- Cleanup stays confirmed before new work starts.
- The user sees the real cause.

**Non-Goals:**

- Retrying on a timer. Retrying when work is requested is enough, and it adds
  no poll (ADR-0028).
- Changing the threshold, deadlines or `terminay-run`.

## Decisions

### D1. Track unconfirmed sessions alongside the count

The lane keeps a set of session ids whose cleanup failed, or whose run
rejected, since the last confirmed cleanup. The set is cleared whenever the
count resets, so it stays bounded by the threshold plus the executions running
when the bot blocked.

### D2. Retry only those sessions, before dispatch

When the bot is blocked, `send` calls `retryCleanup(botId)` before
`queue.unblock`. It runs `terminay-run --kill <sid>` with `BOT_KILL_DEADLINE_MS`
for each tracked session. Each confirmed id is removed, and an empty set clears
`failed` and the count. `--kill-all` is not used, because other executions may
be running in the same container.

Alternative rejected: clear the block on enable/disable. That would admit new
work without confirming cleanup, which ADR-0092 and ADR-0096 forbid.

### D3. A specific refusal reason

When a retry fails, `retryCleanup` throws a `BotBlockedError('engine', …)`
with a fixed message. `postUserMessage` shows that message. Every other
failure keeps its current wording.

### D4. Enable and save do not throw

`enableBot` and `save` unblock the lane only when it is not blocked. The next
`send` retries the cleanup.

## Risks / Trade-offs

- A retry runs inside the bot's mutation lock and can take up to the kill
  deadline per session when the engine is slow. Only a blocked bot pays this.
- The tracked set is in memory. After a restart, startup reconciliation runs
  `--kill-all` and resets the lane, so nothing is missed.
