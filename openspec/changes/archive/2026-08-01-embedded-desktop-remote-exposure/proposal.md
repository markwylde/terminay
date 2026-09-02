## Why

The embedded direct-network listener and its pairing lifecycle worked, but the
UI offered direct network and WebRTC as alternate QR modes while Desktop main
deliberately refused production WebRTC because no authenticated hosted per-peer
signaling registrar had been supplied. A user could therefore choose a mode the
build could not perform, and the earlier completion record for WebRTC exposure
did not describe a working Desktop path.

## What Changes

- **BREAKING** The **QR Type: Local Network / WebRTC Relay** selector is
  replaced by one primary WebRTC **Expose this server…** lifecycle and a
  separately labelled advanced **Direct network listener** lifecycle.
- The direct listener binds to the embedded Local `ServerCore` and serves the
  framed application stream plus pairing, PIN validation, enrollment, and
  reconnect from that one authority.
- Listener start, stop, and rotation become atomic and fail closed: a bind, TLS,
  or protocol startup failure publishes no usable pairing URL.
- Desktop reports per-mode availability before the user acts, saying
  **Unavailable in this build** when a mode lacks its complete privileged
  composition.
- The integrity-pinned Werift runtime is composed as an in-process privileged
  peer in packaged and development builds, only when one authenticated hosted
  registrar supplies both room registration and per-peer SDP/ICE signaling.
- The bootstrap peer's `api`/`asset`/`terminal` channels are replaced by the
  canonical `control`/`application`/`terminal`/`assets` application session
  after device authentication.
- Exposure surfaces label the non-secret **Server/session origin** separately
  from the consumable **Pairing link** secret.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `remote-access`: WebRTC exposure of the embedded server becomes the primary
  route, with an independently controlled advanced direct listener and honest
  per-mode availability.
- `connections-and-client-hosts`: exposure presentation, pairing-link handling,
  and the **Add connection…** action on a receiving Desktop.

## Impact

Desktop main exposure lifecycle and status/host contract, the embedded
`ServerCore` direct listener, the privileged Werift peer and its staged
runtime, hosted room registration and per-peer signaling, Desktop data-root
persistence of device and reconnect records, and `npm run dev`, which now
builds workspace dependencies and the server-owned UI before staging and
selecting the approved runtime.
