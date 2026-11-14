## MODIFIED Requirements

### Requirement: Exposing a server from a client host

Embedded Local servers SHALL accept only the private Desktop transport and SHALL NOT be advertised by default. **Expose this server…** SHALL be available only with server administrative capability. The flow SHALL start WebRTC availability and show a short-lived pairing URL and QR, expiry, relay state, pending approvals, paired devices, live connections, and approve, deny, revoke, reset-identity, and stop controls. **Expose this server** SHALL NOT change which server the current window renders. The current Local MessagePort SHALL remain connected throughout exposure and SHALL never be presented as a selectable exposure route. Standalone server CLI and UI SHALL use the same exposure and trust model, and the flow against an attached standalone server SHALL show and control that server's own exposure through the same operations as against the embedded server.

#### Scenario: No silent exposure

- **WHEN** an embedded Local server runs without an explicit exposure action
- **THEN** it accepts only the private Desktop transport and is not advertised

#### Scenario: Exposure does not switch the rendered server

- **WHEN** the user exposes the current server
- **THEN** the window continues rendering the same server

#### Scenario: Local transport is not an exposure route

- **WHEN** the exposure surface lists routes
- **THEN** the Local MessagePort is not offered as a selectable route and remains connected

#### Scenario: Exposing an attached standalone server

- **WHEN** the user opens Remote Access for an attached standalone server and selects **Expose this server…** or **Create pairing link**
- **THEN** the surface shows that server's real exposure state, pairing link, trusted devices and live connections, and no operation is reported as unknown
