# Hostile-relay authenticated WebRTC transport evidence

Date: 2026-09-02

This is release-required proof that a fully hostile signaling and TURN operator
cannot obtain an authenticated plaintext position between a Terminay client and
server. The operator may delay, replay, reorder, replace, or suppress signaling;
the only successful forwarding path preserves the server-authenticated DTLS
endpoint end to end.

## Commands

```sh
node --test scripts/authenticated-webrtc-offer-verifier.test.mjs
node --test scripts/desktop-authenticated-webrtc-host.test.mjs
node --test scripts/authenticated-webrtc-adversarial-harness.test.mjs
node --test scripts/authenticated-webrtc-mutation-suite.test.mjs
node --test scripts/authenticated-webrtc-honest-path.test.mjs
node --test scripts/authenticated-webrtc-release-evidence.test.mjs
```

Electron acceptance for this contract is the container command `npm run test:e2e`.
Host Playwright (`npm run test:e2e:host`) is not a release gate for remote access.

## Proof

- Shared pairing and reconnect vectors authenticate the exact SDP hash and DTLS
  fingerprint set before `setRemoteDescription`.
- An adversarial harness that holds two independent WebRTC endpoints and relays
  valid pairing or reconnect challenges cannot splice them: substitution fails
  before a PIN, device public key, device signature, ticket, bundle request, or
  application frame is sent.
- Mutating any signed transcript field, SDP whitespace or bytes, fingerprints,
  host key, signature, pairing authenticator, nonce, generation id, scope, or
  expiry fails closed. Delayed or duplicated valid messages cannot revive a
  retired generation.
- Honest signaling still pairs, persists the host pin beside the Desktop device
  credential, reconnects after a store restart, recovers a later generation, and
  revokes the device without creating a second PTY owner.
- A build cannot advertise Remote Access when the client or server authenticated
  transport contract version is missing or mismatched.

This evidence does not claim a live hostile operator was observed on production
TURN. It is the deterministic contract the release gate requires before remote
access may be advertised.
