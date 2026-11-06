## Context

The investigation of bot `689a04866498` (Codexia) found three separate problems behind one symptom.

1. **Process leak.** `terminay-run` gives every supervised command `DISPLAY=:1` but no `DBUS_SESSION_BUS_ADDRESS`. The desktop's own bus exists, but only inside `dbus-run-session` in `terminay-desktop-session`. The trigger's `poll.py` runs `tea` once per page of 50 PRs, about 35 calls a minute. `tea` contains Go D-Bus client code that auto-launches a bus through `dbus-launch` when the address is unset and a display is present. `dbus-daemon --fork` calls `setsid`, so it leaves the supervised process group. `terminay-run`'s cleanup ends only that group, so each daemon survived. There were 822 of them, and the container sat at 1013 of its 1024-process limit.
2. **Opaque failure.** The agent CLI died with `spawn EAGAIN`, but `native.ts` reports every native failure as "The native agent could not complete the request." The cause appears only in the runner output.
3. **Blind agent.** The runtime MCP already lets an execution list and read its triggers, and trigger summaries include `health`. However, `sessions_list` and `sessions_get` omit the failure reason, no tool reads runner output, briefings do not mention failures, and nothing wakes the bot when something fails.

Relevant code:

- `docker/terminay-bot/bin/terminay-run` and `terminay-desktop-session`;
- `packages/server-core/src/botService/runtime.ts`: tools, `summary()` and `briefing()`;
- `messages.ts`: `sliceText`;
- `service.ts`: `dispatchExecution` and `runNow`;
- `sessions.ts`: `patch`;
- `native.ts`: `fail()`;
- `triggers.ts`: `health()`, the source error path and the firing-start catch;
- `socketDriver.ts`: container stats;
- `packages/protocol/src/bots.ts`;
- `src/workspace/bots/BotSessionsPanel.tsx` and `BotProfilePanel.tsx`.

In-force ADRs that constrain this design:

- ADR-0011: trust boundaries.
- ADR-0028: no polling.
- ADR-0088: durable state files and recovery by kind.
- ADR-0092: the engine socket.
- ADR-0093: durable message log, scoped runtime, and fresh executions.
- ADR-0096: trigger sources run in the owning container.

## Goals / Non-Goals

**Goals:**

- A D-Bus client in a supervised command can never auto-launch a session daemon.
- A process-exhaustion failure says so, backed by engine numbers.
- An execution can find out why a sibling execution or trigger failed.
- The bot is woken to investigate its own failures. Each underlying failure is reported once, a restart loses or duplicates nothing, and nothing loops or floods.

**Non-Goals:**

- Automatically restarting a container that has run out of processes. The reason tells the user to restart it.
- Killing processes that escape a process group by other routes, including a command that deliberately starts its own `dbus-daemon --fork`. `terminay-run` cannot read other processes' `/proc/<pid>/environ` in the hardened container, so a nonce sweep is not possible. This change removes the auto-launch route we observed.
- Sending system notifications for failures the bot cannot investigate. Sessions and the Triggers tab show them.
- Rewriting the bot's own `poll.py`. Once woken, the bot can fix it itself.

## Decisions

### D1. Share the desktop bus, fall back to `disabled:`, and always override

Once inside `dbus-run-session`, `terminay-desktop-session` writes `$DBUS_SESSION_BUS_ADDRESS` atomically to `/run/terminay/desktop-bus` (mode 0644) and removes the file on exit. For every supervised command, `terminay-run` reads that file. If the `unix:path=` socket in the address exists, it sets `DBUS_SESSION_BUS_ADDRESS` to that address. Otherwise it sets `disabled:`.

`terminay-run` always overrides an inherited or caller-supplied value. An empty or `autolaunch:` value is exactly the leak route. libdbus and godbus both refuse an unknown transport and do not auto-launch.

The contract is: a client that only opens the session bus never starts a daemon.

- *Alternative: a `dbus-run-session` for each execution.* Rejected. It starts a daemon per execution, and desktop apps would not share the bus.
- *Alternative: always `disabled:`.* Rejected. Desktop apps and keyrings legitimately use the desktop bus.
- *Boundary:* this stays inside the bot container's single security domain. Sibling executions already share the container and its uid (ADR-0093).

### D2. Process exhaustion needs engine evidence

Several paths pass a bounded tail of their error text to one classifier:

- the agent wrapper (`native.ts` and `agentProcess.ts`);
- the `runNow` failure path;
- the source runner;
- engine exec-start failures.

The classifier recognises an `EAGAIN` failure to create a process or thread:

