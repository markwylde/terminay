## Why

`device-host-ready` signs only the session id, registration expiry, and host
public key. The WebRTC offer and its DTLS fingerprint travel separately and
clients do not bind them to that key, so a malicious signaling service can
replace SDP, terminate one DTLS connection to the client and another to the real
server, relay the legitimate pairing or device proof, and obtain an authenticated
plaintext application position without extracting either long-term private key.
This is a release blocker; the PIN is not a mitigation because a signaling MITM
terminates the WebRTC hop on which the client submits it.

## What Changes

- **BREAKING** Every pairing and reconnect generation carries a versioned,
  server-signed transport transcript that binds the domain and version, scope,
  room or session id, origin, server id, host key, fresh client nonce, offer
  identity, times, exact SDP hash, and the complete normalized DTLS fingerprint
  set. Clients verify it before `setRemoteDescription`.
- First pairing additionally authenticates the transcript and host key with a
  fragment-derived HKDF key that signaling can neither see nor derive.
- The hosted server creates its offer only after receiving a bounded fresh client
  nonce, and sends the transcript, signature, and pairing authenticator with the
  offer as one generation-bound signaling message.
- The verified host public key and algorithm are pinned atomically beside each
  device credential. Reconnect accepts only that pinned key; there is no TOFU
  reconnect, signaling-supplied replacement, or silent rotation.
- No PIN, approval, device key material, challenge signature, ticket, UI archive,
  host context beyond non-secret bootstrap, or application or terminal frame
  crosses a data channel before transport authentication succeeds.
- Host registration proof remains a signaling availability control, separated
  clearly from client-verified transport authentication.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `remote-access`: the server-authenticated transport transcript, first-pairing
  and reconnect transport authentication, the pre-authentication data embargo,
  host-key pinning and rotation, the immutable signed SDP snapshot, and the
  registration-proof boundary.

## Impact

- Shared protocol package: transcript schema and canonical byte serialization.
- Hosted server offer creation, transcript signing, and the hosted signaling
  message shapes.
- Browser first-party and framed-PWA connection hosts: nonce generation,
  verification order, and pin persistence beside the device credential.
- Desktop native WebRTC connection host: the same pre-SDP authenticated
  transport contract and pin persistence.
- Release security evidence: an adversarial signaling harness and a mutation
  suite become release-required proof, and a build cannot advertise remote access
  when its client or server lacks the authenticated transport contract version.
