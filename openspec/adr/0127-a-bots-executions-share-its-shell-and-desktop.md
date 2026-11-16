# ADR-0127: A bot's live executions share its shell and desktop without a lease

Status: accepted, supersedes ADR-0093 in part
Date: 2026-11-16
Supersedes: ADR-0093 (shared-work lease only; the durable message log, fresh executions, bounded admission and coordination tools continue)

## Context

ADR-0093 let a bot's executions overlap within bounded admission "while shared work is leased". The lease made one execution per bot the owner of the shell and desktop, and every other execution was refused on every shell command and desktop tool. Always-on bots overlap all the time: a user message arrives during a trigger run, or two triggers overlap. Unrelated work failed with "runtime capability refused", and bots reported a broken shell.

The owner's model for overlap is different. A new execution learns how many other executions are active and decides whether to stop, steer or replace one, or to leave it running and do its own work. The coordination tools for that already exist. The lease ruled out the last choice.

## Decision

A bot's live executions use its shell and desktop side by side. There is no shared-work owner and no acquire or release tool. The container's shell and desktop gates check only that the calling execution's capability is live, so revocation still stops a replaced or stopped execution's commands before its process group ends. A gate removes the runtime socket together with its token, so a command it admits is never gated again without the token. The desktop MCP receives the runtime pair only to run that check and keeps it out of everything it starts. The briefing states how many other executions are active and asks the agent to decide how its work relates to them. The reserved coordination slot governs admission only.

## Consequences

- Overlapping unrelated work no longer fails, and corrections can still stop, steer or replace older work.
- Executions can interfere on the shared desktop, browser or files. This stays inside one bot's own container, where sibling executions were already cooperative peers rather than security domains. The briefing tells agents to coordinate before driving the desktop.
- The execution capability remains the authority boundary between a live execution and the host.
