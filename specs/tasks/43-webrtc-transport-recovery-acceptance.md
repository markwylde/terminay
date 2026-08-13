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

- [Task 41: Single-owner WebRTC transport generations](./41-single-owner-webrtc-transport-generations.md)
- [Task 42: Unified renderer connection recovery](./42-unified-renderer-connection-recovery.md)

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

## Implementation slices

### Deterministic native failure matrix

- [x] Keep the clean Linux native proof self-contained: build workspace
  packages and the production application, install the selected prebuilt
  runtime, run without DISPLAY/Wayland or compiler toolchain, and retain traces
  and screenshots on failure.
- [x] Add independent fault injection for `control`, `application`, `terminal`,
  and `assets` lane close/error while the browser peer stays connected.
- [ ] Prove bootstrap-only `api` and singular `asset` lanes are closed and
  unreachable after canonical application handoff, and fault them independently
  before handoff rather than treating them as permanent mounted lanes.
  - [x] Assert both bootstrap lanes are closed after every successful mounted
    application handoff and replacement.
  - [ ] Fault each bootstrap lane independently before handoff.
- [ ] Cover peer and ICE disconnected-then-recovered, disconnected past grace,
  failed, closed, host shutdown, server exposure stop, and device revocation.
  - [x] Prove required-lane replacement closes the retired native peer, an
    independently closed native peer creates exactly one replacement, and
    device revocation terminates the active application generation.
  - [ ] Inject native peer/ICE disconnected and failed states and
    distinguish within-grace recovery from past-grace replacement.
  - [ ] Exercise host shutdown and server exposure stop independently from
    device revocation.
- [ ] Cover offline/online, signaling outage, delayed host registration, failed
  authentication, failed hydration, and repeated Retry during backoff.
- [ ] Assert exact peer, lane, transport generation, application client,
  workspace subscription, terminal attachment, and PTY counts throughout.
  - [x] Assert one replacement generation per fault, six created/two retired
    bootstrap/four open required lanes, one application connection, one PTY,
    and one canonical project, panel, and terminal session.
  - [ ] Expose and assert exact server-side workspace subscription and terminal
    attachment counts without inspecting private implementation fields.

### End-to-end correctness

- [x] Prove automatic recovery restores the mounted workspace without
  navigation, enrollment UI, profile loss, duplicate project/panel/session, or
  duplicate command.
- [ ] Prove Retry starts an immediate host generation, remains visibly pending,
  and does not report connected until a real application command succeeds.
- [x] Send unique human-paced, burst, paste, Unicode, escape-sequence, and
  newline-delimited inputs before, across, and after recovery. Assert exact PTY
  byte order and exactly-once delivery for every input with known outcome.
- [ ] Force an unknown command outcome, prove later queued input is discarded,
  query the idempotent command result where supported, and never blindly replay
  the uncertain mutation.
- [ ] Prove terminal output, workspace revisions, presentation ownership,
  viewport size, confirmed render position, and checkpoint hydration converge
  after replacement.
- [x] Prove explicit browser refresh independently recreates the bootstrap and
  remains supported without being required by Retry.

### Diagnostics and release evidence

- [x] Record metadata-only first-failure evidence containing opaque profile,
  transport generation, lane label, peer/ICE state, lifecycle phase, attempt,
  close reason, and outcome. Record no terminal bytes, paths, credentials, SDP,
  ICE candidates, or signaling secrets.
- [ ] Replace broad `client is not connected` recovery diagnostics with the
  typed lifecycle state while preserving safe user-facing language.
- [ ] Run the native node-datachannel proof on Linux x64 and arm64. Run the
  selected production Werift proof through the same behavioral matrix rather
  than a separate weaker scenario.
- [ ] Add staging validation on iOS Safari that uses server-side lane fault
  injection and proves touch input, keyboard appearance, background/foreground,
  network change, Retry, and post-recovery ordered typing.
- [ ] Make the focused native matrix and Docker `npm run test:e2e` scenarios
  required CI checks. Do not accept LAN/WebSocket, stubbed peer, source-regex,
  or page-reload-only evidence as WebRTC recovery proof.
- [ ] Publish the coordinated Terminay and hosted-bootstrap revisions without
  legacy bridge shims, verify the deployed session origin, and retain immutable
  release evidence for both artifacts and the passing recovery scenario.

## Cleanup of superseded evidence

- [ ] Remove or rename tests whose descriptions claim WebRTC recovery while
  their runtime selects WebSocket or only reconnects after page close.
- [ ] Remove source-shape assertions that prove Retry wiring without exercising
  a current host-owned replacement generation.
- [x] Update Task 23 and Task 29 evidence links so deployed exposure and
  browser-host convergence consume this matrix instead of duplicating partial
  reconnect scenarios.
- [x] Preserve the completed transient ICE-grace task as historical evidence;
  do not reinterpret it as proof of required-lane replacement.

## Acceptance checks

- Every required-lane and peer failure either recovers automatically or reaches
  a typed terminal state; no mounted workspace is silently inert.
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
