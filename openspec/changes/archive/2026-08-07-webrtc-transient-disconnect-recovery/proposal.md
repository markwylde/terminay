## Why

The privileged WebRTC host treated peer and ICE `disconnected` events as
permanent failures. Either callback immediately detached the canonical
application and terminal channels even though WebRTC frequently returns to
`connected`. The server-owned workspace and PTY stayed current, so a user could
refresh the browser and catch up — until the next transient disconnect froze
live delivery again.

## What Changes

- Introduce one connection-scoped lifecycle authority that evaluates combined
  peer and ICE state rather than reacting to either callback independently.
- Start one bounded recovery grace period on a recoverable `disconnected`
  state and cancel it when transport health returns.
- Close immediately for explicit `failed` or `closed` state, and close exactly
  once when the grace period expires.
- Cancel pending recovery during normal host cleanup without publishing a
  second close.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `remote-access`: adds a single connection-scoped lifecycle authority with a
  bounded recovery grace period and exactly-once close semantics.

## Impact

- Privileged WebRTC host connection lifecycle handling.
- Focused host tests and the Docker-isolated Electron end-to-end suite.
- No change to the server-owned workspace, PTY lifetime, or revocation
  behaviour.
