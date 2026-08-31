# 74 — Remote connection lifecycle simplification

## Goal

Remote sessions stream live PTY and workspace events for as long as the
transport genuinely works, and recover within a bounded, visible window when
it does not. The frozen-checkpoint failure (connects, hydrates, then never
streams) is eliminated at its cause, and the stall-inference machinery built
around the symptom is deleted. The connection layer gets simpler, not more
configurable.

## Root cause analysis (evidence, 2026-08-31)

The frozen-checkpoint loop is caused by cross-connection teardown keyed on a
shared identity, not by WebRTC state handling:

1. The hosted pairing host accepts every application connection with
   `clientId: ticket.deviceId` (`apps/terminay-server/src/remote/hostedPairingHost.ts:1161`).
   The device id is stable across reconnects, so a reconnect creates a second
   `ServerConnection` with the same `clientId` while the previous one is still
   alive.
2. Old peers are no longer closed on rejoin or on lane close/stall
   (`laneCloseHangsUp` and `shouldFailHostedStall` are hard-coded `false`,
   `apps/terminay-server/src/remote/hostedPeerLifecycle.ts:182-205`;
   `HostedGenerationSet.add` only appends). The zombie connection lingers.
3. Event routing matches on `clientId`
   (`packages/server-core/src/connection.ts:594-598`), so the new session's
   terminal output is also pumped into the zombie's transport until its
   30-second backpressure deadline fails it
   (`packages/server-core/src/remote/channelTransport.ts:138-154`).
4. The zombie's cleanup then calls `onConnectionClosed?.(clientId)`
   (`packages/server-core/src/connection.ts:538`) →
   `terminalOperations.closeClient(clientId)`
   (`packages/server-core/src/composition.ts:522`,
   `packages/server-core/src/terminalService/protocol.ts:147-167`), which
   detaches **every** attachment for that device — including the healthy new
   connection's — and releases its leases and checkpoints. There is no
   connection scoping.
5. The detach is silent: the protocol sink passed to `attachments.attach` has
   `onEvent` only (`terminalService/protocol.ts:449-461`), so the client keeps
   a painted checkpoint, receives nothing further, and shows "connected".

Independent secondary defects that produce the same symptom:

- `resyncPending` is set on congestion and never cleared
  (`packages/server-core/src/connection/outboundDelivery.ts:454,503`); later
  sends for that lane silently no-op.
- `outputSuppressed` is a one-way latch
  (`terminalService/protocol.ts:168-174`).
- The vendored Werift SCTP sender has no zero-window probe: its transmit loop
  requires `peerRwnd > 0` and `peerRwnd` only updates from SACKs, which only
  arrive in response to data. A peer that advertises a zero window with
  nothing in flight deadlocks outbound permanently while ICE stays
  `connected`.

## Decisions

1. **Keep the Secure-Werift runtime.** The
   [server foundation decision](../decisions/server-foundation.md) rejected
   `node-datachannel` on supply-chain grounds (statically linked EOL OpenSSL
   in prebuilds); that reasoning still holds. Fix Werift with one more audited
   patch in the existing `selection.json` patch mechanism instead of switching
   runtimes.
2. **Delete the `node-datachannel` code path.** It is never constructed in
   production (neither `apps/terminay-server/src/cli.ts` nor
   `electron/remote/serverOwnedExposure.ts` passes `nodeDataChannel` options)
   and the runtime policy hard-disables fallback. The decision record keeps
   the audit history; the live tree does not keep the implementation.
3. **Liveness is an explicit heartbeat, not traffic inference.** All
   PTY-quietness/stall classification (host `no-outbound`/`outbound-stalled`,
   client `inbound-stalled`/`no-inbound`) is deleted. A frozen transport is
   detected by a missed application-protocol ping, deterministically.
4. **One live connection per device.** A successful `device-join` or pairing
   join replaces any existing peer and server connection for that device id,
   old-closed-before-new-accepted. Zombies die at join time, on purpose.
5. **Connection lifecycle is scoped by connection, not by device.** Closing a
   connection releases only that connection's attachments, subscriptions,
   leases, and checkpoints. `clientId`/device id remains the identity for
   authentication, permissions, revocation, and presentation-lease
   arbitration.
6. **Required-lane close hangs up the peer again.** With rejoin replacement
   and heartbeat in place, the false-positive sources are gone, so a
   `control`, `application`, `terminal`, or `assets` channel leaving `open`
   after handshake is a real generation failure again. The heartbeat is the
   backstop for the half-open case where no close event ever fires.
7. **Authentication and signing are untouched.** The transcript, host-key,
   pairing-authenticator, and DTLS-endpoint binding design stays exactly as
   specified.

