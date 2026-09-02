## Context

Proposal.md records the attack. The essential asymmetry is that WebRTC's DTLS
encryption is only as strong as the channel that carried the fingerprint, and
that channel is hosted signaling — a service Terminay treats as untrusted and
data-blind. Signing the host key without binding it to the exact offered DTLS
endpoint therefore authenticates an identity while leaving the transport
unauthenticated.

## Goals / Non-Goals

Goals:

- Bind the server host key to the exact WebRTC transport each browser and Desktop
  device sees, for pairing and for reconnect.
- Reduce a fully hostile signaling and TURN operator to denial of service and
  delay.
- Make every failure mode a distinct, visible, fail-closed error rather than a
  weaker fallback.

Non-Goals:

- Changing pairing ergonomics, the PIN, QR rotation, or device revocation.
- Encrypting or hiding metadata that signaling legitimately routes.
- Protecting against a compromised server host key; rotation is an explicit trust
  reset, not a recovery path.

## Decisions

1. **One canonical, versioned transcript.** A dependency-light schema with one
   canonical byte serialization, shared by server, browser, and Desktop, so the
   same deterministic vectors test all three. Unknown fields, duplicate or
   unsupported fingerprints, ambiguous encodings, unsafe times, and oversized
   values are rejected rather than tolerated.
2. **The transcript travels with the offer.** Signature and transcript are one
   generation-bound signaling message rather than a separate registration claim,
   so a relay cannot pair a valid signature with a substituted offer.
3. **Nonce before offer.** The server creates its offer only after receiving a
   bounded fresh client nonce, which makes each transcript specific to one
   client attempt and defeats replay of a captured valid transcript.
4. **Exact SDP bytes are hashed and every DTLS fingerprint is bound.** Other SDP
   fields are not an identity boundary: normalizing relays can deny service or
   relay opaque DTLS packets, but cannot move the authenticated endpoint.
5. **First pairing uses a fragment-derived HKDF key.** Pairing has no pinned key
   yet, so the fragment — which signaling never receives — supplies the initial
   authentication. That key, the fragment, and any reusable derivative stay out
   of signaling, URLs, logs, analytics, and persisted room metadata.
6. **Verification order is authenticator, then signature, then use.** The client
   verifies the pairing authenticator, then the host-key signature, then stores
   the host key atomically with the newly enrolled device credential — before any
   `setRemoteDescription` or data-channel credential exchange.
7. **The pin lives in the device credential.** Not a profile label and not a
   signaling record. A missing pin requires pairing; a changed key is an explicit
   server identity change requiring re-pairing.
8. **Registration proof stays, but as availability control only.** It keeps a
   second host from replacing a live registration; it is never presented as
   client-verified transport authentication.

## Risks / Trade-offs

- Adding a client nonce round trip before offer creation lengthens connection
  setup slightly. The cost is bounded and applies once per generation.
- Strict transcript parsing will reject transcripts produced by an older or newer
  contract version, so a build cannot advertise remote access when its client or
  server lacks the contract version. This is deliberate: a version mismatch must
  be a visible failure rather than a silent downgrade.
- Fragment-derived pairing authentication depends on the fragment never reaching
  signaling. Any future feature that persists or forwards room metadata must be
  reviewed against that invariant.
- Host-key rotation invalidates all existing device trust and forces re-pairing
  on every device. That is the intended trust-reset semantic, and restoring
  server state must preserve the host key to avoid an unintended reset.

## Open Questions

- The privileged Desktop native WebRTC connection host still needs the same
  pre-SDP authenticated transport contract and pin persistence; until it does,
  only the browser and framed-PWA paths enforce it.
