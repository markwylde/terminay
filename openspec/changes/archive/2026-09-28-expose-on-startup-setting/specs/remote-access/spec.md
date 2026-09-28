## MODIFIED Requirements

### Requirement: Exposure is explicit and administrator-controlled

Servers SHALL NOT be remotely reachable until an administrator enables exposure, either through **Expose this server…** on a client host, through the embedded server's **Automatically expose server on startup** setting, or through the standalone server's explicit `--expose` configuration. The setting and `--expose` each count as the administrator's standing decision for that data root. The setting SHALL default to off. Exposure SHALL connect the server to an authenticated WebRTC signaling endpoint before advertising a pairing URL, apply the explicit approval policy, generate a short-lived pairing URL and QR code, display exposure expiry, signaling and relay health, paired devices, and live connections, and allow the administrator to generate another pairing URL, revoke a device, or stop exposure. Hosted pairing links SHALL take the form `https://app.terminay.com/?s=<session-id>&hostName=<optional>#<secret>`, where the session subdomain remains the WebRTC peer and `hostName` is a non-secret default label from the exposing machine. Direct pairing links SHALL take the form `https://<direct-origin>/v1/?hostName=<optional>#<secret>`, where the direct origin is the server's own signaling listener.

#### Scenario: Server is unreachable before exposure

- **WHEN** neither an administrator nor the standalone configuration has enabled exposure
- **THEN** the server is not remotely reachable

#### Scenario: Standalone exposure at startup

- **WHEN** a standalone server starts with `--expose` naming one or more modes
- **THEN** it registers each mode's pairing room and reconnect host before readiness reports a pairing URL

#### Scenario: Desktop exposure at startup

- **WHEN** Terminay Desktop starts with **Automatically expose server on startup** enabled
- **THEN** after the workspace window is shown, the embedded server is exposed exactly as if the administrator had selected **Expose this server…**
- **AND** a failure to expose is reported through remote-access status and does not block startup
- **AND** the administrator can stop exposure from the connections menu for that session without changing the setting

#### Scenario: Desktop startup with the setting off

- **WHEN** Terminay Desktop starts with **Automatically expose server on startup** off, which is the default
- **THEN** the embedded server is not exposed until the administrator selects **Expose this server…**

#### Scenario: Host registers before pairing is advertised

- **WHEN** a server is exposed
- **THEN** it registers the fragment-derived pairing room (`host-ready`) and its server host key before it is reachable for pairing or reconnect

#### Scenario: Create pairing link while exposed

- **WHEN** the administrator selects **Create pairing link** while the server is already exposed
- **THEN** a new one-time fragment is minted and that room is registered
- **AND** a pairing room a client has already joined is not re-shown

#### Scenario: Stopping exposure preserves local work

- **WHEN** the administrator stops exposure
- **THEN** pairing and reconnect are blocked
- **AND** Local Desktop use and server-owned work continue running
