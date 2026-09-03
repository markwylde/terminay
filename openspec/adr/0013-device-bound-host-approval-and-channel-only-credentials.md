# ADR-0013: Pair with device-bound host approval, and exchange credentials only on transport-authenticated data channels

Status: accepted
Date: 2026-09-02

## Context

ADR-0011 records the remote-device boundary as "device keys, PIN/approval,
reconnect grants" and requires that the client verify the offered DTLS
fingerprints before any credential crosses. Two gaps remained after the
end-to-end host authentication change. The Desktop connection host still ran
device enrollment and reconnect over HTTPS to the session origin, an origin the
untrusted hosted relay terminates, and the six-digit PIN was the only second
factor on first pairing. A PIN is a fixed user secret: it can be brute-forced
by a fragment holder, it is submitted to whatever host a link names, and it
tells the user nothing about which device is being admitted.

## Decision

1. **Credentials travel only on transport-authenticated data channels.** On
   every client host — browser first-party, framed PWA, and Desktop — the
   pairing token, device public key, challenge signature, connection ticket,
   approval decision, UI archive, and host context beyond the non-secret
   bootstrap record cross only a WebRTC data channel whose offer transcript
   that client verified. HTTP device endpoints exist solely for the loopback
   embedded local-UI server. No hosted HTTPS origin is a credential path.

2. **First pairing is authorized by explicit host approval of a device-bound
   match code, not a PIN.** After transport authentication and enrollment
   request, server and client each derive a five-symbol code with HKDF over
   the pairing fragment and HMAC over the client nonce, the server host public
   key, and the hash of the device public key. The exposing host shows the
   device name and code; the administrator approves or denies. A pairing room
   holds one pending request at a time, and the request expires in 120
   seconds. There is no PIN, no PIN policy, and no PIN storage.

3. **Authentication precedes displacement.** A live peer for a device is
   replaced only by a peer that has consumed a valid connection ticket for
   that device. Joins, offers, and answers that have not authenticated hold a
   bounded handshake slot and nothing else. Connection tickets are bound to
   the peer that received them.

4. **The host key is protected like a device key and reset only
   deliberately.** Desktop stores the server host key through OS-protected
   storage and refuses exposure without it; the standalone server keeps it
   owner-only inside the data root. Rotation is an explicit **Reset server
   identity** that revokes every device.

## Consequences

- Any future client host must implement the signaling join, transcript
  verification, and data-channel device API; there is no HTTPS shortcut to
  add later.
- The hosted relay contract gains a device-key proof on `device-join` and the
  approval message shapes, and stays data-blind: it verifies nothing and
  stores no device keys.
- First pairing always needs a tap on the exposing host. Headless standalone
  servers approve through the control socket.
- The match-code derivation is part of the protocol contract and is covered by
  shared vectors; changing it is a transport version bump.
- ADR-0011's trust-boundary table remains in force; this record narrows what
  "PIN/approval" means and forbids HTTPS credential paths for hosted origins.
