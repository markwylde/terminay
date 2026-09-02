## MODIFIED Requirements

### Requirement: Web connection host scope

`app.terminay.com` SHALL have no Local server option and SHALL never claim browser filesystem or PTY authority. Its disconnected state SHALL be a connection picker: a saved-profile list with **Add new connection**, which opens a dedicated page to scan a pairing QR or paste a pairing URL, plus rename, open, and forget actions. Selecting a profile SHALL frame it in the current PWA view, and an explicit action MAY open a first-party session tab. The PWA SHALL contain connection-profile management, the framed session host, and the origin-keyed credential vault, SHALL NOT run the workspace, and SHALL show at most one framed session at a time.

#### Scenario: Web host offers no Local option

- **WHEN** a browser user opens the connection manager
- **THEN** the same add, manage, and switch journey is available with no Local option

#### Scenario: One framed session at a time

- **WHEN** the user opens another saved profile
- **THEN** it replaces the currently framed session

### Requirement: Bundle content stays out of the manager origin

The stable session origin SHALL install the selected server's bounded workspace bundle after authentication. Bundle bytes, feature frames, pairing fragments, PINs, and connection tickets SHALL never enter the manager origin. Framed-session device credentials SHALL enter only the origin-keyed vault. `app.terminay.com` SHALL be the stable connection manager, and the selected server's verified bundle SHALL render the workspace at its stable session origin.

#### Scenario: Manager origin holds no bundle bytes

- **WHEN** a framed session installs a server bundle
- **THEN** the bytes are handled at the session origin and never enter the manager origin

### Requirement: Manager is not part of the credential path

The manager SHALL NOT participate in PIN entry and SHALL never receive the connection ticket, terminal data, or workspace data. A missing or revoked device identity SHALL request a newly generated pairing URL. The saved manager profile SHALL remain until the user chooses **Forget**.

#### Scenario: Manager never sees the PIN or ticket

- **WHEN** enrollment or reconnect runs in a framed session
- **THEN** the manager receives no PIN, connection ticket, terminal data, or workspace data

#### Scenario: Revoked identity requests re-pairing

- **WHEN** the device identity is missing or revoked
- **THEN** a newly generated pairing URL is requested and the saved profile is retained

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
