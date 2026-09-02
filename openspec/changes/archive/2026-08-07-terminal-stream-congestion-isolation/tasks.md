## 1. Lock the regression and expose evidence

- [x] 1.1 Add a real Docker Electron test that crosses the presentation limits
  and verifies completion, subsequent input, connection health, and new-terminal
  creation
- [x] 1.2 Add a deterministic 200 MiB server characterization proving congestion
  remains attachment-scoped without closing the shared connection
- [x] 1.3 Add metadata-only diagnostics for traffic class, opaque attachment id,
  queued bytes and frames, confirmed and head positions, congestion transition,
  and connection rehydration outcome, and verify no content is recorded

## 2. Separate terminal presentation delivery

- [x] 2.1 Define the connection scheduler and terminal-lane state machine with
  explicit byte, frame, age, and fairness limits
- [x] 2.2 Remove raw terminal output from the generic journal FIFO and verify
  exact attachment authorization and terminal event subscription semantics are
  preserved
- [x] 2.3 Reserve bounded control capacity and prove terminal output cannot
  starve command and query results, workspace deltas, or lifecycle events
- [x] 2.4 Preserve ordering of dimensions, presentation ownership, output, exit,
  and resync transitions within each exact terminal attachment

## 3. Recover one congested presentation

- [x] 3.1 Convert terminal-lane overflow into one attachment-scoped
  `resync_required` transition and verify the transport and PTY stay open
- [x] 3.2 Rehydrate the affected emulator through the checkpoint protocol from a
  precise safe position and verify live delivery resumes without gaps or
  duplicates
- [x] 3.3 Verify unrelated terminals stay interactive and workspace and terminal
  creation commands succeed throughout another terminal's congestion
- [x] 3.4 Bound repeated overflow, pins, retries, parser work, and queued live
  tail, and verify controller input is restored only after valid hydration

## 4. Repair genuine connection recovery

- [x] 4.1 Implement and expose `connected → reconnecting → resubscribing →
  hydrating → connected` for Local and remote clients
- [x] 4.2 Replace disposed clients atomically with generation guards, bounded
  backoff, and actionable failure state, and verify a half-closed transport is
  never reused
- [x] 4.3 Reload authoritative workspace state and reattach mounted terminal
  panels, verifying no second PTY is created and presentation identity is kept
- [x] 4.4 Prove new commands fail promptly while reconnecting and succeed after
  recovery rather than timing out against an inert client

## 5. Verify limits and convergence

- [x] 5.1 Pass the deterministic 200 MiB regression and the real Electron
  presentation-limit reproduction without retry
- [x] 5.2 Test sustained output with bounded memory and a deliberately stalled
  renderer while another terminal and workspace commands remain responsive
- [x] 5.3 Test multiple noisy terminals for fair progress and reserved control
  capacity
