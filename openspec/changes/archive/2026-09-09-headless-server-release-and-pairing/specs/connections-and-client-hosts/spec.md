## MODIFIED Requirements

### Requirement: Desktop add-connection parity

Desktop **Add connection** SHALL accept the same pairing URL, including hosted `app.terminay.com` links and direct standalone links whose origin is a server's own HTTPS signaling listener, even when that URL would otherwise open a browser. It SHALL never pair against the manager origin. Browser and Desktop flows SHALL produce the same server-side device and audit semantics. The Desktop connection host SHALL consume the pairing fragment in memory; hosted and direct links MAY carry non-secret `s`, `hostName`, and `pairingExpiresAt` query fields while pairing secrets stay in the fragment. It SHALL persist only the exact session or direct origin plus sanitized profile metadata with a default label from `hostName`. The fragment and complete pairing URL SHALL never be returned by the host profile API or serialized into the connection menu store. Enrollment SHALL run against the reconstructed session origin or the direct origin over the transport-authenticated WebRTC channels; Desktop SHALL NOT send pairing material to a direct origin over HTTPS.

#### Scenario: Desktop enrols against the session origin

- **WHEN** Desktop accepts a hosted pairing URL
- **THEN** enrollment runs against the reconstructed session origin and never against `app.terminay.com`

#### Scenario: Desktop enrols against a direct origin

- **WHEN** Desktop accepts a direct standalone pairing URL
- **THEN** it opens signaling at that origin's `/signal`, verifies the signed transport transcript, and completes enrollment on the data channels
- **AND** no pairing token, device key, or ticket is sent over HTTPS

#### Scenario: Fragment is not exposed by the profile API

- **WHEN** the host profile API returns a profile
- **THEN** it contains neither the pairing fragment nor the complete pairing URL

#### Scenario: Same server-side semantics from either host

- **WHEN** a device is enrolled from a browser or from Desktop
- **THEN** the server-side device and audit semantics are the same
