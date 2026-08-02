# Embedded Desktop WebRTC exposure

## Goal

Make **Expose this server…** expose the canonical embedded Local server through
WebRTC while preserving its private Local connection, and make every Desktop
build report WebRTC availability honestly before the user starts exposure.
Keep the already-implemented direct HTTPS/WebSocket listener as a separately
controlled advanced route rather than an alternate QR mode.

Governing features:

- [Remote access](../features/remote-access.md)
- [Connections and client hosts](../features/connections-and-client-hosts.md)
- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)

## Current gap

The embedded direct-network protocol listener and its pairing/reconnect
lifecycle are implemented. The UI still presents direct network and WebRTC as
alternate QR modes, while Desktop main deliberately rejects production WebRTC
before exposure because the authenticated hosted per-peer signaling registrar
has not been supplied. The completed Task 17 record describes that production
activation as an external follow-up, so its historical completion must not be
interpreted as a working Desktop WebRTC exposure path.

[Task 27](./27-server-bundle-host-contracts.md),
[Task 28](./28-desktop-server-bundle-host-and-state.md), and
[Task 29](./29-browser-host-and-cross-version-convergence.md) own the stable
host contracts and launching the selected server's verified UI bundle after
connection. This task owns the simplified exposure/direct-listener
presentation, privileged WebRTC runtime, registrar, signaling, and real network
evidence.

## Implementation slices

- [x] Bind the explicit direct network listener (formerly Local Network) to the
  embedded Local `ServerCore`, using the configured interface/port and TLS
  policy without constructing a second server authority.
- [x] Serve the canonical framed application stream plus one-time pairing,
  PIN validation, device enrollment, reconnect challenge/completion, and
  bounded credential handling from that listener.
- [x] Make listener start/stop/rotation atomic and fail closed; bind, TLS, or
  protocol startup failure must publish no usable pairing URL.
- [x] Direct-network pairing boots the exact verified browser workspace bundle
  without requiring an impossible navigation-time Bearer header. The complete
  fragment-bearing pairing link is visible and copyable, and another Desktop
  exposes an explicit **Add connection…** action that accepts that link.
- [x] Persist only the permitted embedded device/reconnect records beneath the
  Desktop data root and restore them against the exact server identity and
  origin.
- [x] Add explicit per-mode availability to the Desktop status/host contract.
  The menu disables start/QR actions and says **Unavailable in this build**
  when a mode lacks its complete privileged composition.
- [x] Keep the private hosted-service compatibility gate explicit about its
  current boundary: real authenticated signaling, native browser WebRTC, and
  verified server-bundle installation. It must not claim canonical application
  traffic until the full WebRTC composition below is complete.
- [ ] Replace **QR Type: Local Network / WebRTC Relay** with one primary WebRTC
  **Expose this server…** lifecycle and an independently labelled advanced
  **Direct network listener** lifecycle.
- [ ] Keep the private Local transport connected and visually separate from
  both exposure routes. Neither route can rebind or replace the Local window.
- [ ] Label the non-secret value **Server/session origin** and the consumable
  secret value **Pairing link**. Copy and QR actions always use the complete
  short-lived fragment credential and expiry.
- [ ] Never start the direct listener as an implicit fallback when WebRTC is
  unavailable; show the missing runtime/registrar before the user acts.
- [ ] Compose the integrity-pinned Werift runtime in packaged and development
  Desktop builds only when the same authenticated hosted registrar supplies
  both room registration and per-peer SDP/ICE signaling.
- [ ] Update `npm run dev` to stage/select the approved runtime once that
  registrar contract is available; no test-only or legacy hidden-renderer
  fallback may become a production path.
- [ ] Verify real hosted WebRTC pairing, full workspace/terminal traffic,
  reconnect, revocation, exposure stop, direct ICE, and TURN-required routing
  against the deployed signaling compatibility window. A second Desktop and a
  browser must install the same selected-server bundle id through the Tasks
  28–29 launch paths.

## Acceptance checks

- Starting the advanced direct network listener from a Local Desktop window
  opens exactly one listener at the displayed origin and a second
  Desktop/browser can pair, render the same workspace, and use an existing
  terminal.
- Stopping WebRTC exposure closes new WebRTC admission without terminating the
  Local workspace, its PTYs, or an independently enabled direct listener;
  starting again rotates one-time material.
- Stopping the direct listener closes its network socket and admission without
  stopping WebRTC or Local.
- Incorrect PIN attempts are bounded, a consumed/rotated URL cannot be reused,
  and reconnect proof is exact-origin and exact-server bound.
- A bind/TLS failure leaves exposure stopped and publishes no pairing URL.
- A build without authenticated WebRTC composition shows WebRTC as
  unavailable before click and never allocates a hosted room.
- The primary **Expose this server…** action never starts the direct listener
  as a fallback; Local remains connected through its private transport.
- A WebRTC-capable build passes the same full application assertions over
  direct and TURN-relayed routes without a fallback to HTTP or legacy Electron
  renderer hosting.

## Definition of done

WebRTC satisfies the acceptance checks in supported Desktop builds, the direct
network listener remains independently controllable, focused Node tests cover
lifecycle/security failures, and a real hosted E2E records the deployed
signaling/runtime compatibility evidence. Until then this task remains active
and the UI must not describe WebRTC as ready.
