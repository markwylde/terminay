## 1. Deterministic native failure matrix

- [x] 1.1 Treat server application-protocol reader completion or failure as
  failure of the whole host-owned transport generation even when the native peer
  and every required data channel remain open
- [x] 1.2 Deliver that failure once with the exact generation identity to the
  unified renderer recovery controller, retiring the stale application client,
  peer, lanes, subscriptions, and attachments before replacement begins
- [x] 1.3 Verify automatic recovery and manual Retry create a fresh host
  generation rather than consulting, awaiting, or reusing stale peer or channel
  state
- [x] 1.4 Keep the clean Linux native proof self-contained: build workspace
  packages and the production application, install the selected prebuilt runtime,
  run without DISPLAY, Wayland, or a compiler toolchain, and retain traces and
  screenshots on failure
- [x] 1.5 Add independent fault injection for `control`, `application`,
  `terminal`, and `assets` lane close and error while the browser peer stays
  connected
- [x] 1.6 Prove bootstrap-only `api` and singular `asset` lanes are closed and
  unreachable after canonical application handoff, and fault them independently
  before handoff
- [x] 1.7 Assert both bootstrap lanes are closed after every successful mounted
  application handoff and replacement
- [x] 1.8 Cover peer and ICE disconnected-then-recovered, disconnected past
  grace, failed, closed, host shutdown, server exposure stop, and device
  revocation
- [x] 1.9 Prove required-lane replacement closes the retired native peer, that an
  independently closed native peer creates exactly one replacement, and that
  device revocation terminates the active application generation
- [x] 1.10 Hold the mounted browser offline after a required-lane failure, invoke
  Retry repeatedly during backoff, restore reachability, and prove the requests
  coalesce into one successful replacement generation
- [x] 1.11 Bound the complete renderer generation including terminal hydration
  and verification, and prove a timed-out candidate retires before one manual
  Retry activates a fresh generation
- [x] 1.12 Assert one replacement generation per fault, six created and two
  retired bootstrap lanes with four open required lanes, one application
  connection, one PTY, and one canonical project, panel, and terminal session

## 2. End-to-end correctness

- [x] 2.1 Prove automatic recovery restores the mounted workspace without
  navigation, enrollment UI, profile loss, duplicate project, panel, or session,
  or duplicate command
- [x] 2.2 Send unique human-paced, burst, paste, Unicode, escape-sequence, and
  newline-delimited inputs before, across, and after recovery, and assert exact
  PTY byte order and exactly-once delivery for every input with a known outcome
- [x] 2.3 Force an unknown terminal-input outcome and prove the active queue
  closes, discards queued and later input, and that a replacement attachment
  cannot replay any of it, verified by
  `scripts/terminal-panel-input-queue.test.mjs`
- [x] 2.4 Assert the browser and canonical server retain the exact workspace
  revision, active project, panel, terminal session, and single PTY across every
  replacement in the required-lane, peer-close, and offline/Retry matrix
- [x] 2.5 Assert the mounted emulator row geometry equals the canonical terminal
  dimensions, the PTY received that exact resize, retained output remains
  painted, the replacement owns writable presentation control, and new canonical
  output reaches both the server output head and the mounted emulator
- [x] 2.6 Prove a terminal created immediately after replacement reconciles the
  authoritative workspace even when its change notification is lost, and
  completes only once that snapshot contains its session and terminal panel,
  verified by `scripts/workspace-delta-reconciliation-runtime.test.mjs`
- [x] 2.7 Prove explicit browser refresh independently recreates the bootstrap
  and remains supported without being required by Retry

## 3. Diagnostics and release evidence

- [x] 3.1 Record metadata-only first-failure evidence containing opaque profile,
  transport generation, lane label, peer and ICE state, lifecycle phase, attempt,
  close reason, and outcome, and verify no terminal bytes, paths, credentials,
  SDP, ICE candidates, or signaling secrets are recorded
- [x] 3.2 Replace broad `client is not connected` recovery diagnostics with the
  typed lifecycle state while preserving safe user-facing language

## 4. Cleanup of superseded evidence

- [x] 4.1 Remove or rename tests whose descriptions claim WebRTC recovery while
  their runtime selects WebSocket or only reconnects after page close, and verify
  the remaining tests describe only their actual transport or page lifecycle
- [x] 4.2 Update the embedded exposure and browser-host convergence evidence
  links so they consume this matrix instead of duplicating partial reconnect
  scenarios
- [x] 4.3 Preserve the completed transient ICE-grace record as historical
  evidence and verify it is not reinterpreted as proof of required-lane
  replacement
