## Context

See proposal.md. Two authorities existed for the same facts: `server-core`
parsed signals beside the PTY, while Electron main held a second
`AgentStatusService`, a hook receiver, provider drivers, and signal
interpreters behind the PTY-host runtime. Renderer state then added a third
projection. Nothing forced two attached clients to observe the same transition
sequence, and acknowledgement revisions could diverge per client.

## Goals / Non-Goals

Goals:
- One ordered activity/agent authority per server, for embedded and standalone
  layouts alike.
- Provider-hook authority over raw and structured fallback signals, preserved
  exactly as before the move.
- Client reload and reconnect reproduce the current snapshot without inventing
  transitions.

Non-Goals:
- Changing the signal grammar, hook precedence order, or the agent state model.
- Keeping any Electron-side compatibility authority as a fallback.

## Decisions

- **The server model owns the contract and the embedded host delegates to it.**
  `ServerTerminalAuthority` bridges Electron IPC to `server-core`'s
  `TerminalService`, rather than retaining a parallel Electron PTY authority.
  Terminal creation therefore has no PTY-host entry point at all; a fallback
  path would have re-created the divergence this change removes.
- **Foreground process facts are adapter-sourced and deduplicated.** The
  adapter emits process/shell facts only while subscribed, `TerminalService`
  preserves immutable server/project/session identity, and the listener is
  disposed on terminal exit, so an exited session cannot keep publishing.
- **Hooks resolve only by exact immutable server terminal session.** Stale,
  reordered, cross-server, exited-session, malformed, and oversized hook events
  are rejected rather than creating state; unknown hook-injector session ids
  are rejected at the IPC adapter too.
- **`agentIntegration.enabled` is a server-owned policy, not a client
  preference.** When disabled the service injects no hook variables, revokes
  existing leases, clears the reduced snapshot, and rejects stale hook
  delivery; fresh leases are issued only after re-enable.
- **Only reduced snapshots cross the protocol.** Hook tokens and raw provider
  payloads never reach clients or logs. The standalone HTTP transport test
  proves the foreground CLI to inherited-PTY-hook to authenticated-client path
  without revealing the hook token.
- **A managed hook counts as installed only when attached to its exact native
  event matcher.** Reconciliation repairs a wrong-matcher Terminay hook while
  preserving user hooks, and never persists endpoint or token credentials.
- **Preload snapshots are filtered to exact, still-active identities**, so
  exited or remapped sessions cannot leak retained agent rows into a client.

## Risks / Trade-offs

- Retiring the Electron PTY-host runtime removed its direct fork/supervisor
  tests. The replacement authority bookkeeping is covered by the
  server-terminal runtime suite instead, which is a narrower but truer target.
- Popout and merge move a renderer subscription between hosts. The transfer
  subscribes the destination before detaching the source, accepting a brief
  double subscription rather than risking a gap in presentation ownership.
- Desktop quit must await and coalesce server-terminal authority shutdown
  before the final exit, which lengthens quit slightly in exchange for not
  losing in-flight terminal state.

## Migration Plan

Embedded Desktop settings reconcile managed Codex and Claude Code hooks through
the composed service and no longer start the Electron compatibility receiver.
The standalone CLI composes `AgentStatusService` and starts its hook receiver
before the default terminal is created, so no terminal exists before the
authority does.

## Open Questions

_None recorded. The completion audit confirmed the standalone CLI composes and
exposes the server-owned agent authority, and that Desktop retains no parallel
Electron agent authority._
