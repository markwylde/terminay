## MODIFIED Requirements

### Requirement: Application traffic uses the framed connection protocol

Local and remote workspace application traffic SHALL use the canonical framed `ServerConnection` protocol. Local Desktop SHALL provide a private MessagePort byte transport, and remote Desktop and browser hosts SHALL provide an authenticated WebRTC byte transport. HTTP SHALL remain limited to bootstrap, health, pairing, and static asset delivery where required, and application queries, commands, and events SHALL use `ServerConnection`.

#### Scenario: Issuing an application command

- **WHEN** the workspace issues an application query, command, or event
- **THEN** it travels over `ServerConnection` rather than HTTP

### Requirement: Transport neutrality and conformance

The application protocol SHALL be transport-neutral. Embedded Local connections SHALL use a private authenticated host transport, exposed remote connections SHALL use isolated WebRTC data channels, and test transports SHALL run in memory and pass the same conformance suite. A transport SHALL move framed bytes and report lifecycle and backpressure, and SHALL NOT implement workspace behaviour. Local and WebRTC connections SHALL produce the same authorization, commands, events, errors, and reconnect semantics.

#### Scenario: Local versus remote behaviour

- **WHEN** the same command is issued over a Local transport and over a WebRTC transport
- **THEN** authorization, results, events, errors, and reconnect semantics are identical

#### Scenario: Conformance suite

- **WHEN** the transport conformance suite runs
- **THEN** the in-memory, Local, and WebRTC transports exercise one application protocol

### Requirement: Versioned application protocol

Terminay SHALL use one versioned application protocol above every transport as the canonical client/server contract across local and remote connections. It SHALL include a handshake carrying protocol version, server version, stable server identity, client identity, authorization scope, and capability set; correlated commands and responses with runtime-validated payloads; revisioned workspace snapshots and ordered mutation events; resumable terminal output with per-session sequence positions and bounded snapshots; typed activity, agent, file-watch, settings, recording, and connection events; bounded binary transfer for files, previews, recordings, dictation audio, and server-bundled assets; and cancellation, deadlines, backpressure, and explicit resource limits.

#### Scenario: Opening a connection

- **WHEN** a client opens an application connection
- **THEN** the handshake carries the protocol version, server version, stable server identity, client identity, authorization scope, and capability set

#### Scenario: Invalid command payload

- **WHEN** a command payload fails runtime validation
- **THEN** the command is rejected at the server boundary

#### Scenario: Resuming terminal output

- **WHEN** a client resubscribes to a terminal session with a sequence position
- **THEN** output resumes from that position with a bounded snapshot

### Requirement: Separated terminal presentation lanes

Raw terminal presentation bytes SHALL use independently bounded attachment lanes rather than the generic reliable application-event FIFO. The connection writer SHALL reserve bounded capacity for control and workspace traffic and schedule terminal lanes fairly. Terminal-lane congestion SHALL perform attachment-scoped resynchronization and SHALL NOT be treated as a transport failure or close the shared connection. Remote channels MAY remain separated by traffic class covering connection and control, application commands and events, terminal streams, and assets and bounded binary content, so large asset or file transfers cannot block terminal control.

#### Scenario: Terminal lane congestion

- **WHEN** a terminal attachment lane becomes congested
- **THEN** that attachment resynchronizes and the shared connection stays open

#### Scenario: Large asset transfer

- **WHEN** a large asset or file transfer is in progress
- **THEN** terminal control traffic continues to be scheduled
