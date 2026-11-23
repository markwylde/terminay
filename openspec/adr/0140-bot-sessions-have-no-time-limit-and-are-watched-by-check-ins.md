# ADR-0140: Bot sessions have no time limit and are watched by check-in sessions

Status: accepted
Date: 2026-11-23

## Context

Bot tasks can run for hours or days. A per-turn timer and Claude Code's 10-minute background ceiling both ended legitimate work, and a session killed that way could be recorded as completed, so nothing followed up. ADR-0028 forbids polling, and ADR-0109 makes the bot the judge of its own failures.

## Decision

1. No timer ends a bot turn. Terminay has no turn limit, and it launches agents with their own background-work limits off.
2. Liveness is judged by the bot: for every 15 minutes an execution runs, the server starts one check-in execution of the same bot, from one timer per watched execution. This timer is a poll approved by the owner under ADR-0028, as recorded in change `bot-sessions-have-no-time-limit`, because a stalled process emits no event.
3. Check-ins run in one dedicated per-bot slot, do not receive check-ins, do not wake failure follow-up, and do not overlap per watched execution. They hold no authority beyond an ordinary execution, never answer a user's permission decision, and cannot stop or replace a watched execution that is waiting on the user.
4. An execution whose agent reports that it stopped background work at a time limit is failed, never completed.

## Consequences

- A wedged agent holds its slot until a check-in, the user, or bot stop ends it.
- Long sessions spend model usage on check-ins, bounded to one active per session.
- Any new agent runtime must disable or report its own background limits.
- Reintroducing a turn limit needs a new ADR.