- `spawn … EAGAIN`;
- `fork: Resource temporarily unavailable`;
- `pthread_create: Resource temporarily unavailable`;
- an engine exec-start error carrying `EAGAIN`.

When it matches, the server reads `pids_stats.current` and `pids_stats.limit` from the engine's one-shot `/containers/{id}/stats?stream=false`. It never uses `exec`, which needs a free process.

The text match alone never sets a cause. The outcome depends on the engine numbers:

- **Limit known and the count within 16 of it:** the cause is `'processes'`, and the reason is "The bot container has run out of processes (1013 of 1024). Restart the bot container."
- **Anything else** (stats error, no limit, count well below it): the reason is "The agent could not start a process (EAGAIN).", with no cause, so the bot is still woken.

For trigger checks, the same reason becomes the health error, and the cause is stored on health (D3).

- *Boundary:* the engine socket is already the server's privileged transport (ADR-0092). Container text reaches the reason only through fixed templates.

### D3. A structured failure cause wherever a failure is recorded

`BotFailureCause` is one of `'engine' | 'agent' | 'image' | 'disabled' | 'processes'`. It is stored as `cause` on session records, on firings and on `BotSourceHealth`. It is set in these places:

- where `runNow` already chooses `failureReason`;
- where a firing cannot start;
- in the source runner's error path: an engine-unavailable `EngineCommandError` gives `'engine'`, D2 gives `'processes'`, and a disabled bot gives `'disabled'`.

It is never set from message text. D5 reads only `cause`.

### D4. Runtime visibility

- **Compact summaries.** `summary()` returns a compact origin, `{ kind, triggerId?, triggerName?, failureCount? }`, instead of the full origin. It also returns `reason` (up to 256 B, cut on a UTF-8 boundary) and `cause`. List pages are already cut at 8 KiB; compact origins keep failure-origin rows small, so a page still holds several rows and pagination reaches every row.
- **`sessions_get`** adds `reason` (up to 1 KiB). For a failure origin it also adds the listed failures, trimmed from the end until the response fits in 8 KiB, with a `failuresOmitted` count.
- **`sessions_output { sessionId, cursor? }`** reads runner output.
  - It accepts ended executions only. A running, queued or needs-you target is a `conflict`.
  - `sliceText` walks forwards and caps at 6 KiB, so the read uses a new sibling, `sliceTextBackward`. It uses the same signed cursor format. The cursor holds the end offset of the next slice and a revision taken from the output's byte length, which is stable because ended output never changes.
  - Each slice is at most 6 KiB of text, cut on a UTF-8 boundary.
  - Bot scoping goes through `target()`, whose refusal does not reveal whether a session exists.
- **Briefing.** It adds:
  - `recentFailures`: up to 5 from the last 24 hours, each with its compact origin and a reason of up to 256 B;
  - `unhealthyTriggers`: up to 5 with failed or blocked health, each with an error of up to 256 B.

  The existing `recentLimit` shrink loop becomes an ordered trim: recent messages first, then unhealthy triggers, then failures, then other executions. Trigger identity and content are never trimmed.
- *Boundary:* every read is scoped through the execution capability (ADR-0093).

### D5. Failure follow-up dispatcher

A new `failureFollowUps.ts`, owned by `BotService`, decides when to start a failure execution.

**Inputs.** All inputs are events. Nothing polls.

- `sessions.patch` emits an event when a session moves into `failed` or `timed-out`.
- **Trigger condition episodes.** The checkpoint gains a persisted `failureEpisode` flag.
  - When a check ends failed or blocked and the flag is false, the flag is set and one event is emitted.
  - Only a successful check, reset, disable or delete clears the flag.
  - Moves through `checking`, `retrying` or `watching` never touch it. A sequence of `failed → checking → failed` therefore gives one event. The flag survives a restart with the checkpoint.
- **Firings recorded failed.** The firing-start catch records a failed firing and also sets health to failed. It emits one event, of kind `firing`, and marks the episode started without emitting a second event.

**Filter.** An event is dropped when any of these hold:

