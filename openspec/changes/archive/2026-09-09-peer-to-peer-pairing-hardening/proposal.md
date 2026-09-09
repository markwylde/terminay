## Why

A user who pairs their phone or a second Mac with Terminay expects that only a
device holding the scanned QR code can join, that nothing in between can read
or hijack the exchange, and that the six-digit PIN they typed was worth typing.
The security audit of 2026-09-02 found that the Desktop **Add connection** path
sends the fragment-derived pairing token, the PIN, the challenge signature, and
the connection ticket over ordinary HTTPS to the session origin, which the
hosted relay terminates, and never pins the server host key; that the PIN has
no attempt limit in the server-owned host, so a fragment holder can guess it at
data-channel speed; that an unauthenticated `device-join` disconnects a live
device before the joiner proves anything; that any relay-admitted peer can pull
the UI archive and host context without a ticket; and that the server host key
every device pins is stored in plaintext with no rotation path. Together these
mean the product does not yet deliver the peer-to-peer trust model its own
specs promise.

## What Changes

- **BREAKING** Desktop pairs and reconnects to hosted servers only over the
  transport-authenticated WebRTC data channels: it joins signaling with the
  relay-join token, verifies the signed transcript, then runs enrollment,
  challenge, verify, and application authentication on the `api` and `control`
  lanes exactly as the browser shell does. The HTTPS device endpoints remain
  only for the loopback local-UI server. Desktop pins the verified host key at
  pairing time in the same protected record as the device key.
- **BREAKING** The pairing PIN is removed. First pairing requires the fragment
  plus **explicit approval on the exposing host**: after transport
  authentication and enrollment request, the host shows the device name and a
  short match code that the joining device also displays; the administrator
  approves or denies on the host. The match code is derived from the fragment,
  the client nonce, the host key, and the device public key, so approval is
  bound to the exact device key. `TERMINAY_REMOTE_PAIRING_PIN`, the PIN hash in
  settings, PIN entry in the browser shell and Desktop dialog, and the PIN
  failure limit are removed.
- A new `device-join` never closes an authenticated live peer. The host retires
  the previous peer for a device only after the replacement has consumed a
  valid connection ticket, and the relay contract requires a device-key proof
  before it admits a `device-join`.
- Host context beyond the non-secret bootstrap and the UI archive are served
  only after a connection ticket is consumed on that peer, and concurrent
  handshakes are bounded per room and per session.
- The server host key is stored through OS-protected storage on Desktop and
  the standalone server offers an explicit **Reset server identity** action
  that rotates the key, revokes every device, and requires re-pairing.
- Connection tickets are bound to the WebRTC peer that earned them.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `remote-access`: pairing credential invariants (approval and match code
  replace the PIN), exposure policy, the Desktop pairing journey and reconnect
  sequence over the authenticated channel, one live connection per device,
  one handshake at a time, the pre-authentication data embargo for host context
  and archive, host-key storage and identity reset, and ticket-to-peer binding.
- `connections-and-client-hosts`: Pair Device dialog and Desktop
  add-connection parity without PIN fields, the browser enrollment prompt,
  Remote Control and Settings no longer holding PIN policy, the exposure flow's
  approval step, and the new pending-approval surface.
- `server-runtime-and-protocol`: standalone pairing command and remote first
  pairing require explicit host approval rather than a configured PIN.

## Impact

- `electron/remote/desktopPairing.ts`, `desktopReconnect.ts`,
  `desktopWebRtcBootstrap.ts`, `desktopWebRtcTransport.ts`, and
  `electron/main.ts` connection flows: replace HTTPS device calls with the
  authenticated data-channel client and add the `api` lane to the Desktop
  transport.
- `apps/terminay-server/src/remote/hostedPairingHost.ts`,
  `hostedPeerLifecycle.ts`, `serverExposure.ts`, `hostedHostKey.ts`, and
  `packages/server-core/src/remote/*`: approval state machine and match code,
  peer-bound tickets, ticket-gated host context and archive, handshake bounds,
  deferred peer replacement, host-key protection and rotation.
- `packages/protocol`: match-code derivation and the approval message shapes
  shared by server, browser shell, and Desktop.
- `apps/terminay-server/src/cli.ts`, `cliOptions.ts`, `localUiServer.ts`,
  `electron/remote/pin.ts`, `pinGuard.ts`, settings types, and
  `src/shared/RemoteExposurePanel.tsx`, `RemotePairingModal.tsx`,
  `src/host/nativeActions.ts`: remove the PIN and add the pending-approval UI.
- Hosted browser session shell and signaling relay (outside this repository):
  display the match code during enrollment and gate `device-join` on a
  device-key proof; the contract is specified here and covered by the shared
  conformance vectors.
- Release evidence: the adversarial signaling harness gains cases for Desktop
  pairing, approval, and live-peer replacement; `docs/operations/standalone-server.md`
  drops the PIN variable.
