# Standalone remote transport status

The standalone server now exposes one authenticated framed application stream
for browser and Desktop remote clients. The transport is WebSocket, but the
application protocol is the same `ByteTransport`/`ServerConnection` path used by
local Desktop.

What exists:

- `ServerRemoteExposure` owns one-time pairing rooms, expiry, origin binding,
  replay protection, device records, and the optional headless WebRTC host.
- `LocalUiServer` serves static UI assets, pairing/reconnect bootstrap routes,
  and `/protocol/stream`. The stream upgrade authenticates the bootstrap token
  or reconnect credential, then delegates directly to the canonical
  `ServerCore.accept()` framed connection.
- `NodeDataChannelHeadlessHost` maps four authenticated WebRTC data channels
  into the server-core transport contract.

The old HTTP/SSE application routes are intentionally not active application
protocol paths. `/protocol/query`, `/protocol/command`, and
`/protocol/events/subscribe` must not be reintroduced for workspace, terminal,
settings, files, git, activity, AI, macro, or recording operations.

## Recommended next patch

1. For hosted WebRTC, add a concrete signaling client/relay adapter that
   satisfies `NodeDataChannelSignaling`, including signed offer/answer/ICE,
   expiry, origin/server binding, and cleanup. Then compose it from the
   standalone CLI and publish the matching bootstrap contract.
2. Keep the client, server, and hosted bootstrap schema aligned in one focused
   integration test before publishing a GHCR image. A health check or pairing
   JSON line alone is not a connection test.

## Desktop production-composition preflight

The local Desktop boundary is ready to consume—but does not invent—the hosted
adapter. A production implementation must provide all of these together:

- `AuthenticatedHostedSignalingRoomRegistrar.register`, retaining the existing
  compact-room registration, expiry, and close contract in
  `electron/remote/hostedSignalingRegistration.ts`;
- `AuthenticatedHostedSignalingRoomRegistrar.createSignaling`, returning the
  exact `NodeDataChannelSignaling` contract from
  `apps/terminay-server/src/remote/nodeDataChannelPeer.ts` (`send`,
  `onMessage`, bounded `sign`, and authenticated `verify`) for an already
  admitted server/project/session/device context;
- the candidate.1 selected-runtime directory containing `selection.json` and
  `artifact/`. Packaged Desktop resolves this only as
  `process.resourcesPath/webrtc-runtime`; unpackaged development may provide an
  absolute `TERMINAY_WEBRTC_RUNTIME_ROOT`;
- the existing `DesktopServerOwnedExposure.secureWerift` composition option,
  with the same registrar object used for room registration and per-peer
  signaling. A mismatched authority fails before exposure.

`electron-builder.json5`, `scripts/stage-selected-secure-werift-runtime.mjs`,
and the release workflows stage the runtime layout. The pure resolver in
`electron/remote/desktopWebRtcRuntimeRoot.ts` does not activate WebRTC.
`electron/main.ts` must remain on its runtime-unavailable pre-allocation path
until the authenticated registrar above is configured; a room-only registrar
is deliberately insufficient.

### Sibling hosted relay audit (read-only)

The current sibling `terminay.com` implementation exposes the canonical
session-origin `WSS /signal` endpoint, but its pairing protocol is not the
authenticated per-peer protocol required by the registrar seam:

- host admission is `host-ready { roomId, relayJoinTokenHash, expiresAt }`,
  acknowledged by `host-registered`;
- pairing SDP is `offer`/`answer { roomId, sdp: RTCSessionDescriptionInit,
  nonce, signature }`;
- pairing ICE is `ice { roomId, candidate: RTCIceCandidateInit, nonce,
  signature }`; and
- the HMAC key is derived from the compact QR secret, with peer identity
  implicit in the room.

The required production adapter must retain that exact isolated-origin
`WSS /signal` transport boundary, but create one stream per admitted
`HeadlessWebRtcRuntimeContext`. Its authenticated wire envelope must bind every
frame to `serverId`, `deviceId`, `peerId`, and exact `sessionOrigin`:

```ts
type AuthenticatedPeerSignal =
  | {
      type: "offer" | "answer";
      serverId: string;
      deviceId: string;
      peerId: string;
      sessionOrigin: string;
      nonce: string;
      sdp: string;
      signature: string;
    }
  | {
      type: "ice";
      serverId: string;
      deviceId: string;
      peerId: string;
      sessionOrigin: string;
      nonce: string;
      candidate: string;
      mid: string;
      signature: string;
    };
```

The signer/verifier must use the externally minted, short-lived
`signalingAuthToken` from the validated `DesktopSignalingBootstrap`, sign the
stable JSON of every field except `signature` with HMAC-SHA-256, encode the
result as unpadded base64url, reject unknown fields and repeated nonces, and
stop accepting frames at `expiresAt`. The Desktop bootstrap is exactly:
`schemaVersion: 1`, `protocolVersion: "v1"`, `role: "offerer"`, the four bound
identity/origin fields, same-origin `wss://<session-host>/signal`,
`signalingAuthToken`, `expiresAt`, and bounded STUN/TURN `iceServers`.

No HTTP credential-minting route currently exists in the sibling contract.
`HostedSignalingRegistrar.register(...)` deliberately leaves that deployment
mechanism injected rather than inventing a route or credential here. Until the
sibling service implements that minting boundary and relays the exact
per-peer envelope above, its room registrar must have no `createSignaling`
member and cannot qualify as `AuthenticatedHostedSignalingRoomRegistrar`.
