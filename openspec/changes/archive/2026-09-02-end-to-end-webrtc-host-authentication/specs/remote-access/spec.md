## MODIFIED Requirements

### Requirement: Server-authenticated transport transcript

Every pairing and reconnect generation SHALL use a server-authenticated transport transcript with one canonical, versioned byte serialization. The transcript SHALL include at least a Terminay protocol/domain separator and transcript version; pairing or reconnect scope plus the pairing room or stable session id; stable session origin and server id; server host public key and algorithm; a fresh client-generated nonce for this connection attempt; a server-generated offer/generation id, issued time, and short expiry; a diagnostic cryptographic hash of the offered SDP bytes; and every offered DTLS certificate fingerprint including algorithm and value. The server host key SHALL sign the canonical transcript, and the signature and transcript SHALL travel with the offer rather than as a separate registration claim.

#### Scenario: Fingerprints are verified before use

- **WHEN** a client receives a WebRTC offer with its signed transcript
- **THEN** the client verifies the received offer's DTLS fingerprints against the signed fingerprints before calling `setRemoteDescription`

#### Scenario: Other SDP fields are not an identity boundary

- **WHEN** an untrusted relay normalizes or replaces SDP fields other than the DTLS fingerprints
- **THEN** it can only deny service or relay opaque DTLS packets to the authenticated host
- **AND** it cannot change the authenticated DTLS endpoint

#### Scenario: DTLS alone is insufficient

- **WHEN** WebRTC DTLS encryption is in use without a signed transcript
- **THEN** it is not treated as sufficient host authentication, because signaling carries the SDP fingerprint

### Requirement: First-pairing transport authentication

First pairing has no previously pinned host key. The server SHALL additionally authenticate the transcript and host public key with a pairing-authentication key derived from the fragment using a dedicated HKDF label. The signaling service SHALL receive neither that key nor enough material to calculate it. The client SHALL verify the pairing authenticator, then the host-key signature, and SHALL atomically store the verified host public key together with the newly enrolled device credential.

#### Scenario: Pairing authenticator verified before host-key signature

- **WHEN** a first pairing offer arrives
- **THEN** the client verifies the fragment-derived pairing authenticator, then the host-key signature
- **AND** stores the verified host public key atomically with the new device credential

#### Scenario: Signaling cannot derive the pairing authentication key

- **WHEN** the signaling service observes all traffic it routes for a pairing room
- **THEN** it holds neither the pairing-authentication key nor material sufficient to calculate it

### Requirement: Reconnect transport authentication

Reconnect SHALL send a fresh client nonce before the server creates its offer. The client SHALL require the transcript to contain that exact nonce and SHALL verify the signature with the host public key pinned during pairing. A host-key mismatch, missing, duplicate, or changed fingerprint, stale transcript, repeated offer id, wrong origin, server, or scope, unsupported algorithm, or invalid signature SHALL fail the generation.

#### Scenario: Nonce must match

- **WHEN** the received transcript does not contain the exact nonce the client sent for this attempt
- **THEN** the generation fails

#### Scenario: Tampered transcript field fails the generation

- **WHEN** a signaling relay substitutes a fingerprint, host key, nonce, scope, origin, server id, generation id, expiry, or signature
- **THEN** the generation is rejected before any pairing or reconnect credential is released

#### Scenario: Two-peer proxying is impossible

- **WHEN** an adversarial signaling relay attempts to authenticate two separate WebRTC peers and proxy a pairing or reconnect session
- **THEN** it fails
- **AND** its only successful forwarding path preserves the server-authenticated DTLS endpoint end to end

### Requirement: No data before transport authentication

No PIN, approval response, device public key, device challenge signature, connection ticket, UI bundle, application frame, clipboard content, or terminal data SHALL cross a WebRTC data channel until transport authentication succeeds. The signaling service MAY replay, reorder, replace, or suppress signaling messages only to cause a bounded visible connection failure, and SHALL NOT obtain an authenticated plaintext position between the client and server.

#### Scenario: Nothing released to an unauthenticated transport

- **WHEN** transport authentication has not yet succeeded
- **THEN** no PIN, approval, device key material, ticket, bundle, application frame, clipboard content, or terminal data is sent on any data channel

#### Scenario: Hostile signaling causes only denial of service

- **WHEN** signaling replays, reorders, replaces, or suppresses messages
- **THEN** the result is a bounded visible connection failure, not plaintext observation or mutation

### Requirement: Host key pinning and rotation

The pinned host key SHALL be part of the device credential, not a profile label or signaling record. Host-key rotation SHALL be an explicit trust reset requiring a new pairing ceremony. Restoring or cloning server state SHALL preserve the host key or deliberately rotate server identity and invalidate prior device trust.

#### Scenario: Pinned host-key mismatch requires re-pairing

- **WHEN** the host key presented on reconnect does not match the key pinned for this device
- **THEN** the client shows a server identity change and requires explicit re-pairing
- **AND** it does not silently trust the replacement key

#### Scenario: Restored server state keeps or resets identity

- **WHEN** server state is restored or cloned
- **THEN** the host key is preserved, or server identity is deliberately rotated and prior device trust is invalidated

### Requirement: Immutable signed SDP snapshot

The host SHALL sign and signal one immutable SDP snapshot. WebRTC runtime mutation during local-description activation SHALL NOT change the transmitted offer.

#### Scenario: Local-description mutation does not alter the offer

- **WHEN** the WebRTC runtime mutates the local description during activation
- **THEN** the transmitted, signed offer is unchanged

### Requirement: Host claim requires proof of the registered host key

A later host claim for the same session SHALL prove possession of the same private server host key. A different key SHALL NOT replace a live registration, and exposure SHALL fail closed when a different key is already registered for that session.

#### Scenario: Second host cannot take over

- **WHEN** a second host that knows only the session origin attempts to register as the reconnect host
- **THEN** it cannot replace the registered reconnect host

#### Scenario: Exposure fails closed on key conflict

- **WHEN** a host attempts exposure for a session whose registration holds a different host key
- **THEN** exposure fails closed

