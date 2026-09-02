## Why

The web renderer had multiple connection entry paths that independently
constructed clients and contexts, with `BrowserConnectionAttemptGate`,
`RendererConnectionGeneration`, `RendererConnectionRecovery`, React state, and
panel callbacks each owning part of the lifecycle. Initial WebRTC pairing began
a renderer generation keyed by transport origin but disposed it by profile id,
so cleanup depended on which path had mounted the workspace, and the terminal
Retry callback captured a specific client and attempt that correct disposal
then invalidated.

## What Changes

- **BREAKING** Replace the overlapping attempt gates, generation guard,
  recovery loop, captured client callbacks, and panel-local recovery
  presentation with one connection-scoped state machine shared by initial
  activation, automatic recovery, and manual Retry.
- Key the controller only on stable profile id plus verified server and session
  identity. URL, origin marker, client id, React mount, and transport attempt
  are no longer alternative generation keys.
- Give the controller one monotonic attempt sequence and one explicit state
  union covering idle, connecting, authenticating, resubscribing, hydrating,
  connected, retry-wait, blocked, and stopped.
- Model transport acquisition as an injected host operation so WebRTC, direct
  WebSocket, and Desktop MessagePort satisfy the same replacement interface with
  no transport-specific branches in the renderer state machine.
- Replace `requestConnectionRecovery` closures captured from a client with one
  stable controller `retry()` action supplied by current profile identity.
- Drive connection banners, terminal overlay, button availability,
  accessibility announcements, and input enablement solely from controller
  state plus terminal-attachment hydration state.
- **BREAKING** Delete `BrowserConnectionAttemptGate`,
  `RendererConnectionGeneration`, `RendererConnectionRecovery`, duplicated
  `recoverConnection` branches, transport-specific auto-restore suppression,
  origin and profile key workarounds, fire-and-forget active-context disposal,
  and panel-local optimistic reconnect state, with no compatibility wrappers.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `terminal-stream-congestion-and-recovery`: single recovery controller, input
  safety during recovery, and recovery presentation rules.
- `connections-and-client-hosts`: one connection generation and activation path
  per mounted workspace across renderer hosts.

## Impact

`src/web/main.tsx` connection entry paths, the deleted renderer lifecycle
classes, terminal panel Retry wiring and overlay presentation, terminal input
queue handling, and the tests that previously asserted callback wiring by
source regex, which are replaced with runtime state-machine and mounted-panel
behaviour tests.
