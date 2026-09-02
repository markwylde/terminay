## Context

See proposal.md. This was Phase 5 work, taken after the official SSH runtime
was stable. Git and observation work proceeded in parallel; the target
helper/bridge foundation had to land before authoritative agents and MCP.
Composed Puzed acceptance depended on the Puzed-to-SSH environment composition
work, while generic SSH work could start after the official SSH extension.

## Goals / Non-Goals

Goals:
- Every planned SSH capability has either a provider-owned implementation or an
  explicit, proven unavailable state.
- No operation can be satisfied by the wrong machine.
- Remote observation is accepted only with proof tied to the exact live session.

Non-Goals:
- Inventing continuity across a target or server restart; resync is the correct
  outcome.
- Publishing the server-local MCP socket or bearer token to the network.

## Decisions

- **Argv-safe execution only.** The SSH exec runner never interpolates shell
  commands, bounds output, time, and concurrency, and pairs with a POSIX path
  adapter so local Git is never invoked with a remote path.
- **Credentials stay target-side.** Git credentials remain on the target or in
  explicitly scoped SSH provider mechanisms.
- **Observation is a contract, not a guess.** Filesystem observation is an
  optional provider contract, implemented by a proven remote watcher or helper
  or by explicitly configured bounded polling. Canonical root and symlink
  boundaries are preserved, bursts coalesce, gaps recover, work stops when
  nothing is observed, and manual refresh remains available when observation
  degrades. Multiple projects and roots cannot receive each other's events.
- **Session-bound proof for process state.** A versioned target-side helper
  protocol binds reported data to the exact SSH channel and session rather than
  matching by path or process name. Canonical working directory and foreground
  process are reported only with fresh, proven session identity; otherwise
  explicit unavailable or stale states are retained. Close protection and
  activity hints come from that capability and never from the Terminay Server's
  SSH client PID.
- **Agents reuse the local proof model.** Remote journal and source callbacks
  use the same process-writer proof, bounded parsing, privacy rules, and exact
  session identity as This server agents. Raw journals, prompts, responses, and
  tool data stay on the server side. Terminal-output fallback is preserved when
  the helper, provider, or journal is missing, and authoritative state is never
  synthesised from working directory or titles.
- **MCP crosses the boundary as a capability, not a socket.** The bridge
  exposes only the existing project-implicit MCP surface authorized by the
  Terminay Server, under a short-lived capability scoped to the session,
  project, and environment, with mutual authentication and replay resistance.
  Reconnect, server restart, and session exit are treated as revocation, and
  the bridge fails closed when identity or environment binding changes.

## Risks / Trade-offs

- A target-side helper is another versioned component to ship and upgrade; the
  E2E suites therefore cover helper absent, incompatible, crashed, and upgraded
  cases explicitly.
- Requiring proof for working directory and foreground process means these
  surfaces are sometimes unavailable rather than approximate; that is preferred
  to a plausible but wrong value.
- Bounded polling is permitted as an observation fallback only when explicitly
  configured, to avoid hidden unbounded polling.
