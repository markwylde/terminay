## MODIFIED Requirements

### Requirement: Reconnect sequence

Reconnect SHALL proceed in order: the user opens a stable session origin directly, selects its PWA manager profile, or opens its Desktop profile; the client sends a fresh connection nonce, receives the WebRTC offer and authenticated transport transcript, and verifies that transcript with the host key pinned for this device; only after transport authentication the server sends a short-lived challenge containing the server identity, session origin, device id, nonce, and expiry; the client signs the challenge with its device private key; the server verifies the signature with the registered public key and checks expiry and revocation state; the server issues a short-lived, single-use connection ticket bound to that authenticated device and WebRTC peer; and the client opens the application transport and resumes workspace and terminal subscriptions from confirmed revisions and sequence positions. A terminal subscription SHALL resume from the position the display actually rendered or SHALL request a fresh presentation; no component SHALL supply a remembered cursor of its own on either side of the transport.

#### Scenario: Challenge follows transport authentication

- **WHEN** transport authentication has not completed
- **THEN** the server does not send the device challenge

#### Scenario: Revoked device fails the challenge check

- **WHEN** a revoked device signs the challenge correctly
- **THEN** the server rejects it on revocation state and issues no connection ticket

#### Scenario: Subscriptions resume from confirmed positions

- **WHEN** the application transport opens after a reconnect
- **THEN** workspace and terminal subscriptions resume from confirmed revisions and sequence positions

#### Scenario: Terminal resume states an explicit cursor

- **WHEN** a terminal subscription resumes after a reconnect
- **THEN** it names the position the display rendered or requests a fresh presentation, and no remembered cursor is substituted for it
