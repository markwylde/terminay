## Why

Live journal listeners launched asynchronous event sends without observing
their result, and the direct WebSocket adapter could still report its logical
state as `open` after the underlying socket had begun closing. A
PTY-output-triggered event send could therefore reject as `remote stream is
open`, escape as an unhandled rejection, and terminate the Desktop main
process, while the affected browser kept accepting input against a silently
frozen event path.

## What Changes

- Route every command result, query result, error, replay frame, resync frame,
  and live event through one bounded outbound pump per ordered lane.
- Make send admission and connection close atomic: after the first terminal
  failure, pending and later sends are rejected with one typed connection
  reason.
- **BREAKING** Remove every fire-and-forget transport send. A send without an
  owned rejection path that closes the connection exactly once is no longer
  permitted.
- Make WebSocket, MessagePort, and WebRTC adapters derive writability from both
  their logical lifecycle and the underlying primitive's current state, with
  deterministic send-versus-close, error-versus-close, and
  backpressure-versus-abort behaviour.
- Contain failure to one peer: a failed connection cleans up only its own
  requests and subscriptions and must not crash the host, stop a PTY, or affect
  other connections.
- Treat loss of outbound events on the client as full connection loss, marking
  cached projections stale, disabling unsafe mutations, authenticating a new
  transport, and resuming subscriptions from confirmed watermarks.
- Record bounded metadata-only diagnostics for first failure, close reason,
  queue occupancy, and reconnect outcome.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `server-runtime-and-protocol`: the connection-owned outbound pump, transport
  adapter lifecycle fidelity, connection-scoped failure containment, and
  metadata-only diagnostics.
- `terminal-stream-congestion-and-recovery`: client treatment of lost outbound
  events and watermark-based resumption.

## Impact

The server connection run loop and journal listeners, the shared transport
contract, the WebSocket, MessagePort, and WebRTC adapters, client reconnect and
subscription resumption, and Desktop and Server process stability. New
transport contract tests, server-connection tests, and a Docker-isolated
Electron and browser E2E scenario run through `npm run test:e2e`.
