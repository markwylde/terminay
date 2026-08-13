# WebRTC transport recovery acceptance

## Goal

Make real transport failure and recovery a release-blocking, native WebRTC
contract. Prove that automatic recovery and Retry restore the mounted workspace
and exact ordered terminal input without page reload, duplicate effects, or
silent inert state.

## Governing specifications

- [Remote access](../features/remote-access.md)
- [Terminal stream congestion and recovery](../features/terminal-stream-congestion-and-recovery.md)
- [Connections and client hosts](../features/connections-and-client-hosts.md)

## Dependencies

- [Task 41: Single-owner WebRTC transport generations](../tasks_completed/41-single-owner-webrtc-transport-generations.md)
- [Task 42: Unified renderer connection recovery](../tasks_completed/42-unified-renderer-connection-recovery.md)

## Evidence boundary

Repository implementation can complete deterministic fault injection, native
Linux scenarios available to the configured runners, Docker Electron/browser
coverage, diagnostics, and release-workflow gates. Linux arm64 native evidence,
physical iOS Safari evidence, branch-protection activation, coordinated artifact
publication, and deployed-origin verification remain unchecked until those
external systems produce revision-bound evidence. A local substitute, emulated
browser, or workflow source assertion cannot mark those outcomes complete.

## Historical failure and permanent reproduction

The former browser convergence test used Local Network pairing and fell back to
`WebSocketByteTransport`; it did not exercise WebRTC. The production headless
WebRTC proof covered pairing and a full page reconnect, but not failure of a
mounted page. Its clean Linux wrapper also omitted the application build, so it
could fail before loading the claimed production renderer.

The investigation extends the real Chromium plus plain-Node
`node-datachannel` path to:

1. pair and authenticate all native WebRTC lanes;
2. send a sustained human-paced per-character sequence in exact order;
3. reload through the saved-session bootstrap;
4. close only the application lane while the peer remains connected;
5. type the next character and observe `client is not connected`;
6. click **Retry connection**; and
7. send a post-Retry sequence.

The original production build failed step 7: Retry started and its initial
error presentation cleared, but the post-Retry sequence never reached the PTY.
The native matrix is now green for all four required-lane failures and peer
closure; remaining unchecked cases below are additional release evidence, not
permission to weaken that permanent reproduction.

A later production reproduction exposed a distinct split-brain case that the
required-lane matrix did not cover: the server-side application-protocol reader
ended while the native WebRTC peer and application data channel remained open.
The server discarded the application client, but the host continued to present
the transport as connected. Terminal renewal then surfaced
`terminal presentation renewal failed: client is not connected`, and Retry
reused or waited behind the stale generation instead of creating a usable one.
This protocol-only failure is now part of the permanent reproduction and must
be fixed at the generation ownership boundary, not suppressed in terminal UI.

## Implementation slices

### Deterministic native failure matrix

- [ ] Treat server application-protocol reader completion/failure as failure of
  the whole host-owned transport generation even when the native peer and every
  required data channel remain open.
- [ ] Deliver that failure once, with the exact generation identity, to the
  unified renderer recovery controller; retire the stale application client,
  peer, lanes, subscriptions, and attachments before replacement begins.
- [ ] Ensure automatic recovery and manual Retry create a fresh host generation
  rather than consulting, awaiting, or reusing the stale peer/channel state.

- [x] Keep the clean Linux native proof self-contained: build workspace
  packages and the production application, install the selected prebuilt
  runtime, run without DISPLAY/Wayland or compiler toolchain, and retain traces
  and screenshots on failure.
- [x] Add independent fault injection for `control`, `application`, `terminal`,
  and `assets` lane close/error while the browser peer stays connected.
- [x] Prove bootstrap-only `api` and singular `asset` lanes are closed and
  unreachable after canonical application handoff, and fault them independently
  before handoff rather than treating them as permanent mounted lanes.
  - [x] Assert both bootstrap lanes are closed after every successful mounted
    application handoff and replacement.
