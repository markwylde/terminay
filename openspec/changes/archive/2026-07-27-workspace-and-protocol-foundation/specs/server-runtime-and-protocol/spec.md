## ADDED Requirements

### Requirement: Versioned application protocol
One versioned application protocol SHALL carry every command, query, event,
terminal stream, and bounded binary transfer between a client and a server over
any authenticated byte transport. Frames SHALL be bounded binary frames
consisting of a fixed magic value and wire-format version, a frame-kind
discriminator, fixed-width big-endian header and body lengths, a canonical
UTF-8 JSON header validated against a closed schema, and an optional raw-byte
body. Canonical JSON SHALL reject undefined values, non-finite numbers,
duplicate or unknown fields, invalid UTF-8, and non-deterministic key ordering.
Decoders SHALL validate declared lengths and resource limits before allocating
or parsing a body. Peers SHALL negotiate limits downward rather than exceed
either side's declared maximum. The envelope set SHALL cover client hello,
server hello, capabilities, correlated query and result, idempotent command and
result, ordered revision and event delivery, stream open, chunk,
acknowledgement and close, binary-transfer start, chunk, acknowledgement,
completion and failure, cancellation, and deadlines.

#### Scenario: Oversized declared body
- **WHEN** a peer receives a frame whose declared body length exceeds the
  negotiated limit
- **THEN** the decoder rejects the frame before allocating or parsing the body
- **AND** it returns a structured resource error rather than partially reading
  the stream

#### Scenario: Unknown header field
- **WHEN** a frame header contains a field the closed schema does not declare
- **THEN** validation fails and the frame is rejected as a validation error

#### Scenario: Incompatible version negotiation
- **WHEN** a client offers a protocol version the server does not support
- **THEN** the server returns a closed `incompatible_version` error naming the
  supported minimum and maximum and then closes the connection
- **AND** it does not partially parse the connection or silently downgrade it

### Requirement: Structured protocol errors and resync rules
Every failure SHALL be reported as one of a closed set of structured errors:
validation, authorization, forbidden, not-found, conflict, cancelled, deadline,
resource, unavailable, incompatible, and internal. Commands SHALL carry a
stable command id, a correlation id, a validated operation and payload, an
optional expected revision, and a bounded deadline. A repeated completed
command id SHALL return its recorded result rather than executing the operation
again. When a disconnect leaves a command outcome uncertain, the client SHALL
resolve it through command status and snapshot or event resync and SHALL NOT
guess whether the mutation committed. Workspace events SHALL be delivered with
ordered revisions and cursors, and terminal and binary streams SHALL use
independent monotonic positions and acknowledgements so a reconnect resumes
from a confirmed position without duplicating content.

#### Scenario: Command replayed after reconnect
- **WHEN** a client resends a command id whose execution already completed
- **THEN** the server returns the recorded result for that command id
- **AND** the underlying operation is not executed a second time

#### Scenario: Uncertain outcome after disconnect
- **WHEN** a connection drops while a command is in flight
- **THEN** the client queries command status and resynchronizes from a snapshot
  and ordered events
- **AND** it does not assume either that the mutation committed or that it did
  not

#### Scenario: Stream resumed from a confirmed position
- **WHEN** a client reattaches to a stream after a transport loss
- **THEN** delivery resumes from the last acknowledged monotonic position
- **AND** no acknowledged content is delivered twice

### Requirement: Protocol types and client interface boundary
The client library SHALL expose one `TerminayClient` surface covering queries,
commands, subscriptions, connection state, and typed errors, and SHALL be the
only way client code reaches server state. The protocol SHALL be
transport-neutral and host-neutral: Electron window ids, browser ids, renderer
identifiers, user-facing titles, and transport-specific authorization SHALL NOT
appear in the contract. Transport-specific authentication SHALL complete before
or alongside the protocol adapter, and the server handshake SHALL report the
resulting canonical client identity, authorization scope, server identity, and
capabilities. A client SHALL NOT grant itself authority in its hello.

