## 1. Connection-owned outbound pump

- [x] 1.1 Route every command result, query result, error, replay frame, resync frame, and live event through one bounded outbound pump per ordered lane, verified by the transport contract tests
- [x] 1.2 Preserve accepted frame order, observe `waitForWritable`, enforce queued byte and frame limits, and avoid holding feature or journal locks while waiting, verified by the FIFO completion and bounded backpressure tests
- [x] 1.3 Make send admission and connection close atomic and reject pending and later sends with one typed connection reason after the first terminal failure, verified by the close-during-send tests
- [x] 1.4 Remove every fire-and-forget transport send or attach an owned rejection path that closes the connection exactly once, verified by the server-connection rejection tests

## 2. Transport lifecycle

- [x] 2.1 Make WebSocket, MessagePort, and WebRTC adapters derive writability from both their logical lifecycle and the underlying primitive's current state, verified by the adapter lifecycle tests
- [x] 2.2 Define deterministic send-versus-close, error-versus-close, and backpressure-versus-abort behaviour in the shared transport contract, verified by the shared contract test suite run against every adapter
- [x] 2.3 Ensure one failed peer cleans up only its own requests and subscriptions without crashing the host, stopping a PTY, or affecting other connections, verified by the multi-peer containment tests
- [x] 2.4 Record bounded metadata-only diagnostics for first failure, close reason, queue occupancy, and reconnect outcome with no terminal bytes, payloads, credentials, paths, or project names, verified by the diagnostics content assertions

## 3. Client recovery

- [x] 3.1 Treat loss of outbound events as full connection loss rather than a feature-specific frozen state, verified by the client recovery tests
- [x] 3.2 Mark cached projections stale, disable unsafe mutations, authenticate a new transport, and resume subscriptions from confirmed revision and position watermarks, verified by the reconnect resumption tests
- [x] 3.3 Ensure a half-closed transport is never reused by reconnect, verified by the reconnect transport-selection tests

## 4. Verification

- [x] 4.1 Add transport contract tests for concurrent sends, FIFO completion, bounded backpressure, close during send, callback failure, synchronous throw, abort, and duplicate close or error notification, verified by the shared contract suite
- [x] 4.2 Add server-connection tests proving a live journal send rejection is observed, the connection closes once, cleanup completes, and the run loop produces no unhandled rejection, verified by those tests
- [x] 4.3 Add Docker-isolated Electron and browser E2E that streams PTY output while forcing the browser socket through closing and failure, verifies Desktop and the server survive, and verifies browser reconnect resumes without loss or duplication, verified by running it through `npm run test:e2e`
