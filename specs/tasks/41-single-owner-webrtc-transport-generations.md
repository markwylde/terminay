# Single-owner WebRTC transport generations

## Goal

Make the exact session-origin host the sole authority for browser WebRTC
signaling, peers, required data channels, authentication, and generation
replacement. A mounted server-bundled workspace receives a fresh opaque byte
endpoint after any terminal transport failure and never owns or reuses raw
WebRTC channels.

## Governing specifications

- [Remote access](../features/remote-access.md)
- [Connections and client hosts](../features/connections-and-client-hosts.md)
- [Terminal stream congestion and recovery](../features/terminal-stream-congestion-and-recovery.md)

## Related active contract

- [Task 27: Server bundle and host contracts](./27-server-bundle-host-contracts.md)
  consumes this task's opaque endpoint and owns its bundle compatibility
  declaration; it does not own WebRTC generation recovery.

## Repositories and ownership

This task is one coordinated contract change across the Terminay repository
and the hosted `terminay.com` bootstrap repository. Each repository must use a
separate worktree. The hosted bootstrap owns peer/channel generations and
origin credentials. Terminay owns the opaque endpoint contract, server-side
admission, application client, and server-bundled renderer consumption.

## Current gap

The mounted session currently has two recovery owners. The hosted bootstrap
owns `RTCPeerConnection` and a mutable named-channel map, while the embedded
renderer owns another reconnect loop and calls `getChannel()` through a global
bridge. The bootstrap reacts to peer `failed`/`disconnected` state but not to a
single required channel closing while the peer remains connected. The renderer
can start Retry, but `getChannel()` returns or rejects the same closed lane;
only reloading `/v1/` resets bootstrap state and creates a new peer.

Initial enrollment and the mounted application also use separate global bridge
surfaces. This exposes raw `RTCDataChannel` objects to the server bundle and
splits signaling, credential, transport, and renderer-generation ownership.
Adding another callback or retry path would preserve the contradiction.

The native Linux proof now closes only the application lane while the Chromium
peer stays connected. The next key produces `client is not connected`; Retry
starts, its presentation clears, and later input never reaches the PTY.

## Architecture decisions

### One session transport host

- [x] Define one runtime-validated session transport host contract for initial
  pairing, saved reconnect, current generation state, opaque application byte
  endpoint acquisition, replacement, cancellation, and terminal failure.
- [ ] Bind the host to one exact session origin, server identity, profile id,
  device credential compartment, and browser view. Reject another origin,
  source, profile, server, or retired generation.
- [x] Keep signaling sockets, reconnect credentials, application tickets,
  `RTCPeerConnection`, ICE, and all `RTCDataChannel` objects private to the
  session host. The server-bundled application receives none of them.
- [x] Give each complete peer/channel set one monotonic generation identity.
  An endpoint and every lifecycle event name that generation; an endpoint from
  a retired generation cannot send, reactivate, or be returned again.

### Complete-generation health and replacement

- [x] Evaluate peer, ICE, `control`, `application`, `terminal`, and `assets`
  health through one state machine. Close/error of any required lane is a
  terminal failure of that generation even if the peer remains connected.
- [x] Treat legacy/bootstrap `api` and `asset` lanes as attempt-scoped
  enrollment/bundle-install resources only. Close and delete them at the
  authenticated canonical-lane handoff; they cannot remain renderer-visible or
  generation-critical after the mounted application starts.
- [x] Preserve the bounded grace period only for recoverable peer/ICE
  `disconnected` state. Cancel it when the complete generation becomes healthy;
  replace immediately for explicit failed/closed state or required-lane loss.
- [x] Coalesce concurrent peer, ICE, channel, application-send, online/offline,
  and renderer requests into one replacement attempt. Cleanup and publication
  happen exactly once per generation.
- [x] Make manual Retry call the same controller, cancel its pending backoff,
  and start one immediate attempt. It does not reload the document or create a
  parallel signaling room.
- [x] Reset peer, signaling, channel map, authentication promise, listeners,
  timers, and attempt-local state before acquiring replacement lanes. Never
  wait on or consult a closed lane from the retired generation.
- [ ] Distinguish retryable offline/relay/route failures from terminal revoked,
  expired, stopped-exposure, explicit-disconnect, forget, and host-shutdown
  states.

### Delete the split bridge model

- [x] Replace the raw-channel `__TERMINAY_REMOTE_WEBRTC__` contract and the
  separate `__TERMINAY_BROWSER_ENROLLMENT__` contract with the one session
  transport host contract.
- [x] Delete `getChannel()` from the renderer-facing surface, raw `apiChannel`
  and `terminalChannel` compatibility access, renderer-side channel caching,
  and any renderer-side WebRTC transport constructor.
- [x] Delete mounted virtual-HTTP dependence on the bootstrap `api` lane and
  singular `asset` compatibility lane after bundle installation. Do not carry
  six permanent lanes merely to preserve the old bridge.
- [x] Delete the mounted-app `location.replace('/v1/')` recovery mechanism.
  Normal browser refresh still enters `/v1/`, but automatic and manual
  recovery replace the transport in-page.
- [x] Delete duplicate reconnect timers, online listeners, credential reads,
  and signaling starts outside the session transport host.
- [x] Remove compatibility aliases, fallback globals, and old source-shape
  tests in the same change. An incompatible host contract fails explicitly;
  no legacy bridge remains in production.

## Acceptance checks

- Closing each required data lane independently while the peer remains
  connected retires one generation and produces one fresh authenticated
  endpoint without a page reload.
- Bootstrap `api` and singular `asset` lanes are absent after authenticated
  handoff; the mounted application cannot request or revive them.
- Peer/ICE disconnected-then-connected preserves a healthy generation inside
  the grace period; failed, closed, or expired grace replaces it exactly once.
- Automatic recovery and Retry cannot create concurrent signaling rooms,
  peers, channel sets, application clients, or server connections.
- Revocation, stopped exposure, expired credentials, explicit disconnect, and
  host shutdown stop replacement with the correct actionable state.
- The server-bundled renderer has no raw WebRTC, signaling, reconnect-secret,
  or per-channel authority.
- Static checks find none of the deleted bridge globals, raw-channel accessors,
  or reload-as-recovery path in production code.

## Definition of done

The hosted session has one tested transport-generation controller, the
renderer consumes only its opaque endpoint/lifecycle contract, all split bridge
and reload recovery code is deleted, and focused hosted plus Terminay contract
tests pass without compatibility shims.
