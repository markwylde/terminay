## ADDED Requirements

### Requirement: Opening a hosted pairing link
A hosted pairing URL SHALL take the form
`https://app.terminay.com/?s=<session-id>&hostName=<optional>#<secret>`. The
session origin SHALL be reconstructed from `s` together with the manager's
parent domain and port, and SHALL NOT be taken from the link's own origin. The
pairing secret SHALL remain in the URL fragment. Legacy `https://<session>/v1/#…`
session pairing URLs SHALL continue to be accepted.

#### Scenario: Hosted link pasted into a browser
- **WHEN** a user opens a hosted pairing link in a browser
- **THEN** the PWA manager at `app.terminay.com` handles it and the user is not
  taken to the session subdomain

#### Scenario: Legacy link
- **WHEN** a previously issued `/v1/` session pairing URL is opened
- **THEN** it is still accepted for pairing

#### Scenario: Secret handling
- **WHEN** a hosted pairing link is emitted, opened, or stored as a profile
- **THEN** the secret appears only in the fragment and never in a query string,
  log, or saved profile

### Requirement: Uniform exposure for embedded and standalone servers
`terminay-server` and Desktop exposure and QR surfaces SHALL advertise the
manager-origin hosted pairing form for hosted exposure, while signaling, ICE,
and session origins remain on the session subdomain. Standalone fragment
pairing URLs SHALL retain their HTTPS enrollment path.

#### Scenario: QR payload
- **WHEN** a hosted pairing QR code is generated
- **THEN** it encodes the manager-origin form

#### Scenario: Transport origins
- **WHEN** a paired connection establishes signaling and ICE
- **THEN** both use the session origin, not the manager origin

### Requirement: Desktop pairing journey
Desktop Add connection SHALL accept the manager-origin hosted pairing URL,
reconstruct the session origin from it, and complete device enrollment against
that session origin. It SHALL NOT enroll against `app.terminay.com`, and SHALL
use `hostName` only as the default profile label.

#### Scenario: Adding a connection from a hosted link
- **WHEN** a user pastes a hosted pairing link into Desktop Add connection
- **THEN** Desktop enrolls the device against the reconstructed session origin
  and names the profile from `hostName` when present

#### Scenario: Manager origin is never the server
- **WHEN** the link's own origin is `app.terminay.com`
- **THEN** Desktop does not enroll against it and does not record it as the
  server
