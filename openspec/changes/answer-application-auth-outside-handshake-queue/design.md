## Context

`startHostedPairingHost` owns one `createHandshakeJoinQueue()` chain. Joins
(`addHandshakePeer`), answers, and ICE candidates (`applyHandshakeSignal`) are
enqueued on it so two offers never interleave. The 2026-09-02 change passed
that same chain into the peer context as `serialize` and wrapped ticket
consumption in `bindControl` with it, so that the previous live peer for a
device is retired only after the replacement consumed a ticket, and so two
peers for one device cannot race that takeover.

The cost is that the `application-authenticated` reply now waits for every
task ahead of it, including `await peer.addIceCandidate(candidate)` for
trickle candidates arriving after DTLS is already connected. In production
against the deployed relay this starved the reply on three consecutive browser
pairings while the iPhone, whose auth happened to be queued earlier, kept
working. The 15 s client budget is the only thing that ends it.

Boundary crossed (ADR-0011): Server ↔ remote device/WebRTC. The security
properties from ADR-0013 (authentication before displacement, peer-bound
tickets) are unchanged; only the scheduling of the reply changes.

## Goals / Non-Goals

**Goals:**

- Answer `application-auth` within the client's budget regardless of
  handshake signaling activity.
- Keep the "replacement attaches only after the previous peer's cleanup"
  ordering, scoped to one device.
- Reproduce the starvation deterministically in a unit-level test.

**Non-Goals:**

- Changing ICE handling, werift, or the join queue's ordering for signaling.
- Any change to the relay, shell, Desktop client, or protocol contract.

## Decisions

### D1. Ticket consumption and the reply leave the join queue

`bindControl` consumes the ticket and sends `application-authenticated`
synchronously in the control-lane message handler, exactly as it did before
the 2026-09-02 change. The `serialize` field is removed from `HostContext`.

### D2. Replacement is ordered by a per-device chain

`hostedPeerLifecycle.ts` gains `createDeviceReplacementChain()`, a map of
device id to a promise chain. After a successful consume, `bindControl` runs
`livePeers.close(deviceId)` then `acceptAuthenticatedApplication` inside that
device's chain. Two peers for the same device still take over in order; peers
for other devices and all signaling never wait. The chain entry is dropped
when it drains so the map cannot grow with device ids.

Alternative considered: a single dedicated auth queue separate from the join
queue. Rejected because one slow replacement for device A would still delay
device B's attach; per-device is the smallest scope that keeps the guarantee.

### D3. Injectable runtime for a deterministic reproduction

`HostedPairingHostOptions` gains an optional `loadRuntime` used only by tests.
Production callers do not pass it, so the integrity-verified artifact path is
unchanged. The starvation test supplies a fake `RTCPeerConnection` whose
`addIceCandidate` returns a promise that never settles and whose data
channels are in-memory. It sends `client-join`, an answer, one ICE candidate,
then `application-auth` with a valid ticket, and asserts the reply arrives
within 2 s. On the current code that assertion times out; with D1 it passes.
The loopback test also gains a late trickle candidate before `application-auth`
so the real runtime path is covered too.

## Risks / Trade-offs

- [A slow `addIceCandidate` still blocks later joins and answers] → Unchanged
  from before the regression; it only affects handshakes, which have their own
  60 s timeout, never an authenticated peer.
- [Fake runtime drifts from werift's shape] → The fake implements only the
  surface `startPeer` calls, and the loopback test keeps the real runtime
  covered.

## Migration Plan

Single server-side patch; no data or contract migration. Deploy with the next
Desktop and standalone build. Rollback is reverting the commit.

## Open Questions

None. No in-force ADR needs revisiting; ADR-0013's "authentication precedes
displacement" holds because the replacement chain still runs after a consumed
ticket.
