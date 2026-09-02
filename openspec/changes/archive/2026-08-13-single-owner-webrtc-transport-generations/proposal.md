## Why

The mounted browser session had two recovery owners. The hosted bootstrap owned the
`RTCPeerConnection` and a mutable named-channel map while the embedded renderer owned another
reconnect loop and reached channels through a global bridge. The bootstrap reacted to peer
`failed` and `disconnected` state but not to a single required channel closing while the peer
stayed connected, so Retry reused the same closed lane and only reloading the document reset it.

## What Changes

- **BREAKING** Replace the raw-channel `__TERMINAY_REMOTE_WEBRTC__` bridge and the separate
  `__TERMINAY_BROWSER_ENROLLMENT__` contract with one runtime-validated session transport host
  contract exposing an opaque application byte endpoint.
- Give each complete peer and channel set one monotonic generation identity; a retired
  generation's endpoint cannot send, reactivate, or be returned again.
- Evaluate peer, ICE, `control`, `application`, `terminal`, and `assets` health through one state
  machine, treating loss of any required lane as terminal failure of that generation even while
  the peer remains connected.
- Treat bootstrap `api` and `asset` lanes as attempt-scoped enrollment and bundle-install
  resources, closed and deleted at the authenticated canonical-lane handoff.
- Coalesce concurrent peer, ICE, channel, application-send, online/offline, and renderer requests
  into one replacement attempt; make manual Retry call the same controller.
- **BREAKING** Delete `getChannel()`, raw `apiChannel`/`terminalChannel` access, renderer-side
  channel caching, renderer-side WebRTC transport constructors, duplicate reconnect timers and
  signaling starts, and the `location.replace('/v1/')` recovery mechanism.
- Distinguish retryable offline, relay, and route failures from terminal revoked, expired,
  stopped-exposure, explicit-disconnect, forget, and host-shutdown states.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `remote-access`: one session transport host owns signaling, peers, channels, credentials, and
  generation replacement, and publishes only an opaque byte endpoint.
- `connections-and-client-hosts`: the server-bundled workspace consumes only the opaque endpoint
  and lifecycle contract and holds no WebRTC authority.

## Impact

One coordinated contract change across the Terminay repository and the hosted `terminay.com`
bootstrap repository, each in a separate worktree. The hosted bootstrap owns peer and channel
generations and origin credentials; Terminay owns the opaque endpoint contract, server-side
admission, application client, and server-bundled renderer consumption.
