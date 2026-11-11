## Context

Each bot execution runs its agent and its runtime relays (`terminay_bot`, and `terminay` when MCP access is on) under `terminay-run` supervisors in the bot container. When the turn ends, `BotService.runNow` closes them in its `finally` block: `BotAgentProcess.close` runs `terminay-run --kill <session>` through an engine exec, then `cleanupRuntime` closes the relays with their own `--kill` execs.

Every one of those execs had a 20-second deadline. On a busy Podman machine, creating and starting one exec took 45 seconds (Podman's API log: create 15:38:42→15:38:58, start attached 15:39:21, exited 15:39:27). The deadline fired, `endProcess` rejected, `cleanupRuntime` was skipped (so both relays leaked), and the rejection left `runNow`.

`BotTurnQueue.dispatch` catches any rejection from `run`. Its `.catch(() => …)` discards the error, sets `lane.failed = lane.stopped = true`, and calls the `failure` hook, which overwrites the session to `failed` / "session cleanup failed; bot remains blocked" / cause `engine`. From then on `unblock` throws "Bot cleanup must be reconciled", so `send` refuses chat messages and trigger firings until server startup reconciliation calls `unblock(botId, true)` after `terminay-run --kill-all`.

The reproduction test "an engine error while ending a completed trigger turn does not block later firings" in `packages/server-core/test/bot-triggers.test.mjs` shows this with a fake process whose close throws once.

## Goals / Non-Goals

**Goals:**

- A slow engine doesn't count as a cleanup failure.
- One cleanup failure doesn't stop a bot. Repeated ones still do.
- The recorded outcome of a turn reflects what the agent did, not what happened during cleanup.
- A failed cleanup still frees what the next execution needs: capability revoked, shared-work ownership released, record committed.
- Every cleanup failure is diagnosable from logs and runner output.

**Non-Goals:**

- Retrying a failed kill, or reaping a previous execution's leftovers before the next one starts.
- Making the threshold or deadline user-configurable.
- Changing why the Podman machine is slow, or how often Terminay calls it.
- Changing the credential-lease rule in `BotAgentProcess`: a lease is released only when the supervisor confirms its group is empty.

## Decisions

### A 5-minute deadline for every process-group kill exec

`BOT_KILL_DEADLINE_MS = 5 * 60_000` in `engine.ts` is used by the agent's `--kill` (`agentProcess.ts`), both relays' `--kill` (`runtimeBridge.ts`), and the startup `--kill-all` in `service.ts` reconcile, which today has 30 seconds. The limit is per request: closing an agent and then its relays is sequential, so in the worst case a close takes several of these. A kill that the engine eventually runs is far better than a blocked bot. Five minutes is well above the 45 seconds observed and still ends a truly hung exec.

*Alternative:* retry the kill on deadline. Rejected: the first exec usually still runs, so a retry only queues more work on an already slow engine.

*Boundary:* the container engine boundary. The exec still runs as root inside the bot's own container and only on that session's supervisor record. Nothing about authority changes.

### A cleanup failure is a typed result of closing the agent

Only one thing counts: `BotAgentProcess.close` failing to confirm that the agent's process group is gone. That close rejects with a new `BotCleanupError` (cause kept). `BotService.runNow`'s `finally` catches it around `closeLive`. Then it still runs the remaining steps (remove images, `runtime.revoke`, `runtime.release`, `sessions.commit`, `sessions.retain`), and finally resolves `run` with `{ cleanup: 'failed', error }` instead of rejecting. A run that closes cleanly resolves with `{ cleanup: 'ok' }`.

Relay shutdown stays best-effort: `cleanupRuntime` runs even when the agent kill fails, and each relay's kill error is logged instead of being dropped. A leaked relay can't act, because the execution's capability is revoked server-side (`runtime.revoke`) before the relays close. That keeps ADR-0100/0102's guarantee that turning off access, or ending the execution, revokes reach at once.

Any other rejection from `run` (for example a session-store failure) means the server's own bookkeeping broke. It keeps today's behaviour: block at once, recover through reconciliation.

*Alternative:* treat every `run` rejection as a cleanup failure. Rejected: it would admit new work after a persistence failure, and reset the count on runs that never reached cleanup.

### Release shared-work ownership after a failed cleanup

Today a failed close skips `runtime.release`, so a failed execution keeps desktop or shell ownership until restart, and every later turn that needs the desktop is stuck. After a cleanup failure, the server now releases that ownership.

*Trade-off:* a command from the failed execution may still be running in the desktop while a new execution takes ownership. That is accepted. `bot-message-log` already says sibling executions share the container and aren't security-isolated. The old execution can't call any tool, because its capability is revoked. Quarantining ownership would bring back the outage this change removes.

### Count consecutive cleanup failures in the queue lane; block at 3

`BotTurnQueue`'s lane gains `cleanupFailures: number`. `run` now resolves with a cleanup result:

- `failed`: increment. If the lane is not blocked and the count reaches 3, set `failed` and `stopped` and cancel waiting work.
- `ok`: reset to 0, but only while the lane is not `failed`. An execution that finishes after the block does not unblock it.
- `run` rejects: block at once (unchanged).

`unblock(botId, true)` from reconciliation resets the count. Reconcile calls it only after `--kill-all` succeeds, which is already the behaviour.

"Consecutive" means in the order executions finish, across the bot's up to four concurrent executions. That order is what reflects the engine's current health for this bot.

*Alternative:* a time window ("3 failures in 10 minutes"). Rejected: it needs a timer or clock bookkeeping in the queue, and ADR-0028 rules out polling. With a 2-minute trigger, consecutive and windowed give the same answer.

*Boundary:* the per-bot queue lane is the existing unit of admission. The count is per bot and in memory. A restart resets the lane and runs `--kill-all`.

### The failure hook is async, and records durably

The queue's `failure` hook becomes `(item, result) => Promise<void>`, and the queue awaits it. A rejection from the hook is caught and logged, so it can't wedge the lane. For every cleanup failure, the hook:

1. Redacts the error with the bot's secrets (`redactMessage`). If that fails, it uses the fixed text "cleanup error unavailable".
2. Appends `Cleanup failed: <redacted>` to the execution's runner output and calls `sessions.commit` itself, because `runNow`'s own commit may have run before the hook.
3. Logs `[terminay] bot cleanup failed` with bot ID, session ID and the redacted error through `console.error`, which the Desktop diagnostics log captures as `main.stderr`.

Below the threshold, it doesn't touch `state`, `reason` or `cause`. At the threshold, it marks the session `failed`, cause `engine`, reason "bot blocked after 3 consecutive cleanup failures". Cause `engine` keeps ADR-0099's rule that engine-wide causes don't wake a failure execution.

*Boundary:* redaction. The error text crosses into persisted runner output and diagnostics, so it is redacted first.

## Risks / Trade-offs

- [Leftovers can accumulate] → Each failed cleanup can leave that execution's process group, relays and credential lease behind. That includes the third failure, and any executions still running when the bot blocks. Alternating failures and successes reset the count without reaping earlier leftovers, so they can build up without a threshold. The container's process limit bounds them: once reached, new executions fail with the existing `processes` cause. Startup reconciliation's `--kill-all` removes them all.
- [Stop, bot disable and bot delete can now wait several minutes on a hung engine] → These already wait on the same exec. The longer deadline only replaces a false failure with the true result.
- [A surviving command overlaps the next owner of the desktop] → Accepted, as above. The old execution has no tool authority left.

## Migration Plan

No persisted format changes. On deploy, a bot already blocked stays blocked until the next server start, as today.

## Open Questions

None.
