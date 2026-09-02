## 1. One session transport host

- [x] 1.1 Define one runtime-validated session transport host contract for initial pairing, saved reconnect, current generation state, opaque application byte endpoint acquisition, replacement, cancellation, and terminal failure, verified by hosted contract tests.
- [x] 1.2 Bind the host to one exact session origin, server identity, profile id, device credential compartment, and browser view, rejecting another origin, source, profile, server, or retired generation, verified by rejection tests.
- [x] 1.3 Keep signaling sockets, reconnect credentials, application tickets, `RTCPeerConnection`, ICE, and all `RTCDataChannel` objects private to the session host, verified by static checks proving the server bundle receives none of them.
- [x] 1.4 Give each complete peer/channel set one monotonic generation identity named by every endpoint and lifecycle event, and verify a retired-generation endpoint cannot send, reactivate, or be returned again.

## 2. Complete-generation health and replacement

- [x] 2.1 Evaluate peer, ICE, `control`, `application`, `terminal`, and `assets` health through one state machine, verified by tests closing each required lane while the peer stays connected and asserting one terminal failure.
- [x] 2.2 Treat legacy bootstrap `api` and `asset` lanes as attempt-scoped enrollment/bundle-install resources, closed and deleted at the authenticated canonical-lane handoff, verified by their absence after handoff.
- [x] 2.3 Preserve the bounded grace period only for recoverable peer/ICE `disconnected` state, cancelling it when the generation becomes healthy and replacing immediately on failed/closed state or required-lane loss, verified by grace-period tests.
- [x] 2.4 Coalesce concurrent peer, ICE, channel, application-send, online/offline, and renderer requests into one replacement attempt with cleanup and publication exactly once per generation, verified by concurrency tests.
- [x] 2.5 Make manual Retry call the same controller, cancel its pending backoff, and start one immediate attempt without reloading the document or creating a parallel signaling room, verified by Retry tests.
- [x] 2.6 Reset peer, signaling, channel map, authentication promise, listeners, timers, and attempt-local state before acquiring replacement lanes, and verify no closed lane from the retired generation is awaited or consulted.
- [x] 2.7 Distinguish retryable offline/relay/route failures from terminal revoked, expired, stopped-exposure, explicit-disconnect, forget, and host-shutdown states, verified by state-classification tests.

## 3. Delete the split bridge model

- [x] 3.1 Replace the raw-channel `__TERMINAY_REMOTE_WEBRTC__` and separate `__TERMINAY_BROWSER_ENROLLMENT__` contracts with the one session transport host contract, verified by static checks for the removed globals.
- [x] 3.2 Delete `getChannel()`, raw `apiChannel` and `terminalChannel` access, renderer-side channel caching, and any renderer-side WebRTC transport constructor, verified by static checks.
- [x] 3.3 Delete mounted virtual-HTTP dependence on the bootstrap `api` lane and the singular `asset` compatibility lane after bundle installation, verified by post-handoff lane assertions.
- [x] 3.4 Delete the mounted-app `location.replace('/v1/')` recovery mechanism while keeping normal browser refresh entering `/v1/`, verified by static checks for the reload-as-recovery path.
- [x] 3.5 Delete duplicate reconnect timers, online listeners, credential reads, and signaling starts outside the session transport host, verified by ownership tests.
- [x] 3.6 Remove compatibility aliases, fallback globals, and old source-shape tests in the same change so an incompatible host contract fails explicitly, verified by the absence checks.

## 4. Acceptance

- [x] 4.1 Verify closing each required data lane independently while the peer remains connected retires one generation and produces one fresh authenticated endpoint without a page reload.
- [x] 4.2 Verify automatic recovery and Retry cannot create concurrent signaling rooms, peers, channel sets, application clients, or server connections.
- [x] 4.3 Verify revocation, stopped exposure, expired credentials, explicit disconnect, and host shutdown stop replacement with the correct actionable state.
- [x] 4.4 Verify the permanent native Linux matrix proves a fresh single-owner generation and exact ordered post-recovery input reaching the PTY.
