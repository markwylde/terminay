## MODIFIED Requirements

### Requirement: First-party session-origin enrollment

A first-party visit to `https://<session-id>.terminay.com/v1/#<secret>` SHALL enroll at the session origin using session-origin IndexedDB and SHALL NOT use the manager vault. **Open in new tab** SHALL use a first-party session document that stores its device key in session-origin IndexedDB. Direct and framed credentials for the same origin SHALL be separate.

#### Scenario: Direct session URL enrolls first-party

- **WHEN** the user opens a session-origin `/v1/` pairing URL directly
- **THEN** enrollment occurs at that origin with session-origin IndexedDB

#### Scenario: New-tab credential is separate from the vault

- **WHEN** the user chooses **Open in new tab** from the manager
- **THEN** the resulting first-party document stores its own device key and does not share the manager vault

### Requirement: Pairing URLs are single-use

A complete pairing URL SHALL NOT be usable again. Opening the saved profile or the stable session origin later SHALL use the registered browser device identity. A later **Create pairing link** SHALL advertise a new fragment, and scanning or pasting a previous code SHALL be rejected as already used.

#### Scenario: Consumed pairing URL is rejected

- **WHEN** a user scans or pastes a pairing code that has already been consumed
- **THEN** it is rejected as already used

#### Scenario: Later access needs no pairing URL

- **WHEN** the user opens the saved profile or the stable session origin after enrollment
- **THEN** the registered browser device identity is used and no pairing URL is required

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

### Requirement: PWA add-connection flow

`https://app.terminay.com` SHALL list the manager profiles stored in that browser and SHALL offer **Add new connection**, which opens a dedicated page to scan the pairing QR with the device camera, choose a photo of that QR, or paste a pairing URL. The PWA SHALL validate the URL, accepting manager-origin hosted links and session-origin `/v1/` links, then use the same **Save and connect** prompt as opening the link in a browser. Confirm SHALL frame the reconstructed session pairing URL without leaving `app.terminay.com`. Selecting a saved profile SHALL load that stable session origin in the same fullscreen iframe, where the session authenticates with the vaulted device key and reconnects.

#### Scenario: QR scan uses the same save prompt

- **WHEN** the user scans or pastes a pairing URL inside the PWA
- **THEN** the same **Save and connect** prompt appears and enrollment is framed without leaving `app.terminay.com`

#### Scenario: Saved profile reconnects from the vault

- **WHEN** the user selects a saved manager profile
- **THEN** its stable session origin is framed and the session authenticates with the vaulted device key

### Requirement: Returning to the manager list

**Back to connections** SHALL return to the manager list without navigating `window.top`. From a connected workspace this action SHALL be **Switch connections** and **File → Disconnect**. Desktop SHALL omit **Switch connections** because its connection menu lists every remembered profile. Returning to the manager list SHALL unload the iframe.

#### Scenario: Returning unloads the framed session

- **WHEN** the user chooses **Back to connections** or **Switch connections**
- **THEN** the manager list is shown, the iframe is unloaded, and `window.top` is not navigated

#### Scenario: Desktop has no switch action

- **WHEN** a Desktop client displays its connection menu
- **THEN** **Switch connections** is absent and every remembered profile is listed

### Requirement: Recovery scope and revocation

Automatic recovery and **Retry connection** SHALL use the same reconnect operation. An expired or revoked device identity SHALL stop recovery and request pairing. Closing one browser tab or Desktop window SHALL affect only that client connection. Device revocation SHALL affect live and future connections.

#### Scenario: Revoked device stops recovering

- **WHEN** the device identity is expired or revoked
- **THEN** recovery stops and pairing is requested

#### Scenario: Revoking one device leaves others alone

- **WHEN** one device is revoked
- **THEN** that device's connection closes and other devices, Local Desktop, and server-owned PTYs are unaffected

### Requirement: Persistence boundaries

The stable session origin, as a first-party document, MAY store the device id and name, the non-extractable browser private key, and non-secret server identity metadata; when the session is framed by the PWA that credential SHALL live in the manager vault instead. The manager origin MAY store manager profiles (label, origin, timestamps) and per-origin framed-session device credentials in IndexedDB. The server MAY store the device id and name, the public device key, the private host key for its session origin, creation, last-seen, and revocation metadata, and security audit events. The signaling service MAY store the public host key or fingerprint for a session and SHALL never store the private host key.

#### Scenario: Signaling never holds the private host key

- **WHEN** signaling records host identity for a session
- **THEN** it stores only the public host key or fingerprint

#### Scenario: One durable key per credential store

- **WHEN** a browser is enrolled
- **THEN** it stores one durable private device key per session origin as a first-party document, or per manager-vault slot when framed
- **AND** the server stores the corresponding public key and revocation state

### Requirement: Uniform exposure for embedded and standalone servers

The same exposure model SHALL apply to an embedded Local server and to standalone `terminay-server`. Desktop and the CLI SHALL both start the server-owned hosted pairing host, registering the fragment-derived pairing room and the signed reconnect host before a pairing URL is advertised, and SHALL accept authenticated application transports on the `application` data channel. Desktop SHALL always serve the built server UI archive; the CLI SHALL serve that archive when `TERMINAY_UI_RENDERER_DIRECTORY` points at `dist-web`.

#### Scenario: Standalone server exposes identically

- **WHEN** standalone `terminay-server` is exposed
- **THEN** it registers the pairing room and signed reconnect host in the same way Desktop does

#### Scenario: CLI serves the UI archive when configured

- **WHEN** `TERMINAY_UI_RENDERER_DIRECTORY` points at `dist-web`
- **THEN** the CLI serves the built server UI archive

### Requirement: Desktop pairing journey

Terminay Desktop **Add connection** SHALL accept the same pairing URL as the browser, including hosted `https://app.terminay.com/?s=…#…` links. The privileged connection host SHALL never treat `app.terminay.com` as the server: it SHALL read the session id from `s`, the one-time secret from the fragment, and the default profile label from `hostName` when present. It SHALL then pair against the stable session origin using the device-enroll exchange on that origin, keep the device key in OS-protected storage, save the remote profile as the session origin plus that label, and open the selected server's verified workspace bundle in a sandboxed window.

#### Scenario: Desktop never enrols against the manager origin

- **WHEN** Desktop accepts a hosted pairing URL
- **THEN** it pairs against the reconstructed stable session origin and never against `app.terminay.com`

#### Scenario: Secrets stay in the privileged host

- **WHEN** a Desktop renderer is bound to a remote connection
- **THEN** it receives an opaque authenticated byte endpoint and non-secret profile identity
- **AND** pairing secrets and private device keys remain in the privileged connection host

### Requirement: Pairing credential security invariants

Pairing URLs SHALL be short-lived and single-use. The fragment SHALL be consumed in memory and SHALL never be sent in an HTTP request. Pairing SHALL require the fragment plus a PIN or explicit approval, and pairing PIN fields SHALL use a password input so the six-digit code is not shown in the clear. A public session origin, server id, device id, or PIN alone SHALL grant no access.

#### Scenario: PIN entry is masked

- **WHEN** the user enters a pairing PIN
- **THEN** the field is a password input and the six-digit code is not shown in the clear

#### Scenario: Public identifiers grant nothing

- **WHEN** an attacker knows the session origin, server id, device id, or PIN alone
- **THEN** no access is granted

#### Scenario: Fragment never travels over HTTP

- **WHEN** the pairing fragment is processed
- **THEN** it is consumed in memory and never included in an HTTP request
