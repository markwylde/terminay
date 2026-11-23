## Context

Bot executions run one agent process each, inside the bot container, under a per-bot queue of four work slots and one reserved coordination slot. Two limits end long work today: Terminay's `maxTurnMs` (a service timer and a native-client timer) and Claude Code's print-mode background ceiling, 10 minutes by default.

The bot image pins Claude Code 2.1.312. Inspection of that binary shows the ceiling is applied only when `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS > 0`, and that on expiry it writes `Background tasks still running <duration> after the last turn (<tasks>); stopping them. Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 to wait indefinitely.` to stderr, then can exit 0 after a successful `result`. Terminay therefore records a completed session.

A server restart already marks every running execution interrupted and kills its processes, so no execution outlives the server.

## Goals / Non-Goals

**Goals:**

- No timer ends a bot turn, in Terminay or in Claude Code's background wait.
- A check-in at each 15-minute mark, bounded so check-ins cannot multiply.
- A session whose background work was killed is never recorded as completed, and the bot or user is told.

**Non-Goals:**

- Resuming executions across a server restart.
- Automatically stopping a stuck session. A check-in judges and acts through its existing tools.
- Changing Codex behaviour beyond removing the Terminay turn timer. It has no equivalent background ceiling.

## Decisions

### Remove the limit rather than use a large value

`maxTurnMs` is deleted from the profile, the snapshot and `prompt()`. A large value would still be a timer, capped by `setTimeout` at about 24.8 days. Parsers ignore the stored field, so existing profiles and session records load unchanged. The `timed-out` state stays in the protocol because retained session records carry it.

Boundary: the server remains the only owner of execution lifecycle. A stuck agent is ended by the user, a check-in using `sessions_stop`, or bot stop.

### Turn off Claude's ceiling through the agent contribution

The Claude contribution sets `launchEnvironment: { CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0' }`. This is host-declared, non-secret configuration that crosses into the bot container through the existing launch environment, and it applies only to Claude.

### Detect the stop from the agent's stderr, by full line

`BotNativeClient` line-buffers raw Claude stderr and matches the complete CLI line, anchored at both ends. A match makes the turn reject even on exit 0. Tool output and agent text travel on stdout in stream-json, so they cannot imitate it. `task_notification` was rejected as the signal because a deliberate stop reports the same status. Memory-pressure reaping was rejected too: the session continues and the agent is told.

With the ceiling off this line should never appear. Detection remains as defence against a future CLI or an overridden environment.

Boundary: the line changes only the execution's own outcome and never carries authority.

### Record stopped background work as `failed`

`failed` already drives failure follow-up, briefings and UI. `interrupted` is rejected because it means "the server restarted" in the UI and does not wake the bot. The accompanying chat notice is server-written and holds no runner output.

### A dedicated check-in scheduler

`BotCheckIns` holds one timer per watched execution, armed for the next mark computed from durable `dispatchedAt`, and torn down when that execution ends. At each mark it evaluates, in order: the watched execution is still running, it is not `needs-you`, it is not itself a check-in, and it has no active check-in. It then dispatches through the normal `send` path, so redaction, snapshotting, capability scoping and queue limits all apply. A refused dispatch skips that mark.

A late timer creates one check-in stating the real whole minutes run at creation, and the next timer is set for the next 15-minute multiple. The origin and prompt keep that creation-time figure even if the check-in then waits in the queue, and the check-in reads current state through its tools.

Boundary: a check-in is an ordinary execution of the same bot. It gains no cross-bot authority and cannot answer permissions, because `decide` remains a user operation. The runtime also refuses `sessions_stop` and `sessions_replace` from a check-in against its watched execution while that execution is `needs-you`, and the service re-checks `needs-you` before a queued check-in runs.

### ADR-0028 poll approval

The check-in timer is a recurring check of a running session, so this change treats it as a poll under ADR-0028.

- **Poll:** one timer per running bot execution, firing at each 15-minute mark of that execution, torn down when it ends.
- **Why no event source works:** the condition being looked for is a session that has stopped making progress, and a stalled process emits no event. The session's own events can only report activity, not its absence.
- **Owner approval:** Mark Wylde, 2026-11-23, in the request to implement issue #648: "a check-in session should spawn every 15 minutes a session runs".

The code site cites ADR-0028 and this change.

### Check-ins have their own slot

If four stuck executions fill the work slots, a check-in queued behind them would never run, which is when it matters most. Sharing the reserved coordination slot would let a stuck check-in block user corrections. The queue therefore gives each bot one dedicated check-in slot. Check-ins never occupy a work or coordination slot, and other executions never occupy the check-in slot. A stuck check-in can delay only other check-ins, and the user can stop it.

### Running output exposes metadata, not transcripts

`sessions_output` accepts running and needs-you executions. Runner output alone is often empty for a healthy agent, so a non-ended read also returns `lastActivityAt` and at most 10 activity entries reduced to fixed `kind` and `status` values. Titles are excluded because the Codex driver puts full shell commands in them, and plan entries hold agent-written text. The activity goes in the slice metadata, so the existing page budget covers it.

A non-ended read returns only the latest slice and refuses cursors. Runner output is a capped tail whose byte length can stay constant while its content changes, so a length-based cursor cannot be trusted while it is live. The cross-bot `bots_sessions_output` is unchanged, so ADR-0138's inspection scope does not widen.

### Every stopped-background failure posts one notice

The notice is posted whenever the failure is recorded, instead of only when follow-up will not run. Follow-up can be suppressed by an open episode, or discarded when settings change, so predicting it would leave gaps. The post uses an idempotency key derived from the execution ID and is durable in the message log.

## Risks / Trade-offs

- [A wedged agent can now run forever and hold a slot] → Check-ins surface and can stop it, and the user can always Stop it.
- [Check-ins cost model usage on long sessions] → At most one per watched session at a time, and none for check-ins.
- [The stderr wording may change in a later CLI] → The ceiling is off, so this is a second line of defence, and a test pins the wording to the bundled version.
- [A stuck check-in holds the check-in slot] → It cannot block work or user messages, and the user can stop it.
- [The real CLI's wait is verified by inspecting the pinned binary, not by a live model run] → Tests drive the launch environment and the native client lifecycle with a controlled agent stream.

## Migration Plan

No data migration. Stored `maxTurnMs` values are ignored on load and dropped on the next profile save. A rollback to a release that requires the field would need it defaulted, because profiles saved by this release no longer carry it.

## Open Questions

None.
