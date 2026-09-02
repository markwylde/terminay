## Context

The reported failure was a remote session that connected, hydrated, and then
froze while reporting itself connected. Tracing it produced a precise cause
chain rather than a WebRTC state-handling defect:

1. The hosted pairing host accepts every application connection with
   `clientId: ticket.deviceId`. The device id is stable across reconnects, so a
   reconnect creates a second server connection with the same `clientId` while
   the previous one is still alive.
2. Old peers were no longer closed on rejoin or on lane close: the
   lane-close-hangs-up and hosted-stall predicates were hard-coded false, and the
   hosted generation set only appended. The zombie connection lingered.
3. Event routing matched on `clientId`, so the new session's terminal output was
   also pumped into the zombie's transport until its 30-second backpressure
   deadline failed it.
4. The zombie's cleanup called `closeClient(clientId)`, which detached **every**
   attachment for that device — including the healthy new connection's — and
   released its leases and checkpoints. There was no connection scoping.
5. The detach was silent: the protocol sink had `onEvent` only, so the client
   kept a painted checkpoint, received nothing further, and showed "connected".

Three independent secondary defects produced the same symptom: `resyncPending`
was set on congestion and never cleared, so later sends for that lane silently
no-opped; `outputSuppressed` was a one-way latch; and the vendored Werift SCTP
sender has no zero-window probe, so a peer advertising a zero window with nothing
in flight deadlocks outbound permanently while ICE stays `connected`.

Proposal.md records the resulting scope.

## Goals / Non-Goals

Goals:

- Eliminate the frozen-checkpoint failure at its cause, not at its symptom.
- Make the connection layer simpler, with fewer tunables, not more configurable.
- Make every liveness decision deterministic and explainable from an explicit
  signal.

Non-Goals:

- Changing authentication or signing. The transcript, host-key,
  pairing-authenticator, and DTLS-endpoint binding design is untouched.
- Pairing and enrollment flows, device revocation, UI archive transfer, and the
  signaling room protocol.
- Replacing the WebRTC runtime.

## Decisions

1. **Keep the Secure-Werift runtime.** The server foundation decision rejected
   `node-datachannel` on supply-chain grounds — statically linked end-of-life
   OpenSSL in prebuilds — and that reasoning still holds. Werift is fixed with
   one more audited patch in the existing `selection.json` patch mechanism
   instead of switching runtimes.
2. **Delete the `node-datachannel` headless host code path.** It was never
   constructed in production and the runtime policy hard-disables fallback. The
   decision record keeps the audit history; the live tree does not keep the
   implementation. The Desktop outbound peer modules are kept because the Desktop
   remote-server client imports them, and `headless.ts` is kept because the
   exposure seam types against it and the live WebRTC transport uses its data
   channel type.
3. **Liveness is an explicit heartbeat, not traffic inference.** All PTY-quietness
   and stall classification — host `no-outbound` and `outbound-stalled`, client
   `inbound-stalled` and `no-inbound` — is deleted. A frozen transport is
   detected by a missed application-protocol ping.
4. **One live connection per device.** A successful `device-join` or pairing join
   replaces any existing peer and server connection for that device id,
   old-closed-before-new-accepted. Zombies die at join time, on purpose.
5. **Connection lifecycle is scoped by connection, not by device.** Closing a
   connection releases only that connection's attachments, subscriptions, leases,
   and checkpoints. The device id remains the identity for authentication,
   permissions, revocation, and presentation-lease arbitration.
6. **Required-lane close hangs up the peer again.** With rejoin replacement and
   heartbeat in place the false-positive sources are gone, so a `control`,
   `application`, `terminal`, or `assets` channel leaving `open` after handshake
   is a real generation failure. The heartbeat is the backstop for the half-open
   case where no close event ever fires.
7. **Backpressure stays a last-resort bound.** The 30-second writable deadline is
   kept: with connection scoping it now fails only the offending connection, and
   the client recovers via heartbeat or close.

## Risks / Trade-offs

- Join-replaces-peer is deliberately destructive: a second tab at the same
  session origin takes the connection over and the first shows reconnecting.
  That is the accepted cost of guaranteeing at most one live connection per
  device, and separate devices, Desktop windows, and Local connections are
  unaffected.
- A 10-second ping adds constant low-rate traffic to every live generation. It is
  metadata-only and bounded, and it replaces heuristics that produced both false
  positives and false negatives.
- Deleting stall classification removes diagnostics operators may have used.
  Peer and ICE state transitions, channel state, frame and byte counters, and
  close reasons are retained, with `replaced-by-rejoin` and `heartbeat-timeout`
  added.
- The Werift zero-window deadlock is not fixed here. The selected runtime is
  governed supply-chain material: `selection.json` pins exactly one patch by
  hash, validation asserts that shape, and the decision record requires two
  independent rebuilds producing identical hashes plus refreshed SBOM,
  provenance, and notices. Bundling an artifact change of that weight into a
  behavioural change would put an unverifiable supply-chain change inside a
  behavioural review. It is also not the cause of the reported failure, and the
  heartbeat bounds a deadlocked association into a reconnect rather than a
  permanent freeze.

## Open Questions

- A pre-existing, deliberately untouched defect was found while tracing this:
  the Desktop outbound WebRTC transport defaults to loading a
  `node-datachannel` runtime module, and that package is not a dependency of
  this repository, so Desktop's outbound client to a remote server cannot start
  a runtime. The Werift-backed compatibility adapter is what that path should
  use. It is a different failure from the one this change fixes and is left for
  its own change.
