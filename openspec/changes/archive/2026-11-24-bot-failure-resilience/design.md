## Context

A bot execution goes through `BotService.runNow` (`packages/server-core/src/botService/service.ts`) in this order:

1. sign-in check;
2. `prepareSession`;
3. `terminay-init --config`;
4. the device-login check;
5. image copy;
6. credential lease;
7. `openBotRuntimeBridge`, which runs the relay `execStream`, waits for its `{"ready":true}` line, then runs `terminay-bot-mcp --check-runtime` with `deadlineMs: 10000`;
8. the agent process launch and `runner.open()`;
9. `live.runner.client.prompt(...)`, which hands the agent its task.

Everything up to step 8 does no user-visible work. Step 9 is the first moment the agent can act.

On 2026-11-11 the podman VM had a load average of about 16 on 5 vCPUs. Each `podman exec` took 8–9 s to create and start. `SocketDriver.collect` starts its deadline timer before the exec is created, so the 10 s adapter check expired although one probe had exited 0 inside the container. The `catch {}` in `runtimeBridge.ts` threw a fixed message telling the user to rebuild the image. Two concurrent executions failed together. `failureFollowUps` then started an investigation for each, because the failures had no structured `cause`. `cause` is the only filter, and it also blocks the bot (ADR-0099).

Constraints:

- The in-force ADRs that apply are:
  - ADR-0028: no polling;
  - ADR-0093: fresh executions, scoped runtime tools, durable message log;
  - ADR-0099: wake-on-failure, coalesced and rate-limited, structured causes only;
  - ADR-0104: notifications are acknowledged only by the user;
  - ADR-0107: device sign-in check before each session.
- The execution capability is the security boundary for runtime tools. The bot container and the engine are untrusted relative to the server.

## Goals / Non-Goals

**Goals:**

- A transient engine slowdown before task hand-over is retried, bounded by the next firing.
- Failure messages name the real stage and cause.
- Terminay records facts. The agent decides whether to ignore a failure, fix it, or ask a human.
- A human is asked once per real blocker, and a trigger that cannot proceed stops firing until resumed.
- Retries never make an overloaded engine worse.

**Non-Goals:**

- Retrying after task hand-over. That needs per-tool idempotency, which agents do not have.
- Retrying failures with a blocking cause (engine down, agent not ready, image unbuildable, process exhaustion). Those keep their existing recovery UI.
- Detecting host CPU load directly. The only evidence is engine deadlines and dropped connections.
- Changing the per-bot Investigate failures setting or the 6-per-hour cap.
- A recovery ("working again") notification. The user chose to be notified only when they need to act.

## Decisions

### 1. Hand-over marker as the retry-safety boundary

