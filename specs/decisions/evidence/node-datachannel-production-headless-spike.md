# `node-datachannel` production headless integration evidence

Date: 2026-07-27

This is candidate evidence for
[Server architecture decision spikes](../../tasks_completed/3-server-architecture-decision-spikes.md).
It does not select the WebRTC runtime or close the complete Headless WebRTC
gate. The published `node-datachannel@0.32.3` native artifacts have a
[documented supply-chain selection blocker](node-datachannel-native-supply-chain.md).
This integration remains API and product-behaviour evidence, not approval to
ship those artifacts.

## Scope

The executable proof runs the production `RemoteAccessService` and production
WebRTC host coordinator in a displayless plain-Node process using
`node-datachannel@0.32.3`. It starts the sibling hosted signaling server and
loads that server's real bundled browser client in Chromium. Chromium is the
remote client under test; Electron, Chromium, and a display server are absent
from the Terminay host process.

The proof uses the sibling hosted-service worktree at:

```text
/Users/mark/Documents/Projects/terminay/terminay.com-headless-webrtc-security
```

That worktree contains the matching reconnect protocol and browser-client
hardening. The sibling main clone remains unchanged.

## Production surfaces under test

- `electron/remote/service.ts`: production pairing, authorization, reconnect,
  revocation, terminal routing, and hosted-asset service.
- `src/remote/WebRtcHost.tsx`: production offer/answer/ICE coordinator and the
  exact `api`, `asset`, and `terminal` data channels.
- `e2e/support/hosted-server.ts`: real sibling HTTPS and WebSocket signaling
  server.
- sibling `app/src/main.js` and `app/src/protocol.js`: real browser bootstrap,
  device-key storage, signed signaling, asset installation, and reconnect.
- sibling `server/signaling.js`: production relay message validation and
  routing.

`WebRtcHost` accepts explicit runtime dependencies. The default browser
dependencies remain unchanged, while the proof injects the
`node-datachannel` peer implementation and the production preload-shaped API.
This isolates the transport adapter without replacing the product protocol.

## Executable proof

The Playwright integration is:

```text
e2e/webrtc-headless-node-host.spec.ts
```

The isolated wrapper is:

```text
scripts/production-headless-webrtc-node-datachannel.test.mjs
```

The wrapper creates a fresh temporary npm project, installs exactly
`node-datachannel@0.32.3`, runs the production integration, requires natural
process exit, and removes the temporary project. It does not add the native
runtime to the root package dependencies.

The integration proves:

- the production service advertises a one-time session URL and pairing room;
- the browser supplies the desktop PIN and generates an origin-bound RSA-PSS
  device key;
- production device pairing and authorization complete;
- signed offers, answers, and ICE candidates pass through the real hosted
  signaling server;
- the peer exposes exactly `api`, `asset`, and `terminal` channels;
- browser terminal input reaches the real remote service, and initial terminal
  output reaches the browser;
- the real bundled UI asset manifest and asset bodies install after length and
  SHA-256 verification;
- the browser closes and reconnects from its saved grant without the original
  QR fragment;
- reconnect requires both an HMAC grant proof and an RSA-PSS signature from
  the paired device private key;
- reconnect signaling uses a fresh HKDF-derived HMAC key bound to the complete
  authorization context;
- relay messages contain neither a reconnect grant nor a signaling bearer
  token;
- reconnect offer signatures bind the attempt, protocol version, opaque
  reconnect handle, saved-session expiry, session id, message type, nonce, and
  SDP;
- an invalid signature does not reserve its nonce, while an exact verified
  replay is rejected;
- revocation closes the active connection and rejects later authorization and
  reconnect attempts; and
- the wrapper and child test process exit naturally after explicit cleanup.

## Per-transfer pressure evidence

Production asset delivery uses 64 KiB Base64 chunks, a four-chunk application
acknowledgement window, and one active asset request per peer. The browser
installer requests the manifest and each asset sequentially, so one request
supports the current product flow without allowing request IDs to multiply the
window. The derived per-peer ceiling is 262,144 unacknowledged Base64 body
characters. Each transfer has a 15-second acknowledgement timeout and supports
explicit browser cancellation. A unit integration confirms that:

- a ten-chunk asset never exceeds four unacknowledged chunks;
- an API request completes while the asset transfer remains active; and
- cancelling a stalled transfer after four chunks stops further sends;
- twelve excess concurrent IDs are rejected without additional asset reads or
  chunks; and
- API and terminal traffic still progress under that admission pressure.

The production browser integration exercises this acknowledgement protocol
with the real hosted bundle. Separate concurrent-host evidence in
`scripts/webrtc-headless-resource-limits.test.mjs` covers twelve coordinators,
per-peer and aggregate acknowledgement bounds, API and terminal progress,
relay loss, peer crash, revocation, listener cleanup, and deterministic peer
closure. That synthetic multi-peer proof does not establish a server-wide
peer admission limit or native-runtime capacity.

## Reproduction

From the Terminay architecture worktree:

```sh
npm run test:spike-production-headless-webrtc
```

Observed result on 2026-07-27:

```text
tests 1
pass 1
fail 0
```

The focused production security and transfer checks are:

```sh
node --test \
  scripts/device-keys-indexeddb.test.mjs \
  scripts/reconnect-grant-store.test.mjs \
  scripts/webrtc-host-revocation.test.mjs \
  scripts/webrtc-service-runtime.test.mjs
```

Observed result:

```text
tests 24
pass 24
fail 0
```

From the sibling hosted-service worktree:

```sh
npm run test:app
```

Observed result:

```text
tests 70
pass 70
fail 0
```

## Open gates

- The complete production flow has not yet run inside clean Linux Node 22 x64
  and arm64 environments. The lower-level native candidate proof covers both
  artifact architectures, with x64 under architecture emulation.
- The production integration configures STUN but does not measure the selected
  candidate pair, so it is not evidence that STUN supplies the selected route.
- An authenticated TURN-only production route with structured ICE credentials
  remains unproved.
- Hostile NAT, relay interruption during an established native session, and
  native multi-peer CPU, memory, file-descriptor, and throughput limits remain
  unmeasured.
- A server-wide peer admission ceiling remains unspecified.
- The same adapter has not yet run under Electron supervision.
- The `sendMessageBinary()` Boolean semantic caveat recorded in
  [the lower-level candidate evidence](node-datachannel-headless-spike.md)
  remains unresolved.
- The published `node-datachannel@0.32.3` prebuilds fail the native dependency
  security gate. A maintained alternative or a reproducible source-built
  dependency set with current DTLS/TLS components must satisfy the same
  integration before runtime selection.

These gaps keep the runtime-selection and full Headless WebRTC task boxes
open.
