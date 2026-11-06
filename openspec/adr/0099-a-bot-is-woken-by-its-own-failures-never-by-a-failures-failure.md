# ADR-0099: A bot is woken by its own failures, never by a failure's failure

Status: accepted
Date: 2026-11-06

## Context

A bot's trigger poll leaked a `dbus-daemon` on every `tea` call until the container hit its process limit, and every execution after that failed with `spawn EAGAIN`. The bot never knew. Nobody looked until the user opened Sessions and read raw runner output. The owner asked whether the agent can see its sessions, triggers and errors, and whether it is called when an error happens. It could partly see them, and it was never called.

ADR-0093 makes every execution a fresh, server-dispatched run with scoped runtime tools, and says agent posts do not start executions. ADR-0028 forbids polling. A wake-on-failure path has to fit both and must not turn one broken container into an unbounded run of executions.

## Decision

The server starts a *failure* execution for a bot when one of that bot's executions fails or times out, when one of its firings fails, or when one of its trigger condition checks enters failed or blocked health. Each condition-check failure episode counts once.

- **Never chained.** A failure of a failure execution is recorded and never wakes the bot.
- **Not for causes that stop every execution.** Engine unavailable, agent not ready, image unbuildable, bot disabled and container out of processes do not wake the bot. Detection uses a structured cause, not message text.
- **Coalesced and capped.** A bot has at most one failure execution queued or running, with later failures batched behind it. There are at most six failure executions per rolling hour. The next allowed moment is a single deadline timer, not a poll.
- **Server-owned.** Only the server dispatches failure executions. No client or execution can request one. The prompt comes from a server template with redacted, bounded fields that are marked untrusted.
- **Once per underlying failure.** A failing trigger condition is one episode until a check succeeds, and the episode survives restarts. Dispatch is idempotent across crashes through a reserved execution ID. Failure details are redacted when they are accepted, before they are stored.
- **Owner-controllable.** A per-bot **Investigate failures** setting is on by default.

## Consequences

- A broken trigger is investigated by the bot that owns it, without the user having to notice first.
- Failure detection becomes event-driven at the points that record a failure: session state patches, trigger health transitions and firing records. A new failure path must emit the event and set a structured cause when it also stops execution.
- Model usage on failures is bounded by the per-hour cap and the per-bot setting.
- A bot that cannot run at all stays silent. The user learns about it from Sessions and the Triggers tab, whose reasons now name the cause.
