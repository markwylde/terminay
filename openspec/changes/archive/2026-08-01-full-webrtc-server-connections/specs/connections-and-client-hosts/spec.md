## ADDED Requirements

### Requirement: Desktop remote connection parity
Terminay Desktop SHALL pair with, reconnect to, and open a remote Terminay Server through the
same server-owned lifecycle as a browser client: the shared device-pairing transaction, a
main-process secure credential store, the protected reconnect exchange, strict fail-closed
signaling bootstrap parsing, an authenticated four-lane WebRTC coordinator, and the shared
workspace client.

#### Scenario: Pairing chains into the workspace
- **WHEN** Desktop device pairing succeeds
- **THEN** it continues directly into the protected reconnect exchange and the framed
  application transport, with no paired-without-workspace state

#### Scenario: Pairing requires an explicit PIN
- **WHEN** a Desktop pairing intent carries a blank or malformed PIN field
- **THEN** it is rejected rather than downgraded to a direct application-token handoff

### Requirement: Desktop credentials never reach the renderer
The device private key, reconnect grant, and short-lived application ticket SHALL be held
only in the Desktop main process. The renderer and preload SHALL expose no credential
surface; a pairing PIN MAY cross a narrow versioned host bridge solely for the pairing
invocation.

#### Scenario: Renderer receives no secrets
- **WHEN** Desktop completes pairing and reconnect
- **THEN** the renderer receives neither the reconnect grant nor the short-lived ticket

#### Scenario: Atomic credential commit
- **WHEN** a pairing result is persisted
- **THEN** the opaque private-key handle, device record, and optional origin-matched
  reconnect grant are committed as one encrypted replacement

### Requirement: Bounded Desktop pairing and reconnect exchanges
Each Desktop pairing and reconnect HTTP request SHALL be bounded by a deadline, including
consumption of the response body after headers arrive. A timed-out exchange SHALL return a
concrete error and SHALL persist no credential record.

#### Scenario: Stalled server
- **WHEN** a server stalls a pairing or reconnect request or its response body
- **THEN** the request aborts at its deadline, the connection dialog receives a concrete
  error, and no credential is persisted

### Requirement: Client hosts do not host the WebRTC peer
A client host SHALL NOT host the WebRTC peer in a renderer. Desktop SHALL expose no
renderer-reachable WebRTC host IPC, preload surface, or host route, and native and signaling
authority SHALL remain in the privileged main process.

#### Scenario: No renderer host surface
- **WHEN** the Desktop application starts
- **THEN** it creates no hidden host window, registers no host sender, and exposes no
  WebRTC-host IPC or preload API to the renderer

### Requirement: Desktop exposure uses the server-owned lifecycle
Desktop connection-menu exposure status, start and stop, pairing-room rotation, device
revocation, and peer close SHALL be routed through the same server-owned exposure lifecycle
used by a standalone server. The Desktop adapter SHALL project presentation fields only and
SHALL NOT reconstruct pairing secrets from status metadata.

#### Scenario: Exposure actions are server-owned
- **WHEN** an operator starts, rotates, or stops exposure from the Desktop connection menu
- **THEN** the server performs the lifecycle action and Desktop renders only the projected
  status
