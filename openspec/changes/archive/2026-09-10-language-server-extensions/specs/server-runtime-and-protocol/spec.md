## ADDED Requirements

### Requirement: Query cancellation reaches the server

An aborted query SHALL emit a cancel envelope on the application protocol, exactly as an aborted command does. On receiving it the server SHALL abort the signal passed to that query's handler so the handler stops its work. A cancelled query SHALL return no result to the client. A protocol conformance test SHALL abort a query and assert that the server observed the cancellation.

#### Scenario: Client aborts a query

- **WHEN** a client aborts an in-flight query
- **THEN** a cancel envelope is sent for that correlation and the server aborts the handler's signal

#### Scenario: Result of a cancelled query

- **WHEN** a query is cancelled
- **THEN** no result is delivered to the client for it

#### Scenario: Conformance coverage

- **WHEN** the protocol conformance suite runs
- **THEN** it aborts a query and asserts the server observed the cancel envelope

## MODIFIED Requirements

### Requirement: Versioned application protocol

Terminay SHALL use one versioned application protocol above every transport as the canonical client/server contract across local and remote connections. It SHALL carry a supported version range rather than a single version, and SHALL express features as versioned capability strings such as `workspace.v1`, `terminal.v1`, `files.v1`, `git.v1`, `agents.v1`, `settings.v1`, and `language.v1`. Every registered operation SHALL belong to exactly one declared capability. The handshake SHALL negotiate both: the client hello SHALL carry the client's supported protocol range and its required and optional capability sets, and the server hello SHALL answer with its protocol version, server version, stable server identity, client identity, authorization scope, and declared capability set. It SHALL include correlated commands and responses with runtime-validated payloads; revisioned workspace snapshots and ordered mutation events; resumable terminal output with per-session sequence positions and bounded snapshots; read-scoped `language.capabilities`, `language.completion`, `language.hover`, and `language.definition` queries; typed activity, agent, file-watch, settings, recording, connection, and `language.diagnostics` events; bounded binary transfer for files, previews, recordings, dictation audio, and server-bundled assets; and cancellation, deadlines, backpressure, and explicit resource limits.

#### Scenario: Opening a connection

- **WHEN** a client opens an application connection
- **THEN** the client hello carries its supported protocol range and required and optional capabilities, and the server hello answers with the protocol version, server version, stable server identity, client identity, authorization scope, and declared capability set

#### Scenario: Invalid command payload

- **WHEN** a command payload fails runtime validation
- **THEN** the command is rejected at the server boundary

#### Scenario: Resuming terminal output

- **WHEN** a client resubscribes to a terminal session with a sequence position
- **THEN** output resumes from that position with a bounded snapshot

#### Scenario: Every operation belongs to a capability

- **WHEN** an operation is registered on the server
- **THEN** it belongs to exactly one declared capability string

#### Scenario: Language operations and events

- **WHEN** a client uses language intelligence
- **THEN** it does so through the protocol's read-scoped `language.capabilities`, `language.completion`, `language.hover`, and `language.definition` queries and the `language.diagnostics` event, under the same validation, deadline, and resource limits as every other operation
