# Embedded Desktop remote exposure

## Goal

Make **Expose this server…** expose the canonical embedded Local server, and
make every Desktop build report transport availability honestly before the
user starts exposure.

Governing features:

- [Remote access](../features/remote-access.md)
- [Connections and client hosts](../features/connections-and-client-hosts.md)
- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)

## Current gap

The connection menu currently projects the server-owned pairing lifecycle but
does not compose an embedded LAN protocol listener. WebRTC Relay is displayed
as ready even though Desktop main deliberately throws before exposure because
the authenticated hosted per-peer signaling registrar has not been supplied.
The completed Task 17 record describes that production activation as an
external follow-up, so its historical completion must not be interpreted as a
working Desktop exposure path.

## Implementation slices

- [x] Bind explicit Local Network exposure to the embedded Local
  `ServerCore`, using the configured interface/port and TLS policy without
  constructing a second server authority.
- [x] Serve the canonical framed application stream plus one-time pairing,
  PIN validation, device enrollment, reconnect challenge/completion, and
  bounded credential handling from that listener.
- [x] Couple listener start/stop/rotation atomically to the server-owned
  exposure lifecycle; bind, TLS, or protocol startup failure must publish no
  usable pairing URL.
- [x] Persist only the permitted embedded device/reconnect records beneath the
  Desktop data root and restore them against the exact server identity and
  origin.
- [x] Add explicit per-mode availability to the Desktop status/host contract.
  The menu disables start/QR actions and says **Unavailable in this build**
  when a mode lacks its complete privileged composition.
- [ ] Compose the integrity-pinned Werift runtime in packaged and development
  Desktop builds only when the same authenticated hosted registrar supplies
  both room registration and per-peer SDP/ICE signaling.
- [ ] Update `npm run dev` to stage/select the approved runtime once that
  registrar contract is available; no test-only or legacy hidden-renderer
  fallback may become a production path.
- [ ] Verify real hosted WebRTC pairing, full workspace/terminal traffic,
  reconnect, revocation, exposure stop, direct ICE, and TURN-required routing
  against the deployed signaling compatibility window.

## Acceptance checks

- Starting Local Network exposure from a Local Desktop window opens exactly
  one listener at the displayed origin and a second Desktop/browser can pair,
  render the same workspace, and use an existing terminal.
- Stopping exposure closes admission/listening without terminating the Local
  workspace or its PTYs; starting again rotates one-time material.
- Incorrect PIN attempts are bounded, a consumed/rotated URL cannot be reused,
  and reconnect proof is exact-origin and exact-server bound.
- A bind/TLS failure leaves exposure stopped and publishes no pairing URL.
- A build without authenticated WebRTC composition shows WebRTC Relay as
  unavailable before click and never allocates a hosted room.
- A WebRTC-capable build passes the same full application assertions over
  direct and TURN-relayed routes without a fallback to HTTP or legacy Electron
  renderer hosting.

## Definition of done

Both Local Network and WebRTC Relay satisfy the acceptance checks in supported
Desktop builds, focused Node tests cover lifecycle/security failures, and a
real hosted E2E records the deployed signaling/runtime compatibility evidence.
Until then this task remains active and the UI must not describe the missing
mode as ready.