## Scope

In scope: `packages/server-core` connection/terminal lifecycle,
`apps/terminay-server/src/remote` hosted pairing host and peer lifecycle,
`electron/remote` exposure wiring, `src/web` + `src/remote` client recovery,
the vendored Werift artifact patch set, and the specs listed below.

Out of scope: pairing/enrollment flows, device revocation, signed transport
transcripts, the UI archive transfer, signaling room protocol.

## Implementation slices

### Slice 1 — connection-scoped teardown (server-core) — DONE

- Give every accepted connection a unique `connectionId` visible to the
  operation registries (it already exists on `ServerConnectionLike`).
- Change `ServerConnection.cleanupConnection` to report
  `onConnectionClosed(connectionId, clientId)`.
- Change `terminalOperations.closeClient` to `closeConnection(connectionId)`:
  protocol attachments record the owning `connectionId` at attach time and are
  released only when **their** connection closes. Presentation leases,
  checkpoints, and input sources keep device-scoped semantics but are released
  through the closing connection's own attachments, never by scanning all
  attachments for a device id. Apply the same change to
  `macroOperations.closeClient` and `fileObservations.closeClient`.
- Event-subscription routing (`matchesEvent`) additionally filters terminal
  presentation events by attachment ownership so a second connection for the
  same device never receives (or buffers) another connection's terminal lane.
- Regression test: connection A (device X) attaches a terminal; connection B
  (device X) attaches the same terminal; A's transport fails; B continues to
  receive live PTY events and keeps its lease.

### Slice 2 — join-replaces and simplified peer lifecycle (hosted host) — DONE

- Track live peers as `Map<deviceId, PeerHandle>` (pairing joins key on the
  enrolling room until a device id exists). On `device-join` for device X:
  close X's existing peer and await its server connection cleanup **before**
  creating the new peer. Delete `HostedGenerationSet`.
- `HostedPeerLifecycle` keeps only: terminal peer/ICE state → fail; ICE
  `disconnected` grace timer (unchanged semantics); required-lane close →
  fail; explicit close (user disconnect, revocation, replacement).
- Delete `shouldFailHostedStall`, `laneCloseHangsUp`,
  `applyHostedLaneDiagnostic`, `APPLICATION_STALL_FAIL_GRACE_MS`, and the
  stall-classification half of `hostedStreamDiagnostics` (`stallClass`,
  `stallIgnored`, `liveGenerationCount`, repeat-suppression state). Keep
  peer/ICE state transitions, channel state, frame/byte counters, and close
  reasons; add close reasons `replaced-by-rejoin` and `heartbeat-timeout`.
- Wire the `application` channel close to the same lifecycle fail path instead
  of the current log-only handler at `hostedPairingHost.ts:1180-1182`.

### Slice 3 — heartbeat (both sides)

- Add a `connection.ping` operation to the server-core operation registry
  (echo, no payload beyond a client timestamp; metadata-only).
- Workspace client sends `connection.ping` every 10 seconds on the live
  generation. Two consecutive misses (no response within the interval) retire
  the generation and enter the existing reconnect state machine.
- Server closes a connection with no inbound application frames for 60
  seconds (`heartbeat-timeout`). This reaps half-open transports that never
  fire a close event.
- Delete `createSessionSilenceWatch`, `classifySessionApplicationSilence`,
  `SessionApplicationStallClass`, and the silence-recovery branches in
  `src/web/main.tsx` / `SessionConnectGate.shouldRecoverFromSilence`.
  Recovery triggers become exactly: transport/generation failure, required
  lane close, heartbeat miss, ICE grace expiry.

### Slice 4 — terminal lane correctness — DONE

- Give the protocol attachment sink an `onClose`, and deliver an explicit
  `terminal.attachment-closed` (resync-required) event on the control class
  when an attachment is detached for any reason other than the client's own
  `terminal.detach`. The client responds by re-attaching from a fresh
  checkpoint — same path as congestion resync.
- Clear `resyncPending` when the resynchronizing attachment is replaced (and
  on `releaseTerminal`); assert in tests that a lane congests, resyncs, and
  streams again on the same connection.
- `outputSuppressed` ends when the replacement attachment attaches; a
  suppressed attachment that is never replaced is closed with the explicit
  event above rather than staying silently mounted.
- Keep the 30-second `waitForWritable` backpressure failure: with Slices 1–3
  it now fails only the offending connection and the client recovers via
  heartbeat/close, so it is a correct last-resort bound.

### Slice 5 — deletions (dead code and superseded tests) — DONE

Scope narrowed during implementation, with evidence:

