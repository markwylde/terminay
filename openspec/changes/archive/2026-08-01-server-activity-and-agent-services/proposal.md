## Why

Structured signal parsing already sat beside the PTY, but fallback
interpretation, acknowledgement authority, provider-hook reception, and agent
snapshots were split between the Electron main process and renderer state. With
more than one client attached to the same server there was no single ordered
authority, and hook precedence over fallback signals could not be guaranteed.

## What Changes

- Terminal activity interpretation — fallback reduction, timeouts,
  foreground-process signals, and acknowledgement — moves into `server-core`.
- The `node-pty` adapter forwards trusted foreground process facts through the
  terminal lifecycle into the composed agent authority.
- **BREAKING** The Electron PTY-host runtime and its parallel agent authority
  are retired. The desktop build no longer emits `ptyHost.js`, and terminal
  creation has no PTY-host fallback entry point.
- The loopback hook receiver, authentication, environment injection, provider
  drivers, trust, reducer, and acknowledgement are composed into `server-core`
  and exposed to both the embedded and standalone runtimes.
- Authenticated `activity.snapshot` / `activity.delta` / `activity` events /
  `activity.acknowledge` and `agent.snapshot` / `agent.acknowledge` become the
  only client-facing surfaces for this state.
- Clients drive tab indicators, the Agents pane, header activity menu,
  navigation, and acknowledgement from server snapshots instead of local state.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `terminal-activity-signals`: the server owns parsing, fallback
  interpretation, and acknowledgement, and publishes them over an ordered
  authenticated protocol surface.
- `agent-status-and-sidebar`: the reduced agent authority is composed in
  `server-core` for both embedded and standalone layouts, and clients render a
  scoped projection of it.

## Impact

`packages/server-core` (terminal service, `node-pty` adapter, activity and
agent services, managed hook reconciliation), `packages/client-core`
(`ActivityClient`, `AgentStatusClient`), the standalone server CLI and its HTTP
transport, and the Electron main/preload boundary, which loses its own agent
and PTY-host authorities and delegates through `ServerTerminalAuthority`.
