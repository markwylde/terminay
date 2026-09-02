## MODIFIED Requirements

### Requirement: Web connection host scope

`app.terminay.com` SHALL have no Local server option and SHALL never claim browser filesystem or PTY authority. Its disconnected state SHALL be a connection picker: a saved-profile list with **Add new connection**, which opens a dedicated page to scan a pairing QR or paste a pairing URL, plus rename, open, and forget actions. Selecting a profile SHALL frame it in the current PWA view, and an explicit action MAY open a first-party session tab. The PWA SHALL contain connection-profile management, the framed session host, and the origin-keyed credential vault, SHALL NOT run the workspace, and SHALL show at most one framed session at a time.

#### Scenario: Web host offers no Local option

- **WHEN** a browser user opens the connection manager
- **THEN** the same add, manage, and switch journey is available with no Local option

#### Scenario: One framed session at a time

- **WHEN** the user opens another saved profile
- **THEN** it replaces the currently framed session

### Requirement: PWA profile store record

The PWA SHALL use a Local-disabled `ConnectionProfileStore` and a versioned `terminay.web.connection-profiles.v1` metadata record. It SHALL restore malformed records defensively and SHALL require explicit confirmation for forget. Opening a profile SHALL frame that exact HTTPS origin in the current PWA view; an explicit new-tab action SHALL be host-controlled and open a first-party session document. Pairing fragments SHALL be handed to the stable session origin without being persisted or copied into the saved profile. A profile SHALL retain only a label, canonical origin, and local created and last-opened timestamps; the default label SHALL come from the pairing URL's non-secret `hostName`, the session id in the origin SHALL remain the stable identifier, and the user MAY rename that local label. Pairing URL paths and fragments SHALL be discarded when the manager derives that profile. Queries, origin userinfo, pairing material, and other credentials SHALL never become bookmark state. Framed-session device credentials SHALL be vault state rather than profile metadata. The PWA manager SHALL persist its bookmark list only at the exact manager origin.

#### Scenario: Malformed record is restored defensively

- **WHEN** the stored `terminay.web.connection-profiles.v1` record is malformed
- **THEN** the manager restores defensively rather than failing open with unsanitized data

#### Scenario: Profile keeps only sanitized fields

- **WHEN** the manager derives a profile from a pairing URL
- **THEN** it retains only label, canonical origin, and created and last-opened timestamps

#### Scenario: Fragment never enters bookmark state

- **WHEN** a pairing fragment is handed to the stable session origin
- **THEN** it is not persisted, copied into the profile, or written to manager storage

### Requirement: Manager is not part of the credential path

The manager SHALL NOT participate in PIN entry and SHALL never receive the connection ticket, terminal data, or workspace data. A missing or revoked device identity SHALL request a newly generated pairing URL. The saved manager profile SHALL remain until the user chooses **Forget**.

#### Scenario: Manager never sees the PIN or ticket

- **WHEN** enrollment or reconnect runs in a framed session
- **THEN** the manager receives no PIN, connection ticket, terminal data, or workspace data

#### Scenario: Revoked identity requests re-pairing

- **WHEN** the device identity is missing or revoked
- **THEN** a newly generated pairing URL is requested and the saved profile is retained

### Requirement: Browser connection journeys

Terminay SHALL support two browser entry journeys — opening the hosted pairing link and the `app.terminay.com` PWA add flow — and both SHALL use the same session-origin pairing, credential, server-bundle, and reconnect contracts. Opening the advertised hosted URL SHALL land on the manager, which consumes the fragment in memory, strips query and hash from the visible URL, and asks **Save and connect** with an optional title prefilled from `hostName` or the session id; Cancel SHALL discard the material and Confirm SHALL write the bookmark and frame `https://<session-id>.terminay.com/v1/#<secret>` without storing the fragment. The framed session origin SHALL establish WebRTC, verify and launch the selected server bundle, obtain the PIN or approval, create the device key, and complete enrollment, storing that key in the manager vault for `event.origin` when framed. A later visit to the saved profile or the stable session origin SHALL reconnect without reuse of the pairing URL. A first-party visit to a session-origin `/v1/` pairing URL SHALL enrol at the session origin with session-origin IndexedDB.

#### Scenario: Both journeys share one prompt

- **WHEN** the user opens a hosted pairing link in a browser or scans or pastes it inside the PWA
- **THEN** the same **Save and connect** prompt appears and enrollment is framed at the session origin

#### Scenario: Returning to the manager restores the profile

- **WHEN** the user returns to the manager after a framed session
- **THEN** the iframe unloads and the saved profile is restored from local browser storage

#### Scenario: Saved connection reconnects from the vault

- **WHEN** the user selects the saved connection later
- **THEN** its stable session origin is framed, receives its device credential from the manager vault, and reconnects without a pairing URL

### Requirement: Web host storage split

The web host SHALL store bookmark metadata in `localStorage` or an equivalent browser store, and framed-session device credentials in manager-origin IndexedDB. The non-extractable browser device key for a framed PWA session SHALL live in that manager vault, while a first-party session document SHALL store its key in IndexedDB and WebCrypto on the exact server session origin. The connection host SHALL NOT read terminal output, project names, paths, PINs, or workspace data, and MAY clone a vaulted device key only into the session iframe whose origin matches the vault slot.

#### Scenario: Vault clone is origin-matched

- **WHEN** a session iframe requests its device key
- **THEN** the manager clones it only when the iframe origin matches the vault slot

#### Scenario: Host cannot read workspace content

- **WHEN** the connection host mediates a session
- **THEN** it reads no terminal output, project names, paths, PINs, or workspace data
