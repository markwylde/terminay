## Context

`BotNativeClient` (`native.ts`) marks a Claude `result` terminal only when
`background_tasks_changed` is empty and its count of expected follow-up turns
(`task_notification` completed or failed, less each `system init`) is zero.
Otherwise it keeps stdin open. With the background ceiling off, a forgotten
task holds the process for ever. `BotCheckIns.sync` skips check-ins, so a held
check-in is never looked at.

Whether a host can reach a waiting agent was measured against the pinned
2.1.312: see `openspec/adr/evidence/claude-code-background-wait.md`.

## Goals / Non-Goals

**Goals:** let the agent end a session it has finished with; apply this to
every origin; make a held session diagnosable.

**Non-Goals:** any time limit; check-ins for check-ins; Codex (`codex exec`
exits at `turn.completed` and has no background-wait); honouring wakeups or
cron jobs when nothing else is pending (Claude Code drops them when stdin
closes, today and after this change).

## Decisions

1. **Ask on the open stdin.** The question is an ordinary `user` frame. Ending
   and resuming the process is rejected: it would kill the work being waited
   on, and bot sessions are not persisted.
2. **The driver owns the wait.** `BotNativeClient` already knows when it holds
   stdin open, so it owns one one-shot timer per execution: armed by a
   non-terminal result and re-armed by each check sent, and cleared by
   `system init`, cancel, failure and close. Check-in scheduling is untouched;
   check-ins are covered because every execution has a driver. Timer functions
   are injected through `BotAgentProcess` for tests. This is a repeating timer,
   not a watch: a held process emits no event. The owner approved it in ticket
   680 ("Terminay asks the session whether it's done … asks again after another
   5 minutes"), approval dated 2026-11-28 (ADR-0028, ADR-0149). The code that
   arms the timer cites it.
3. **Answer by nonce line, not a tool.** Each check carries a fresh random
   `TERMINAY-DONE <nonce>`. Only the `result` text of a successful turn is
   read, and only a whole line (markdown emphasis and backticks stripped). The
   nonce ties the answer to the latest question even when a background
   notification starts a turn at the same moment, and tool output cannot forge
   it. A new runtime MCP tool was rejected: it adds authority and relay surface
   for a yes/no that arrives on a channel the driver already reads. Anything
   else means "not done".
4. **Done shutdown.** Send `stop_task` for each listed task, subagents first,
   and for any task that later appears. When the list is empty, close stdin.
   An error already recorded when the answer arrives still fails the turn after
   the same shutdown. After acceptance, permission requests are denied, and
   later result errors, assistant errors, a closed approval stream and the exit
   status are not read. If the process has not closed in 30 seconds, resolve
   the turn; the existing `closeLive('end')` then kills the process group
   through the root supervisor and applies the existing cleanup rules (outcome
   kept, bot blocked at the threshold, leases held until the group is confirmed
   gone). A background-ceiling report on stderr still fails the execution. A
   stop sets `live.closing`, which already wins over a resolving turn. The 30
   seconds bounds shutdown after the agent's answer, not the agent's work.
5. **A check never consumes a follow-up count.** Each check sent adds one to a
   count of unstarted check turns; each `init` first pays that off and only then
   decrements the expected follow-ups. One `init` per check is skipped, so the
   count stays right whether the check's turn or a notification's turn starts
   first, and if the CLI folds both into one turn the error keeps stdin open
   rather than closing it early. A stale follow-up count (one possible cause of
   #680) therefore ends through the done answer, not as a side effect of
   asking. A turn is not terminal while a sent check has yet to start its turn,
   so input never closes on a queued check. The terminal rule is otherwise
   unchanged.
6. **Diagnostics on the record.** The driver emits a wait snapshot; the service
   redacts and bounds it into an optional `BotSessionRecord.backgroundWait` and
   commits it on each change. Activity during a wait (subagent progress, runner
   output) refreshes `lastActivityAt` at most once a minute. A `sessions_get` result has 8 KiB,
   so it returns 8 items with 128-byte descriptions and drops more while the
   encoded result is too large; the full bounded list stays on the record. The field is
   optional, so older records parse. The check is appended to the transcript as
   a user entry that begins "Terminay check".

**Boundaries.** The record crosses the server-to-client boundary as part of an
existing bot-scoped session record, and the agent-to-agent boundary through
`sessions_get`, which stays scoped to the same bot. Descriptions are
agent-authored untrusted text: redacted, bounded, rendered as text. The check
adds no authority, and permission requests during a check turn follow the
execution's approval mode.

## Risks / Trade-offs

- [A Monitor that wakes the agent more often than every 5 minutes is never
  asked, because the wait is never continuous] → The decided rule is a
  continuous wait; the details show the wait, and check-ins still watch
  non-check-in executions.
- [Each check costs a model turn] → At most one per 5 minutes of idleness.
- [The agent says done while work it needs is pending] → The agent decides, as
  decided; the message says what saying done stops.
- [In Ask me mode a check turn may request a tool] → Normal approval flow; no
  check is sent while a request is open.
- [A future Claude Code changes `stop_task` or stdin handling] → An unanswered
  check changes nothing, and shutdown falls back to the supervisor.

## Migration Plan

Server-only behaviour plus one optional record field. Rolling back leaves the
field ignored by older code.
