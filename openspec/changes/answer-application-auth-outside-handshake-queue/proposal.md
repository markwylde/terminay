## Why

A browser that pairs with a Desktop host now gets approved, receives its
ticket, opens all four lanes, and then sits on "Installing the workspace…"
until it fails with "Terminay did not authenticate the workspace in time".
The host never answers `application-auth`. The peer-to-peer pairing change
moved ticket consumption into the hosted host's handshake join queue, the
same queue that serialises every `setRemoteDescription` and trickle
`addIceCandidate` for every peer, so the reply now waits behind ICE work that
can take seconds or never settle once DTLS is already up. Reconnects that
happen to enqueue before their late candidates succeed; most first pairings
from a browser do not. This is a regression introduced on 2026-09-02 and it
blocks remote access for new devices.

## What Changes

- The hosted host answers `application-auth` directly from the control lane:
  ticket consumption and the `application-authenticated` reply never wait on
  handshake signaling for any peer.
- Live-peer replacement stays ordered, but per device: a small per-device
  chain retires the previous peer and attaches the replacement, and it no
  longer shares a queue with joins, answers, or ICE candidates.
- A deterministic test injects a WebRTC runtime whose `addIceCandidate` never
  settles and proves `application-auth` is still answered within the client's
  budget; the loopback proof keeps covering the real runtime.
- The hosted host accepts an injectable runtime loader for tests only; the
  production path still loads the selected, integrity-verified artifact.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `remote-access`: the reconnect sequence and one-live-connection requirements
  gain the guarantee that application authentication is answered independently
  of handshake signaling, with replacement ordering scoped per device.

## Impact

- `apps/terminay-server/src/remote/hostedPairingHost.ts`: `bindControl`,
  `acceptAuthenticatedApplication`, and the host context's `serialize` seam.
- `apps/terminay-server/src/remote/hostedPeerLifecycle.ts`: a per-device
  replacement chain beside `HostedLivePeerRegistry`.
- `apps/terminay-server/test/`: a new starvation test with an injected runtime,
  and the loopback flow test extended with a late trickle candidate.
- No relay, shell, Desktop client, or protocol change.
