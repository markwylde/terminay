## Context

`TerminalService.waitForInactivity` (`packages/server-core/src/terminalService/service.ts`) arms one timer per waiter and re-arms it on every non-empty PTY chunk. It is the single primitive behind the macro `wait_inactivity` step, the MCP `wait_for_idle` tool, and the `terminal.wait-inactivity` protocol query. It has no knowledge of agents.

Agent state is reduced server-side by `AgentStatusService` (`packages/server-core/src/activity/`). Root entries carry a terminal session id and one of `working`, `waiting`, `blocked`, `done`, `idle`; subagents report through their root. The automation trigger router already subscribes to it.

Both services are constructed in `packages/server-core/src/composition.ts`. The decisions on semantics were taken by the owner and are in `questionnaires/idle-definition.yaml`.

In-force ADRs that constrain this: ADR-0025 (agent sessions come from the machine-wide detection library — this design only reads its reduced state), ADR-0028 (no polling without owner approval), ADR-0035 (the session holder owns PTYs — unaffected; the wait stays in the server).

## Goals / Non-Goals

**Goals:**

- One definition of inactivity for every caller, changed in one place.
- A terminal with no bound agent behaves exactly as before.
- No polling; the wait reacts to agent state edges.

**Non-Goals:**

- No new macro step, setting, MCP parameter, or protocol field.
- No change to the automation `terminal.idle` trigger, which is driven by activity status rather than this wait.
- No diagnosis or workaround for why an agent CLI goes quiet.
- No new overall timeout on waits.

## Decisions

**1. The hold lives in `TerminalService`, behind an injected interface.**
`TerminalServiceOptions` gains an optional `inactivityHold` with `isHeld(identity): boolean` and `subscribe(listener: (sessionId) => void): () => void`. The terminal service does not import the activity module; composition supplies an adapter over `AgentStatusService`. Alternative considered: wrapping `waitForInactivity` at each caller (macro environment, MCP host, protocol). Rejected — three call sites in two hosts would each need the loop, and the next caller would silently miss it.

This keeps the terminal-session boundary intact: `isHeld` is asked with the waiter's own identity and the adapter matches only live root entries bound to that session id, so agent state from another terminal or project cannot influence a wait. Authorization of the wait itself is unchanged (`read` on the exact session).

**2. Held is "any live root entry bound to the session is `working`".**
The adapter uses the same binding rule as the automation trigger router (`terminalSessionId ?? activationTerminalSessionId`) and ignores inactive entries, so an agent whose process has gone cannot hold a wait. Subagents need no handling of their own: a root is `working` while its subagents work.

**3. The timer keeps running while held; the hold is checked when it fires.**
When a waiter's timer fires and the session is held, the waiter is left outstanding with no timer. When the hold source reports a change for that session and it is no longer held, every timer-less waiter on it is re-armed for its full duration. Output during a hold still re-arms as today, which is harmless. Alternative considered: resolving immediately on release if the terminal had already been quiet for the period. Rejected — an agent's state change and its final redraw race, and pressing Enter in that gap is the bug being fixed; a full quiet period after release is the conservative reading.

**4. No new bound on the wait.**
A wait is already unbounded when a terminal never stops printing; a stuck `working` state is the same shape of risk. The existing exits remain: cancellation through the abort signal (macro cancel, MCP request cancel), terminal exit, server detach, and the agent entry becoming inactive when its process exits. Alternative considered: a hold timeout after which output alone decides. Rejected for now — it would reintroduce the reported bug for any agent turn longer than the timeout.

**5. Event-driven only.**
The adapter forwards `AgentStatusService.subscribe` edges, diffing the held set per session so the terminal service is called only when a session's held state actually changes. No timer or poll is added, in line with ADR-0028.

## Risks / Trade-offs

- [Agent tracking sticks on `working`] → the wait never resolves until cancelled or the terminal exits. Mitigation: decision 4's existing exits; the Agents pane shows the same stuck state, so it is visible rather than silent.
- [Agent tracking lags behind the CLI] → a turn that has started but is not yet reflected as `working` can still be missed if the CLI is also silent for the whole period. Mitigation: none in this change; it narrows the window from the whole turn to the detection latency.
- [Existing macros take longer in agent terminals] → intended, and called out in the proposal.
- [Hold source throws] → the service guards calls into it so a fault cannot affect PTY supervision, matching the existing lifecycle-observer pattern; a throwing `isHeld` is treated as not held.

## Migration Plan

Ships as a behaviour change with no stored-data or protocol migration. Rollback is reverting the commit; with no `inactivityHold` supplied the service behaves exactly as before.

## Open Questions

None.