- [x] Cover peer and ICE disconnected-then-recovered, disconnected past grace,
  failed, closed, host shutdown, server exposure stop, and device revocation.
  - [x] Prove required-lane replacement closes the retired native peer, an
    independently closed native peer creates exactly one replacement, and
    device revocation terminates the active application generation.
  - [x] Hold the mounted browser offline after a required-lane failure, invoke
    Retry repeatedly during backoff, restore network reachability, and prove
    the requests coalesce into one successful replacement generation.
  - [x] Bound the complete renderer generation, including terminal hydration
    and verification, so a transport which has acquired an endpoint but never
    becomes usable returns to retry-wait instead of trapping Retry behind an
    indefinitely in-flight generation. Prove the timed-out candidate retires
    before one manual Retry activates a fresh generation.
  - [x] Assert one replacement generation per fault, six created/two retired
    bootstrap/four open required lanes, one application connection, one PTY,
    and one canonical project, panel, and terminal session.

### End-to-end correctness

- [x] Prove automatic recovery restores the mounted workspace without
  navigation, enrollment UI, profile loss, duplicate project/panel/session, or
  duplicate command.
- [x] Send unique human-paced, burst, paste, Unicode, escape-sequence, and
  newline-delimited inputs before, across, and after recovery. Assert exact PTY
  byte order and exactly-once delivery for every input with known outcome.
- [x] Force an unknown terminal-input outcome, prove the active queue closes and
  discards both already-queued and later input, and prove attaching a replacement
  cannot replay any of it (`scripts/terminal-panel-input-queue.test.mjs`). The
  current terminal-input contract does not expose its generated command id to the
  panel and the server command ledger is connection-scoped; therefore it does not
  support a reconnect-safe idempotent result query. Never infer or blindly replay
  the uncertain terminal mutation.
  - [x] In the native required-lane, peer-close, and offline/Retry matrix,
    assert the browser and canonical server retain the exact workspace revision,
    active project, panel, terminal session, and single PTY across every
    replacement.
  - [x] Assert the mounted xterm row geometry equals the canonical terminal
    dimensions, the PTY received that exact resize, retained output remains
    painted, the replacement owns writable presentation control, and new
    canonical output reaches both the server output head and mounted xterm.
  - [x] Prove a terminal created immediately after replacement actively
    reconciles the authoritative workspace even when its change notification is
    lost, and completes only after the same snapshot contains its session and
    terminal panel (`scripts/workspace-delta-reconciliation-runtime.test.mjs`).
- [x] Prove explicit browser refresh independently recreates the bootstrap and
  remains supported without being required by Retry.

### Diagnostics and release evidence

- [x] Record metadata-only first-failure evidence containing opaque profile,
  transport generation, lane label, peer/ICE state, lifecycle phase, attempt,
  close reason, and outcome. Record no terminal bytes, paths, credentials, SDP,
  ICE candidates, or signaling secrets.
- [x] Replace broad `client is not connected` recovery diagnostics with the
  typed lifecycle state while preserving safe user-facing language.

## Cleanup of superseded evidence

- [x] Remove or rename tests whose descriptions claim WebRTC recovery while
  their runtime selects WebSocket or only reconnects after page close.
  The remaining WebSocket/browser-restart tests describe only their actual
  transport or page lifecycle; native WebRTC recovery claims are confined to
  the native failure matrix.
- [x] Update Task 23 and Task 29 evidence links so deployed exposure and
  browser-host convergence consume this matrix instead of duplicating partial
  reconnect scenarios.
- [x] Preserve the completed transient ICE-grace task as historical evidence;
  do not reinterpret it as proof of required-lane replacement.

## Acceptance checks

- Every required-lane and peer failure either recovers automatically or reaches
  a typed terminal state; no mounted workspace is silently inert.
- Application-protocol reader termination is detected even while the native
  peer and application lane remain open, and follows the same single-owner
  generation replacement lifecycle.
- Retry creates a fresh native WebRTC generation and post-Retry terminal input
  arrives exactly once and in order without `location.reload()`.
- Normal sustained typing does not close the transport, reorder characters, or
  create multiple concurrent application commands.
- Local Desktop, another browser, and server-owned PTYs remain unaffected when
  one browser generation fails or retries.
- Linux x64/arm64, selected runtime, Docker Electron/browser, and staged iOS
  evidence all identify the exact tested source/artifact revisions.

## Definition of done

The permanent reproduction is green only because a fresh host-owned transport
and unified renderer controller recover it; the full native failure matrix is a
required release gate, deployed iOS behavior is verified, and all misleading
or weaker recovery evidence has been removed.
