# End-to-end WebRTC host authentication

## Goal

Make the server host key authenticate the exact WebRTC transport seen by each
browser and Desktop device, so hosted signaling and TURN can disrupt a
connection but cannot inspect, modify, or proxy pairing, reconnect, terminal,
workspace, or credential traffic.

## Governing specifications

- [Remote access](../features/remote-access.md)
- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)
- [Security threat model](../decisions/security-threat-model.md)

## Current gap

`device-host-ready` signs only the session id, registration expiry, and host
public key. The WebRTC offer and its DTLS fingerprint are sent separately and
clients do not bind them to that key. A malicious signaling service can replace
SDP, establish one DTLS connection to the client and another to the real
server, relay the legitimate pairing or device proof, and obtain an
authenticated plaintext application position without extracting either
long-term private key.

This is a release blocker. The existing PIN is not a mitigation because a
signaling MITM terminates the WebRTC hop on which the client submits it.

## Implementation slices

- [x] Define one dependency-light, versioned transport-transcript schema and
      canonical byte serialization in the shared protocol package. Bind the
      domain/version, pairing or reconnect scope, room/session id, origin,
      server id, host public key and algorithm, fresh client nonce,
      offer/generation id, issued/expiry times, exact SDP hash, and the complete
      normalized DTLS fingerprint set. Reject unknown fields, duplicate or
      unsupported fingerprints, ambiguous encodings, unsafe times, and
      oversized values.
- [x] Add a dedicated fragment-derived HKDF key for first-pairing transport
      authentication. The server MACs the canonical transcript and host public
      key; the client verifies that MAC before accepting or pinning the host
      key. Do not expose this key, fragment, or reusable derivative to
      signaling, URLs, logs, analytics, or persisted room metadata.
- [x] Make the hosted server create its WebRTC offer only after receiving a
      bounded fresh client nonce. Extract the actual local DTLS fingerprints,
      hash the exact transmitted SDP bytes, sign the canonical transcript with
      the persistent Ed25519 host key, and send the transcript, signature, and
      pairing authenticator with the offer as one generation-bound signaling
      message.
- [x] Make browser first-party and framed-PWA connection hosts verify the scope,
      origin, server id, nonce, freshness, generation,
      exact SDP hash/fingerprints, pairing authenticator when pairing, and host
      signature before `setRemoteDescription` or any data-channel credential
      exchange. A validation failure closes that generation and produces a
      typed visible trust error.
- [ ] Apply the same pre-SDP authenticated transport contract to the privileged
      Desktop native WebRTC connection host.
- [x] Persist the verified host public key and algorithm atomically beside each
      browser/PWA device credential. Reconnect accepts only that pinned
      key. A missing pin requires pairing; a changed key is an explicit server
      identity change requiring re-pairing. There is no TOFU reconnect,
      signaling-supplied replacement, or silent key rotation.
- [ ] Persist the verified host pin atomically beside each privileged Desktop
      device credential and require it on reconnect.
- [x] Gate every hosted-browser sensitive operation on transport authentication: PIN or
      approval, device enrollment/public key, device challenge signing,
      connection ticket, UI archive, host context beyond non-secret bootstrap,
      application authentication, and application/terminal frames. Retired or
      failed generations cannot reuse a verified flag, transcript, nonce,
      signature, authenticator, offer id, or ticket.
- [x] Keep host registration proof as a signaling availability control, while
      separating it clearly from client-verified transport authentication.
      Update the hosted signaling contract so it routes the new closed message
      shapes without interpreting trust decisions or learning secret material.
- [x] Define explicit browser/PWA restore and rotation behaviour. Preserving a server
      identity preserves its host key; deliberate host-key rotation invalidates
      existing device trust and requires a new pairing ceremony.

## Security tests

- [x] Unit-test canonical serialization and parsing, Ed25519 algorithm
      boundaries, fragment-derived authentication, signature verification,
      expiry, nonce equality, SDP-byte hashing, fingerprint normalization, and
      pin persistence with deterministic vectors shared by server, browser,
      and Desktop implementations.
- [ ] Add an adversarial signaling harness that attempts two independent
      WebRTC connections while relaying valid pairing enrollment and reconnect
      challenges. Endpoint substitution must fail before the client sends a
      PIN, public device key, device signature, ticket, bundle request, or
      application frame.
- [ ] Mutate each signed field independently, plus SDP whitespace/bytes,
      fingerprints, host key, signature, pairing authenticator, nonce,
      generation id, scope, replay order, and expiry. Every mutation fails
      closed; delayed and duplicated valid signaling messages cannot revive a
      retired generation.
- [ ] Prove honest signaling and TURN relay paths still pair, persist the pin,
      reconnect after browser/Desktop restart, recover transport generations,
      revoke devices, and carry the server-bundled workspace without creating
      duplicate PTYs.
- [ ] Run Electron acceptance only through `npm run test:e2e` and add the
      hostile-relay proof to release-required security evidence. A build cannot
      advertise remote access when its client or server lacks the authenticated
      transport contract version.

## Acceptance checks

- First pairing verifies fragment-derived authentication of the exact server
  host key and WebRTC DTLS endpoint, then stores that key with the device.
- Reconnect verifies a fresh nonce-bound transcript with the pinned host key
  before the device signs a server challenge.
- A signaling operator with full control of offer, answer, and ICE routing
  cannot read or alter application traffic or successfully proxy two WebRTC
  sessions; it can only fail or delay the connection.
- Host-key mismatch, transcript replay, and SDP/fingerprint substitution are
  distinct visible failures and never fall back to unverified transport.
- Pairing, reconnect, revocation, recovery, browser/PWA/Desktop persistence,
  and server-bundled UI transfer continue to work through the authenticated
  generation.

## Definition of done

The production server, browser, framed PWA, and Desktop paths enforce the same
versioned authenticated-transport contract; hostile-signaling tests prove the
MITM attack fails before credential release; release security evidence includes
that proof; and this file moves to `tasks_completed/`.
