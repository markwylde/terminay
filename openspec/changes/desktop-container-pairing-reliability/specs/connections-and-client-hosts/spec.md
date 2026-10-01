## MODIFIED Requirements

### Requirement: Desktop add-connection parity

Desktop **Add connection** SHALL accept the same pairing URL, including hosted `app.terminay.com` links and direct standalone links whose origin is a server's own HTTPS signaling listener, including loopback origins, even when that URL would otherwise open a browser. It SHALL never pair against the manager origin. Browser and Desktop flows SHALL produce the same server-side device and audit semantics and SHALL use the same transport-authenticated data-channel enrollment. The Desktop connection host SHALL consume the pairing fragment in memory; hosted and direct links MAY carry non-secret `s`, `hostName`, and `pairingExpiresAt` query fields while pairing secrets stay in the fragment. Desktop SHALL show the match code while awaiting host approval. After enrollment succeeds and the device identity is stored, Desktop SHALL immediately persist the sanitized profile containing only the exact session or direct origin and sanitized profile metadata with a default label from `hostName`, even if the first reconnect or workspace load fails. The fragment and complete pairing URL SHALL never be returned by the host profile API or serialized into the connection menu store. Enrollment SHALL run against the reconstructed session origin or the direct origin over the transport-authenticated WebRTC channels; Desktop SHALL NOT send pairing material to a direct origin over HTTPS.

#### Scenario: Desktop enrols against the session origin

- **WHEN** Desktop accepts a hosted pairing URL
- **THEN** enrollment runs against the reconstructed session origin and never against `app.terminay.com`

#### Scenario: Desktop enrols against a direct loopback origin

- **WHEN** Desktop accepts an HTTPS direct pairing URL at `localhost`, `127.0.0.1`, or `::1` with the `/v1/` path
- **THEN** it opens signaling at that literal origin's `/signal`, verifies the signed transport transcript, and completes enrollment on the data channels
- **AND** reconnect classifies the saved origin as direct
- **AND** no pairing token, device key, or ticket is sent over HTTPS

#### Scenario: Desktop enrols against a direct origin

- **WHEN** Desktop accepts a direct standalone pairing URL
- **THEN** it opens signaling at that origin's `/signal`, verifies the signed transport transcript, and completes enrollment on the data channels
- **AND** no pairing token, device key, or ticket is sent over HTTPS

#### Scenario: Fragment is not exposed by the profile API

- **WHEN** the host profile API returns a profile
- **THEN** it contains neither the pairing fragment nor the complete pairing URL

#### Scenario: Profile survives first-load failure

- **WHEN** pairing enrollment succeeds but reconnect or workspace loading fails
- **THEN** the saved server profile and device identity remain available for retry

#### Scenario: Same server-side semantics from either host

- **WHEN** a device is enrolled from a browser or from Desktop
- **THEN** the server-side device and audit semantics are the same

## ADDED Requirements

### Requirement: Desktop pairing presents actionable progress and failures

The Desktop pairing surface SHALL distinguish submitting, waiting for host approval, connecting, connected, and failed states. It SHALL disable repeated submission while one attempt is active, stop presenting approval as pending after approval, show a clear recovery message when the transport drops, and present concise actionable errors without Electron IPC wrapper text.

#### Scenario: Pairing is busy

- **WHEN** a Desktop pairing attempt is active
- **THEN** the pairing action is disabled and another attempt cannot start

#### Scenario: Approval has been granted

- **WHEN** the exposing host approves the displayed match code
- **THEN** Desktop changes the status from waiting for approval to connecting

#### Scenario: Connection drops during pairing or initial load

- **WHEN** the WebRTC peer or required transport lane fails after signaling connected
- **THEN** Desktop shows that the connection was lost and offers a retry using the saved profile

#### Scenario: IPC action rejects

- **WHEN** an IPC action returns an Electron-wrapped error
- **THEN** the UI displays the underlying actionable message without the `Error invoking remote method` wrapper