- `investigateFailures` is false;
- the record's origin is `failure`;
- `cause` is set;
- a firing failure has a session (it is reported as that execution's failure).

**Redaction at acceptance.** When a failure is accepted, the server takes a credential lease at that moment, redacts `reason` and `triggerName` through it, and cuts them to 1 KiB. Only the redacted copy is stored. No later exposure sees the raw text, so rotating the credential before dispatch does no harm.

**State.** Each bot has `bots/failure-follow-ups/<botId>.json`, holding `{ pending, overflow, dispatching }`:

- `pending`: up to 20 failure refs;
- `overflow`: the count of failures beyond those 20;
- `dispatching`: `{ id, failures, overflow }`, or null.

`active` and `starts` are not stored. They are derived from session records whose origin is `failure`: a queued or running one is the active execution, and those started within the last hour count towards the cap. This keeps session records as the only source of truth.

**Dispatch order.**

1. Generate `id`. Durably write the state with `dispatching` set to `id` and the pending failures, and with `pending` empty.
2. Call `dispatchExecution(…, reservedId: id)`. It is already idempotent for an existing reserved record.
3. Durably write the state with `dispatching = null`.

**Reconcile.** At startup, after sessions and triggers have loaded: if `dispatching` is set and a session with that `id` exists, clear `dispatching`. Otherwise repeat step 2 with the same `id`. A crash at any point therefore gives exactly one execution.

If `dispatchExecution` throws (a full queue or a disabled bot), the `dispatching` failures go back to the front of `pending`. The drain is retried when the next session ends or the deadline timer fires.

The file is *rebuildable state* under ADR-0088. A corrupt file is set aside and the bot starts with empty pending state. The failures stay visible in Sessions and the Triggers tab.

**Drain.** The drain runs when a failure is accepted, when a failure execution ends, and when the deadline timer fires. It starts an execution only if all of these hold:

- `investigateFailures` is on;
- the bot is enabled and not being deleted;
- no failure execution is active;
- fewer than 6 failure executions started in the last hour.

When the hourly cap blocks it, one `setTimeout` is set for the earliest start plus one hour. That is a deadline for a known moment, not a re-check on an interval, so ADR-0028 does not apply. The timer is re-armed on reconcile and cleared on shutdown.

**Setting and lifecycle.** Saving a profile with `investigateFailures: false`, disabling the bot, or deleting it clears `pending`, `overflow` and the timer. A failure execution that is already running is left to finish. Deleting a bot removes its state file with its other files, through the `bot-engine-recovery` deletion path.

**Prompt.** The prompt comes from a fixed server template. It contains:

- the listed failure refs and the overflow count;
- a notice that reasons and runner output are untrusted data;
- the tool names `sessions_get`, `sessions_output`, `triggers_get` and `triggers_test`.

It contains no runner output.

**Origin type.** The new origin is `{ kind: 'failure'; failures: readonly BotFailureRef[]; overflow: number }`, where `BotFailureRef` is `{ kind: 'execution' | 'firing' | 'condition'; sessionId; firingId; triggerId; triggerName; at; reason }`.

- *Alternative: a system chat message that starts a chat execution.* Rejected. ADR-0093 says posts do not start executions, and it would fill the user's chat.
- *Alternative: a follow-up for each trigger with no global cap.* Rejected. A broken container fails every trigger at once.
- *Boundary:* only the server dispatches failure executions. No client or execution can request one.

### D6. Profile setting and UI

- **Profile field.** `BotProfile.investigateFailures?: boolean`. A missing value reads as true, and saving writes it explicitly.
- **`BotProfilePanel`** gets a switch with one line of help.
- **`BotSessionsPanel`** adds *Failure* to the origin filter and labels these sessions "Investigate failure". Its detail view lists the failures, each linking to the failed session or the trigger.

## Risks / Trade-offs

- [The bot spends model usage on noisy failures] → Each episode counts once, with at most 6 failure executions an hour. The user can turn the setting off.
- [A failure execution acts on attacker text in a reason] → Reasons are short, marked untrusted, and redacted. The execution has the same authority as any other.
- [The desktop bus file is stale after a desktop restart] → `terminay-run` checks that the socket exists and falls back to `disabled:`. The file is rewritten every time the desktop starts.
- [`EAGAIN` comes from something other than the process limit] → Exhaustion is claimed only with engine evidence. Otherwise the reason is neutral and the bot is still woken.
- [The image needs a rebuild] → Existing bots pick up the fix through the existing out-of-date image rebuild. Until then the D2 reason tells the user to restart the container.

## Migration Plan

Image changes ship with the server, and bots rebuild through the normal image flow. The new fields on profiles, records, health and checkpoints are optional, so older files load unchanged. A missing follow-up state file means empty state. The setting can be turned off as a rollback. Older servers ignore the extra fields.

## Open Questions

None. Scope came from the investigation in this conversation: fix the leak, give the agent visibility, and wake the agent on failures. The defaults (on, 6 an hour, 20 pending, a margin of 16 processes) are recorded here and can be tuned in review.