#### Scenario: Client claims elevated scope in its hello
- **WHEN** a client hello asserts an identity or authorization scope of its own
- **THEN** the server ignores the claim and reports the scope derived from the
  authenticated transport

#### Scenario: Host identifier offered as a contract field
- **WHEN** code attempts to send a renderer or window identifier as a protocol
  field
- **THEN** the closed schema rejects it as an unknown field

### Requirement: Transport neutrality and conformance
The shared framed transport interface SHALL expose explicit opening, open,
closing, closed, and failed lifecycle states, an asynchronous inbound
`Uint8Array` frame sequence, bounded queued and buffered byte counts, `send`,
`waitForWritable`, a bounded close operation, cancellation through
`AbortSignal`, and typed close reasons that carry no application behaviour.
`send(frame)` SHALL resolve when the adapter accepts the frame into its bounded
queue and SHALL NOT be treated as evidence that the peer received,
acknowledged, or committed the message; those guarantees come only from
application acknowledgements, stream positions, and command results. Shared
protocol and client code SHALL use `Uint8Array` rather than Node `Buffer`. One
reusable conformance suite SHALL cover malformed, duplicate, stale, cancelled,
oversized, slow-consumer, reconnect, and incompatible-version cases, and every
transport adapter SHALL pass it.

#### Scenario: Accepted send is not a delivery guarantee
- **WHEN** `send(frame)` resolves on a transport adapter
- **THEN** the caller treats the frame only as queued
- **AND** it waits for an application acknowledgement, stream position, or
  command result before treating the message as delivered

#### Scenario: Slow consumer
- **WHEN** a peer stops draining and the adapter's bounded queue fills
- **THEN** `waitForWritable` defers further sends rather than growing the queue
  without limit

#### Scenario: One suite across adapters
- **WHEN** the conformance suite runs against a new transport adapter
- **THEN** the same malformed, duplicate, stale, cancelled, oversized,
  slow-consumer, reconnect, and incompatible cases produce the same
  deterministic outcomes as on the in-memory adapter

### Requirement: Declared contract gates across components
Applications and shared packages SHALL declare their public entry points
explicitly, and dependency direction SHALL be validated automatically rather
than by convention. A checker SHALL inspect static imports, exports, dynamic
imports, and `require` calls, and SHALL reject imports across application source
trees, undeclared dependencies hidden by workspace hoisting, package-internal or
generated-output deep imports, Electron imports from server-owned code, Node,
Electron, WebRTC, WebSocket, or concrete local-transport imports from protocol,
client, or shared UI code, client or UI imports from server-owned code, and
renderer imports from privileged host code. The checker SHALL run in normal
continuous integration, and its test suite SHALL include representative
forbidden fixtures so that a checker which stops inspecting a syntax form fails
rather than passing vacuously.

#### Scenario: Forbidden import in a pull request
- **WHEN** shared client code adds an import of Electron or a concrete
  transport library
- **THEN** the boundary checker fails continuous integration and names the
  rejected import

#### Scenario: Checker regression
- **WHEN** the checker stops inspecting dynamic imports
- **THEN** the forbidden fixtures for that syntax form fail, so the regression
  is caught rather than silently accepted

### Requirement: Supported runtime matrix
The supported Node, Electron, browser, and platform versions SHALL be declared
in one place and SHALL gate the build. Shared protocol and client artifacts
consumed by server and UI builds SHALL be produced deterministically, so that
building twice yields identical sorted artifact hashes.

#### Scenario: Nondeterministic artifact
- **WHEN** a shared package build produces different bytes on two consecutive
  builds of the same source
- **THEN** the sorted-hash comparison gate fails the build

#### Scenario: Unsupported runtime version
- **WHEN** a build runs on a runtime version outside the declared matrix
- **THEN** the build fails rather than producing an artifact of unknown support