The session record gains `dispatchedAt: number | null`. It is written durably (with the session store's normal patch) immediately before `client.prompt` is called. Retry eligibility is `dispatchedAt === null`. If the server crashes between the patch and the prompt, the execution is treated as having started work. This errs on the side of not retrying.

*Alternatives:*

- Inferring "no work" from empty runner output or from no MCP calls. Rejected: an agent can act through its shell without either, as Codex warned.
- Retrying everything and relying on agent idempotency. Rejected: this could send the support email twice.

### 2. Structured startup failure, separate from `cause`

A new `BotStartupFailure` shape is stored on the session as `startupFailure`:

- `stage`: one of `prepare`, `agent-check`, `relay`, `adapter-check` or `agent-launch`;
- `temporary`: a boolean;
- `code`: `engine-deadline`, `engine-connection`, `relay-not-ready`, `adapter-timeout`, `adapter-temporary`, `adapter-lasting` or `other`.

It is set by a typed `BotStartupError` thrown from each stage. Each failed attempt is appended to `attempts: { at, stage, temporary, code, cause }[]`, which is the history. `startupFailure` is written only when the execution ends before hand-over, as its final failure. An execution that reaches hand-over clears any `startupFailure` from an earlier attempt and keeps the history. Classification uses:

- `EngineCommandError.code === 'deadline'`;
- transport errors with `ECONNRESET`, `EPIPE` or `ERR_STREAM_PREMATURE_CLOSE` codes, caught where the engine transport surfaces them;
- relay readiness timeout or close;
- the adapter's exit status (75 is temporary, 69 is lasting, 126/127 means the adapter is missing). `EngineCommandError` gains `exitCode`, and `SocketDriver.collect` sets it from the exec inspect result instead of discarding it.

Message text is never parsed. `cause` keeps its existing meaning ("stops every execution") and is untouched.

*Alternative:* add `'temporary'` to `BotFailureCause`. Rejected: `cause` is defined as blocking. ADR-0099 and the trigger health code treat any cause as "skip investigation and block", and overloading it would make overload block the bot.

### 3. Deadlines count from exec start

`EngineCallOptions` gains `startDeadlineMs`, with a default of 60 s for these startup calls. It bounds exec create, start and attach. `deadlineMs` starts on the `SocketProcess` `ready` event, which is emitted once attach completes. The adapter check uses `startDeadlineMs: 60000, deadlineMs: 10000`, and relay readiness uses the same split. Other callers keep today's behaviour, because `startDeadlineMs` defaults to "not set" and then `deadlineMs` counts from the call as now.

*Alternative:* raise the check deadline to 30 s. Rejected as the only fix: under real overload, exec start alone can exceed it, and it still conflates engine latency with adapter latency.

### 4. Retry loop inside `runNow`

The startup section (steps 2–8) runs in a retry loop inside `runNow`. Only the stages before agent launch are retried; an agent-launch failure is recorded with its stage and ends the execution, so no provider ever runs in an attempt that is retried. On a `BotStartupError` with `temporary` set and no hand-over:

- close the bridge, which kills the relay group (`terminay-run --kill`) and revokes the token. If the kill cannot be confirmed, the execution ends as failed and the existing per-execution cleanup failure record is written; there is no retry;
- release the credential lease and the startup slot. Each attempt opens a fresh bridge with its own runtime token, and closing the previous bridge revokes its token, so a late call from an earlier attempt is refused;
- append `Startup attempt N failed at <stage>: <cause>. Retrying in Ns.` to runner output;
- patch `attempts` on the session;
- arm one `setTimeout` for the jittered delay.

The delays are 10, 30 and 60 s, each varied by ±20 %. Every execution has `deadline = min(firstAttemptAt + 5 min, nextDue)`, where `nextDue` comes from `TriggerService.nextDue(triggerId)` for a trigger origin with a known next due time (schedule triggers, and observation sources with a scheduled next check). Every other origin, including once, event, disabled and Run now, has no `nextDue`, so its deadline is 5 minutes. The deadline is checked when the retry is scheduled (`now + delay >= deadline` ends the execution) and again when `StartupBudget` grants a permit; a waiter past its deadline is removed from the queue and ended. If attempts are exhausted, the execution ends as failed with the last `startupFailure`. The retry limit is copied from the trigger into the execution record at creation.

When the scheduler finds the trigger due while its previous execution has not reached hand-over:

- an execution in retry wait or permit wait is ended as failed ("replaced by the next firing"); it releases its admission, and then the new firing is sent;
- an execution mid-attempt is marked as replaced, so that attempt is its last. The new firing follows the existing "already pending → bot busy" rule if that attempt hands over; if the attempt fails, the drain is re-run after it ends.

Stopping the execution clears the timer and ends it as stopped. The session stays `running` with `retryAt` set, so the UI can show "Retrying in 30 s (attempt 2 of 4)". The execution keeps its admission slot and its trigger's pending-firing slot.

On server restart, `retryAt` executions become `interrupted`, like other running executions. Resuming a retry across restarts adds durable timer state for little gain.

*Alternative:* a new execution per attempt. Rejected: it multiplies Sessions rows, breaks "one firing, one execution" in the Triggers table, and makes the episode logic count retries as separate failures.

### 5. Machine-wide startup semaphore

`BotService` holds a FIFO `StartupBudget` with 2 permits, server-wide. It is acquired at the start of each attempt and released at hand-over, failure, stop, or entry into retry wait. While waiting, the runner output says "Waiting for another bot execution to finish starting". Two permits keep the overlap that made both executions fail on 2026-11-11 to at most two. It is not a user setting.

*Alternative:* an adaptive limit from measured exec latency. Deferred: it is more complex, and a fixed 2 already removes the pile-up.

### 6. `outcome_report` runtime tool

The tool is added to `BOT_RUNTIME_TOOLS` and handled in `BotExecutionRuntime.call`. It takes:

- `disposition`;
- `reason` (512 B);
- `action` (512 B, required for `needs-human`);
- an optional `triggerId`, which must be one of the calling bot's own triggers;
- `revision`, the observed trigger revision, required whenever a trigger is named or affected;
- an `idempotencyKey`.

Reports are serialized per bot through the existing per-bot `mutations` chain in `BotExecutionRuntime`. The tool stores `outcome` on the session.

For `needs-human` with a trigger and no existing blocker, it writes `blocker = { id, reason, action, sessionId, at, notice: 'pending' }` through `TriggerService` with the revision check. It then posts one bot message through the `chat_post` path, with idempotency key `blocker:<id>`, and writes `notice: 'posted'`. At startup, `TriggerService` re-posts any `notice: 'pending'` blocker with the same key; the message log's idempotency makes this exactly-once. The post raises the bot notification (ADR-0104 unchanged).

`fixed` clears the blocker, with the revision check. A stale revision returns the trigger tools' conflict error. Authority comes only from the execution capability, as with the trigger tools (ADR-0093); no new capability is introduced.

*Alternative:* let the agent just use `chat_post` and `triggers_update enabled:false`. Rejected: disabling loses the reason and action, Resume would mean re-enabling (which resets anchors), and nothing deduplicates repeated asks.

### 7. Trigger blocker and settings

`BotTrigger` gains:

- `startupRetries?: number`;
- `onNeedsHuman?: 'pause' | 'keep-running'`;
- `blocker?: { reason; action; sessionId; at } | null`.

The defaults apply when a field is absent, so stored triggers need no migration. The pause check (`blocker && onNeedsHuman === 'pause'`, read live) runs in three places: in the firing drain before `service.send`; in the queue admission path before a queued trigger item starts; and when a blocker is recorded, which skips that trigger's queued items that have not started. Each records a skipped firing with the reason "waiting for you". Resume is a trigger operation exposed to the UI as a protocol command. The bot's equivalent is `outcome_report('fixed')`; there is no separate runtime tool. Health keeps its existing states. "Needs you" is derived in the UI from `blocker`, with Disabled taking precedence, so the health contract in bot-triggers is unchanged.

### 8. Failure follow-ups: skip temporary failures, count trigger episodes

`FailureFollowUps.execution(record)` returns early when `record.startupFailure?.temporary` is true. An `openEpisodes: string[]` (trigger IDs) is kept in the follow-up state file next to `pending`. The episode check and the open happen in `accept()` after the existing filters (cause, Investigate failures, temporary). Adding the trigger ID to `openEpisodes` and appending the failure to `pending` are written in the same `save()`, which is a single durable file write. A crash either keeps both or neither. A failed execution of a trigger in `openEpisodes` is not accepted. An episode closes when a session of that trigger completes, or on reset, disable, resume or delete (fed from the existing session `state` listener and trigger events). Excluded failures neither open nor close an episode. The state file is rebuildable, so a missing field reads as "no episodes open".

### 9. Adapter exit statuses

`terminay-bot-mcp` maps these to 75: `socket.timeout`, `ConnectionRefusedError`, `ConnectionResetError`, `BrokenPipeError` and "disconnected". `ENOENT`, `EACCES` and "capability refused" map to 69. Other errors exit 1. The host treats 75 as temporary, and 69 and 1 as lasting; both are reported with the adapter's sanitized stderr and no rebuild advice. Only 126/127 (the adapter program is missing or not runnable) gets rebuild advice. The image fingerprint changes, so bots rebuild once (existing image-update flow).

### Boundaries crossed

- **Execution capability → trigger state:** `outcome_report` mutates a trigger. It is limited to the calling bot's triggers, as the existing trigger tools are. Redaction happens before storage.
- **Container → server:** the adapter's exit status is the only new container-supplied fact. It only selects a message and a temporary/lasting flag. It cannot grant retries after hand-over or affect other bots, except by holding a startup permit for at most one attempt's deadline.

## Risks / Trade-offs

- [A lasting fault that looks temporary, such as a wedged relay, burns 4 attempts per firing] → Retries are capped at 3 and bounded by the next firing. The failure stays visible, and the briefing tells the bot it "keeps recurring" after repeats, so the agent can escalate with `needs-human`.
- [Two permits slow every bot's startup under heavy multi-bot load] → Permits are released at hand-over, not at completion, so the queueing covers seconds of startup only.
- [The agent misjudges and reports `needs-human` too often] → One post per blocker, a per-trigger Keep running option, and the user can Resume.
- [Episode suppression hides a second, different failure of the same trigger] → It is still listed in Sessions and the briefing. The episode ends at the next success.
- [`startDeadlineMs` of 60 s lets a hung engine hold a startup permit for a minute] → This is acceptable. That engine cannot start anything anyway, and the blocking-cause path still applies when the engine is unreachable.
- [A failed attempt's processes are left in an overloaded container] → No retry without confirmed cleanup, and the existing per-execution cleanup-failure record and blocking applies.
- [A late callback from a dead attempt corrupts the new attempt] → Each attempt has its own bridge and runtime token; the previous token is revoked before the next attempt, and no provider runs in an attempt that is retried.

## Migration Plan

- New fields are optional, and absent values read as defaults. No data migration is needed.
- The bot image rebuilds once because of the adapter change. Old images report exit 1, which is handled as lasting without rebuild advice, and host deadlines still classify as temporary.
- Rollback: older servers ignore the unknown fields. Trigger blockers would be ignored, so paused triggers would fire again, which is acceptable.

## Open Questions

- None. The partial supersession of ADR-0099 is recorded as ADR-0109.
