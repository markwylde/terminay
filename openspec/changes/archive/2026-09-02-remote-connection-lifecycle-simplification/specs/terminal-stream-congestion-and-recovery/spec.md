## MODIFIED Requirements

### Requirement: Protocol liveness is transport-generation liveness

Application-protocol liveness SHALL be part of transport generation liveness. If the server protocol reader ends or fails, the mounted client SHALL be treated as unusable even when its WebRTC peer and required data channels remain open. ICE `failed` or `closed`, or inbound application frames that cannot be decoded as bytes, SHALL be the same class of failure. ICE `disconnected` while `connectionState` remains `connected` SHALL NOT be that class, because Safari and Firefox report it during consent checks while channels still deliver. A true transport failure SHALL retire the whole client and peer generation; it SHALL NOT be treated as a terminal-panel error and SHALL NOT be repaired by renewing an attachment on the retired client.

#### Scenario: Protocol reader ends with an open peer

- **WHEN** the server protocol reader ends while the WebRTC peer and required data channels remain open
- **THEN** the whole client and peer generation is retired and replaced

#### Scenario: Undecodable application frame

- **WHEN** an inbound application frame cannot be decoded as bytes
- **THEN** the generation fails rather than the frame being ignored

#### Scenario: ICE disconnected during a consent check

- **WHEN** ICE reports `disconnected` while `connectionState` remains `connected`
- **THEN** the generation is not replaced

### Requirement: Liveness detection by heartbeat

A checkpoint or attach snapshot without later live PTY or workspace events SHALL NOT count as a successful connection. Congestion recovery SHALL still apply when frames arrive and overwhelm a presentation lane. A transport that has gone silent while reporting open SHALL be detected by a connection heartbeat — a periodic application-protocol ping with a bounded response deadline — and SHALL NOT be inferred from PTY quietness or traffic patterns. A missed heartbeat SHALL be a transport-generation failure; an idle but responsive connection SHALL be healthy.

#### Scenario: Silent transport reporting open

- **WHEN** a transport stops delivering while reporting open
- **THEN** the missed heartbeat response deadline retires the transport generation

#### Scenario: Idle responsive connection

- **WHEN** a connection is idle but answers heartbeats
- **THEN** it is healthy and is not replaced

### Requirement: Connection-scoped attachment lifetime

Attachment lifetime SHALL be scoped to the exact connection that created the attachment. Closing one connection SHALL release only that connection's attachments, leases, and checkpoints. Another connection authenticated by the same device, including the replacement created by a reconnect, SHALL be unaffected by the old connection's teardown whenever it happens.

#### Scenario: Superseded connection fails later

- **WHEN** a reconnect from the same device replaces a prior connection and the superseded connection later fails
- **THEN** only its own attachments, leases, and checkpoints are released and the replacement connection's live stream is unaffected

### Requirement: Explicit attachment closure and suppression exit

When the server detaches an attachment for any reason other than the client's own detach request, it SHALL deliver an explicit attachment-closed skip; a stream SHALL NOT end silently while its connection remains open. Congestion suppression SHALL end when the replacement attachment attaches and only then. Suppression SHALL NOT be ended by an acknowledgement, because no output is published while suppression holds.

#### Scenario: Server-initiated detach

- **WHEN** the server detaches an attachment for a reason other than the client's detach request
- **THEN** it delivers an explicit attachment-closed skip

#### Scenario: Acknowledgement during suppression

- **WHEN** an acknowledgement arrives while congestion suppression holds
- **THEN** suppression is not lifted and only the replacement attachment attaching ends it

### Requirement: Silent latch prohibition

A display SHALL NOT be latched out of recovery. Such a failure is silent because the display keeps its connection, keeps accepting keystrokes, keeps its painted screen, and reports no error while never painting again.

#### Scenario: Display stops painting

- **WHEN** a display stops receiving new output while its connection stays open and healthy
- **THEN** the condition is observable and recovery proceeds rather than the display latching silently