- Deleted `apps/terminay-server/src/remote/nodeDataChannelHost.ts` and
  `secureWeriftHost.ts` plus the optional headless-host wiring in
  `serverExposure.ts`. That wiring was unreachable — neither `cli.ts` nor
  `electron/remote/serverOwnedExposure.ts` ever passed `nodeDataChannel` or
  `createHeadlessHost`, so `nodeDataChannelHost` was permanently `undefined`
  and `connectHeadless` always threw. Their only consumers were tests,
  including the orphaned `scripts/task20-outage-signaling.test.mjs` (not
  referenced by any CI script), which is deleted with them.
- **Kept** `nodeDataChannelPeer.ts`, `nodeDataChannelRuntime.ts`, and
  `secureWeriftPeer.ts`: `electron/remote/desktopWebRtcTransport.ts` and
  `desktopWebRtcBootstrap.ts` import them for the Desktop→remote-server
  client, so they are live code, not dead weight.
- **Kept** `packages/server-core/src/remote/headless.ts`. `exposure.ts` types
  its injectable host seam against `RemoteHeadlessSessionHost`, and the module
  also defines `HeadlessDataChannel`, which the live WebRTC transport uses.
  Removing the factory would be a large refactor unrelated to this failure.

Pre-existing defect found while tracing this and deliberately left alone —
it is a different failure from the one this task fixes, and fixing it here
would widen the change: `desktopWebRtcTransport.ts` defaults to
`loadNodeDataChannelRuntimeModule()`, which imports `node-datachannel`. That
package is not a dependency of this repo, so Desktop's outbound WebRTC client
to a remote server cannot start a runtime. `createSecureWeriftCompatibilityModule`
in `secureWeriftPeer.ts` is the Werift-backed adapter that path should use.
Worth its own task.
- Delete superseded tests: `hosted-generation-set.test.mjs`,
  `hosted-hydrated-checkpoint-silence.test.mjs`,
  `scripts/web-session-silent-pty-reconnect.test.mjs`, and the
  node-datachannel spike/compat tests. Replacements are named in Slice 7.
- Move tasks 68–73 context notes into this task's history trail; their
  behaviours are superseded by this contract.

### Slice 6 — Werift zero-window probe patch

- Add `scripts/patches/werift-0.24.1-zero-window-probe.patch` to the vendored
  artifact and `selection.json` (same integrity process as the existing
  TURN-refresh patch): when the peer's advertised window is zero and nothing
  is in flight, transmit one probe chunk and run the T3 timer (RFC 4960 §6.1
  rule A) so a reopened window is discovered without waiting for a SACK that
  will never come.
- While patching, add a reentrancy guard to `dataChannelFlush` (concurrent
  flush loops share one queue today).
- Extend the runtime-proof evidence with a two-peer test that drives the
  receiver window to zero and proves outbound resumes.

### Slice 7 — tests and acceptance

- Server-core: the Slice 1 regression test (two connections, one device, old
  one fails late) — this is the exact production bug and must be the first
  test written.
- Hosted host: rejoin replaces the previous peer (old connection closed
  before new accept); required-lane close fails the generation once; no stall
  events exist.
- Heartbeat: client misses two pings → one reconnect attempt; server reaps a
  connection with 60 s of inbound silence; a healthy quiet terminal (no PTY
  output for minutes) stays connected through pings alone.
- Terminal lane: congest → explicit resync event → re-attach → live stream
  resumes, on one connection, twice in a row (proves latches clear).
- E2E (real Chromium client against the hosted host): reconnect during
  sustained PTY output; the replacement hydrates a checkpoint and then shows
  new output within the heartbeat bound; repeat three cycles.

## Definition of done

- [x] A reconnect from the same device can never stop the replacement
      connection's live stream (Slice 1 regression test passes).
- [ ] `device-join` replaces the previous peer for that device; at most one
      live connection per device exists on the host.
- [ ] All stall/silence classification code is deleted on host and client;
      liveness is ping-based; recovery triggers are the four explicit signals.
- [x] Attachment detach is always observable by the client; no code path
      leaves a painted checkpoint with a silently dead stream.
- [x] `resyncPending` and `outputSuppressed` provably clear; congestion
      recovery works repeatedly on one connection.
- [ ] node-datachannel and secure-werift wrapper code paths are gone; the
      build, packaged runtime proof, and CI stay green.
- [ ] The Werift artifact carries the zero-window-probe patch with updated
      hashes and evidence.
- [ ] `specs/features/remote-access.md` and
      `specs/features/terminal-stream-congestion-and-recovery.md` describe
      only the new contract (updated with this task).
