## Context

`BotTurnQueue.dispatch` runs each execution through `BotService.runNow`. Its
`finally` block closes the agent, which runs `terminay-run --kill <sid>` in the
container. If that engine call rejects, `runNow` rejects. The queue then sets
`lane.failed` and `lane.stopped`, and the service marks the session failed with
"session cleanup failed; bot remains blocked". `unblock(botId)` throws while
`lane.failed` is set. Only `reconcile()` at server start passes `reset`, after
`terminay-run --kill-all`.

`postUserMessage` catches every dispatch error with a bare `catch {}` and shows
the sign-in message for every bot that has a sign-in method. The queue's
`.catch(() => …)` drops the error.

`terminay-run --kill <sid>` is idempotent. A missing record returns 0, and a
live group is signalled only when its leader or nonce matches.

## Goals / Non-Goals

**Goals:**

- A transient engine failure during cleanup does not leave a bot refusing work
  until restart.
- Cleanup stays confirmed before new work starts.
- The user and the diagnostics see the real cause.

**Non-Goals:**

- Retrying on a timer. Retrying when work is requested is enough, and it adds
  no poll (ADR-0028).
- Changing `terminay-run` or the container image.

## Decisions

### D1. Retry only the failed sessions, before dispatch

The lane keeps a set of session ids whose run rejected. `send` calls
`retryCleanup(botId)` before `queue.unblock`. For each id, it closes the live
runner again if one exists. `BotAgentProcess.close` clears its memoised
promise on rejection and has not yet marked itself unspawned, so a second close
reruns the kill, runtime cleanup and credential release. With no live runner,
it runs `terminay-run --kill <sid>` directly. Each confirmed id is removed, and
an empty set clears `failed`.

`--kill-all` is not used. Other executions may be running in the same
container, and ending them would be wrong.

Alternative rejected: clear the latch on enable/disable. That would admit new
work without confirming cleanup, which ADR-0092 and ADR-0096 forbid.

### D2. A specific refusal reason

When the retry fails, `retryCleanup` throws a `BotBlockedError('engine', …)`
with a fixed message. `postUserMessage` shows that message instead of the
generic one. Every other failure keeps its current wording.

### D3. Keep the engine's error

The queue passes the rejection to the `failure` hook. The service redacts it
and appends it to the session's runner output, with a note that the bot will
retry. A confirmed retry appends "Session cleanup confirmed on retry."

### D4. Enable and save do not throw

`enableBot` and `save` unblock the lane only when it is not blocked. The next
`send` retries the cleanup and unblocks it then.

## Risks / Trade-offs

- A retry runs inside the bot's mutation lock and can take up to the kill
  deadline (20 s) when the engine is slow. That is the same bound as a normal
  close.
- If the server restarts while blocked, the in-memory set is lost. Startup
  reconcile already runs `--kill-all` and resets the lane, so nothing is missed.
