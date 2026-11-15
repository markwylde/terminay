## MODIFIED Requirements

### Requirement: Always-on coverage of protocol, pairing, and WebRTC lifecycle

The normal diagnostic level SHALL record embedded Local server protocol-stream failures, including a client disconnect racing an event delivery, as a stable bounded error without protocol frames, terminal content, credentials, or remote addresses. It SHALL record hosted remote pairing signaling lifecycle — advertisement, host-registered, pairing or device-host socket close, automatic QR rotation, client-join, and registration failure — using only origin class (`manager`, `session`, `loopback`, `other`), close-code, close-reason class, and remaining TTL, and SHALL NOT record pairing URLs, fragments, PINs, room ids, session ids, or hostnames. After a client has joined, it SHALL record hosted remote WebRTC liveness: peer and ICE state changes, ICE disconnect grace start/clear/expiry, data-channel open/close, and application-lane counters (inbound/outbound frame and byte counts, last-activity age, buffered amount, inbound kind class, send failure class), emitted as state changes plus a bounded stall warning when inbound frames continue while outbound frames stop, and a periodic summary while a peer is live. It SHALL record each replacement of a remote window's document channel with its reason class (`document-reload`, `transport-ended`, `transport-failed`, or `reconnect-retry`) and the window's numeric id, as information for a document reload and as a warning otherwise. It SHALL NOT record PTY bytes, keystrokes, protocol payloads, SDP, ICE candidate addresses, or channel labels beyond the fixed set `control`, `application`, `terminal`, `assets`, `asset`, and `api`.

#### Scenario: Client disconnects during event delivery

- **WHEN** a Local protocol client disconnects while an event is being delivered
- **THEN** one bounded connection-failure diagnostic is produced
- **AND** Desktop and its Electron windows remain running

#### Scenario: Remote session accepts input but stops streaming

- **WHEN** a hosted remote session accepts keystrokes but stops streaming PTY output
- **THEN** peer, ICE, and channel state plus application-lane counters showing inbound continuing while outbound stalls are recorded
- **AND** no terminal content is persisted

#### Scenario: Pairing lifecycle

- **WHEN** pairing advertises, registers a host, rotates a QR code, accepts a client join, or fails registration
- **THEN** only origin class, close-code, close-reason class, and remaining TTL are recorded
- **AND** no pairing URL, fragment, PIN, room id, session id, or hostname is recorded

#### Scenario: A remote window's channel is replaced

- **WHEN** Desktop replaces a remote window's document channel
- **THEN** one diagnostic names the reason class and the window id
- **AND** it records no server address, credential, or protocol payload
