# ADR-0149: A bot session waiting on background work is asked whether it is done

Status: accepted, supersedes ADR-0140
Date: 2026-11-28
Supersedes: ADR-0140

## Context

ADR-0140 removed every bot time limit and relied on check-in executions to judge
liveness. With Claude Code's background ceiling off, a session that finished its
work but left a shell, Monitor or subagent behind never exits, and a check-in
that does so is never watched because check-ins receive none. The owner ruled
out time limits: only the agent knows whether it is still waiting for
something. A host can put a message to a waiting Claude Code process on its open
standard input (`./evidence/claude-code-background-wait.md`).

## Decision

1. No timer ends a bot turn or a waiting session. Terminay has no turn limit,
   and it launches agents with their own background-work limits off.
2. Liveness is judged by the bot: for every 15 minutes an execution runs, the
   server starts one check-in execution of the same bot, from one timer per
   watched execution.
3. Check-ins run in one dedicated per-bot slot, do not receive check-ins, do not
   wake failure follow-up, and do not overlap per watched execution. They hold
   no authority beyond an ordinary execution, never answer a user's permission
   decision, and cannot stop or replace a watched execution that is waiting on
   the user.
4. An execution whose agent reports that it stopped background work at a time
   limit is failed, never completed.
5. Whether a finished session may end is judged by that session. After 5
   continuous minutes in background-wait, any execution, check-ins included, is
   asked on its own input whether it is done. Only its answer, a one-time line
   in its reply, makes Terminay stop its background work and complete it. It is
   asked again after each further 5 minutes. Time spent shutting down after
   that answer is bounded.
6. The timers in points 2 and 5 are polls approved by the owner under ADR-0028
   (change `bot-sessions-have-no-time-limit`, and ticket 680), because a stalled
   or held process emits no event.
7. What holds a waiting session open is recorded on the session and kept.

## Consequences

- A wedged agent that answers nothing still holds its slot until a check-in, the
  user, or bot stop ends it.
- Long sessions spend model usage on check-ins and done checks.
- Background work that wakes its agent more often than every 5 minutes is not
  asked about.
- Any new agent runtime must disable or report its own background limits, and
  one that can wait on background work must support the done check.
- Reintroducing a turn or wait limit needs a new ADR.
