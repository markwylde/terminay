# Reliable ordered connection delivery

## Goal

Make every application connection fail atomically and recoverably when its
outbound stream stops accepting frames, while preserving ordered delivery and
preventing a live event rejection from crashing Terminay Server or Desktop.

## Governing specifications

- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)
- [Remote access](../features/remote-access.md)
- [Local Desktop diagnostics](../features/local-desktop-diagnostics.md)

## Current gap

Live journal listeners launch asynchronous event sends without observing their
result. The direct WebSocket adapter can still report its logical state as
`open` after the underlying socket has begun closing. A PTY-output-triggered
event send can therefore reject as `remote stream is open`, escape as an
unhandled rejection, and terminate the Desktop main process. The affected
browser can accept or queue input while its server-to-client event path appears
silently frozen.

Command results, replay, and multiple live subscriptions also enter the same
transport from independent async call sites. There is no connection-owned
outbound admission/serialization boundary that defines ordering, backpressure,
or the outcome of send racing with close.

## Implementation slices

### Connection-owned outbound pump

- [x] Route every command result, query result, error, replay frame, resync
  frame, and live event through one bounded outbound pump per ordered lane.
- [x] Preserve accepted frame order, observe `waitForWritable`, enforce queued
  byte/frame limits, and avoid holding feature or journal locks while waiting.
- [x] Make send admission and connection close atomic. Reject pending and later
  sends with one typed connection reason after the first terminal failure.
- [x] Remove every fire-and-forget transport send or attach an owned rejection
  path that closes the connection exactly once.

### Transport lifecycle

- [x] Make WebSocket, MessagePort, and WebRTC adapters derive writability from
  both their logical lifecycle and the underlying primitive's current state.
- [x] Define deterministic send-versus-close, error-versus-close, and
  backpressure-versus-abort behaviour in the shared transport contract.
- [x] Ensure one failed peer cleans up only its requests and subscriptions; it
  must not crash the host, stop a PTY, or affect other connections.
- [x] Record bounded metadata-only diagnostics for first failure, close reason,
  queue occupancy, and reconnect outcome without terminal bytes, payloads,
  credentials, paths, or project names.

### Client recovery

- [x] Treat loss of outbound events as a full connection loss rather than a
  feature-specific frozen state.
- [x] Mark cached projections stale, disable unsafe mutations, authenticate a
  new transport, and resume subscriptions from confirmed revision/position
  watermarks.
- [x] Ensure a half-closed transport is never reused by reconnect.

### Verification

- [x] Add transport contract tests for concurrent sends, FIFO completion,
  bounded backpressure, close during send, callback failure, synchronous throw,
  abort, and duplicate close/error notification.
- [x] Add server-connection tests proving a live journal send rejection is
  observed, the connection closes once, cleanup completes, and the run loop
  does not produce an unhandled rejection.
- [x] Add Docker-isolated Electron/browser E2E that streams PTY output while
  forcing the browser socket through closing/failure, verifies Desktop and the
  server survive, and verifies browser reconnect resumes without loss or
  duplication. Run it only through `npm run test:e2e`.

## Acceptance checks

- A transport failure during live PTY output never raises
  `unhandledRejection` or `uncaughtException` and never exits Desktop or Server.
- Once any outbound send fails, no later command is accepted on a connection
  whose event delivery cannot succeed.
- Frames accepted on one ordered lane arrive in their accepted order or the
  whole affected connection closes with an explicit reason; silent partial
  delivery is not a valid outcome.
- Browser reconnection restores workspace and terminal subscriptions from
  confirmed watermarks without creating another PTY.
- A failing browser peer does not interrupt Local Desktop or another browser.

## Definition of done

All application sends use the bounded connection-owned delivery path, transport
lifecycle races have deterministic tests, the real Desktop/browser failure and
resume scenario passes through `npm run test:e2e`, and no live event rejection
can escape the connection boundary.
