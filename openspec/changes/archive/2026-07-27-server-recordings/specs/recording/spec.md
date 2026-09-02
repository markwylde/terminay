## ADDED Requirements

### Requirement: Server-owned capture independent of clients

Recordings SHALL live on the selected Terminay Server. Capture SHALL continue independently of client focus, renderer lifetime, or network connection and SHALL NEVER pass through the hosted signaling service.

#### Scenario: Client disconnects during capture

- **WHEN** a client loses focus, reloads, or disconnects while a recording is active
- **THEN** capture continues on the server

#### Scenario: No observers remain

- **WHEN** every observing client disconnects while a recording is active
- **THEN** the recording remains server-owned and continues

#### Scenario: Hosted service is not in the path

- **WHEN** a session is recorded
- **THEN** no recording data passes through the hosted signaling service

### Requirement: Replaceable recording observers

Recording observers SHALL be replaceable subscriptions: disconnecting, reloading, or moving a view SHALL remove only that observer. Multiple observers SHALL receive the same server lifecycle snapshots, while each PTY boundary event SHALL be appended exactly once.

#### Scenario: Multiple observers

- **WHEN** several clients observe the same recording
- **THEN** each receives the same lifecycle snapshots while each PTY boundary event is appended to the recording exactly once

#### Scenario: One observer leaves

- **WHEN** one observing view disconnects, reloads, or moves
- **THEN** only that observer is removed and the recording continues

### Requirement: Terminay Server recording ownership

Terminay Server SHALL own recording policy and storage configuration, capture of PTY output, authorized input, resize, and lifecycle events, asciicast and metadata persistence, recording state, listing, replay reads, and deletion, and path validation, retention, and recovery. Clients SHALL display recording state, request explicit actions, and render replay data through bounded application-protocol transfers, and SHALL NOT require direct filesystem access to use recordings.

#### Scenario: Client without filesystem access

- **WHEN** a client with no direct filesystem access uses recordings
- **THEN** it can display state, request actions, and render replay data through bounded protocol transfers

### Requirement: Authorized recording operations

The server SHALL expose `recordings.list`, `recordings.replay`, `recordings.start`, `recordings.stop`, `recordings.delete`, and `recordings.reveal` through one transport-neutral adapter. Every operation SHALL be authorized against the authenticated device and the exact server, project, and scope identity. Replay SHALL be bounded and cancellable. `recordings.reveal` SHALL invoke a host callback and SHALL NOT return a cast path.

#### Scenario: Cross-scope operation

- **WHEN** an operation addresses a recording outside the authenticated scope
- **THEN** it is rejected

#### Scenario: Bounded replay

- **WHEN** a client replays a large recording
- **THEN** it receives bounded ranges that it can cancel

#### Scenario: Reveal on a capable host

- **WHEN** a capable host representing the server machine reveals a recording
- **THEN** a host callback is invoked and no cast path is returned to the client

#### Scenario: Reveal elsewhere

- **WHEN** the connected host does not represent the server machine
- **THEN** reveal is unavailable and the client is offered path and copy guidance instead

### Requirement: Capture lifecycle boundaries

Automatic capture SHALL start at the privileged PTY creation boundary before the shell can produce its first output event. The first known dimensions SHALL be written to the header and a later fit SHALL emit an `r` event. Output SHALL be recorded once at the server PTY boundary before fan-out to clients. Authorized writes SHALL be recorded once at the server input boundary when input capture is enabled. Terminal exit SHALL finalize the recording exactly once.

#### Scenario: First shell output

- **WHEN** a terminal with automatic capture enabled starts
- **THEN** capture is already active before the shell's first output event

#### Scenario: Terminal resized after start

- **WHEN** the terminal fits to a new size after the header is written
- **THEN** an `r` event records the new dimensions

#### Scenario: Output fan-out

- **WHEN** output reaches multiple clients
- **THEN** it is recorded once at the server PTY boundary

### Requirement: Finalization and interruption

Explicit terminal close, server shutdown, recording stop, and fatal writer error SHALL all finalize with an accurate state. A fatal writer error SHALL close and remove the active writer while retaining its visible failed state. Client disconnect, reload, window close, or view movement SHALL NOT finalize an active recording. A server restart SHALL mark an unfinalized recording interrupted and SHALL preserve its valid events. Concurrent stop requests SHALL be idempotent.

#### Scenario: Server shutdown

- **WHEN** the server shuts down with active recordings
- **THEN** each finalizes with an accurate state rather than corrupting the cast

#### Scenario: Server restart with an unfinalized recording

- **WHEN** the server restarts after an unclean stop
- **THEN** the unfinalized recording is marked interrupted and its valid events are preserved

#### Scenario: Client-side lifecycle events

- **WHEN** a client disconnects, reloads, closes a window, or moves a view
- **THEN** the active recording is not finalized

#### Scenario: Concurrent stop

- **WHEN** two authorized stop requests arrive for the same recording
- **THEN** the recording is finalized once and both requests succeed

### Requirement: Recording recovery states

A recording SHALL carry an explicit state covering interrupted, missing, malformed, and failed outcomes. A truncated or malformed cast SHALL be listed with its state rather than removed or silently repaired. A write failure caused by exhausted capacity SHALL persist a failed lifecycle that contains no filesystem path.

#### Scenario: Truncated cast file

- **WHEN** a cast file is truncated or malformed
- **THEN** the timeline lists it with its recovery state instead of hiding or repairing it

#### Scenario: Exhausted capacity during capture

- **WHEN** the recording stream fails because storage capacity is exhausted
- **THEN** a failed lifecycle is persisted without any filesystem path

### Requirement: Legacy recording root references

Supported historical recording roots SHALL be registered by metadata-only opaque reference. Registration SHALL NOT move, copy, or rewrite user data. A registered root that is currently unavailable SHALL remain in the library index rather than disappearing.

#### Scenario: Registering a historical root

- **WHEN** a supported legacy recording root is imported
- **THEN** it is registered by opaque metadata reference and no user data is moved

#### Scenario: Unavailable legacy root

- **WHEN** a registered legacy root is not currently available
- **THEN** it remains listed in the library index

### Requirement: One accepted-input boundary for capture policy

Input capture SHALL be applied at the server's single accepted-input boundary, so keyboard, paste, macro, dictation, MCP, and remote writes are all governed by the same policy. No input source SHALL be able to reach the terminal without passing that boundary.

#### Scenario: Input from an alternative source

- **WHEN** input arrives from a macro, dictation, MCP, or a remote client
- **THEN** it passes the same accepted-input boundary and the same capture policy applies

## MODIFIED Requirements

### Requirement: Recording security and privacy

Recording SHALL remain opt-in and input capture SHALL require separate consent. Cast and metadata paths SHALL be server-authorized by opaque recording id. Remote clients SHALL receive only recordings within their authorized server scope. Recording data SHALL NOT be uploaded to Terminay-hosted infrastructure. Logs SHALL exclude terminal content and recorded input. Recording lifecycle notifications SHALL be metadata-only; configured roots, absolute cast paths, environment secrets, and recorded input SHALL NOT be copied into observer payloads or normal diagnostics. Persisted cast paths SHALL be removed from recording list responses before local or remote transport, and recording data SHALL NOT be part of remote application resume payloads. Secret values from settings or macros SHALL NOT be added to metadata. A recording SHALL be treated as sensitive terminal history in warnings, export, deletion, and support diagnostics.

#### Scenario: Cross-scope request

- **WHEN** a remote client requests a recording outside its authorized server scope
- **THEN** the request is rejected

#### Scenario: Lifecycle notification payload

- **WHEN** a recording lifecycle notification is published
- **THEN** it carries metadata only, without configured roots, absolute cast paths, environment secrets, or recorded input

#### Scenario: List response leaves the server

- **WHEN** a recording list response is sent over a local or remote transport
- **THEN** it contains no persisted cast path

#### Scenario: Stale or forged request

- **WHEN** a traversal attempt, cross-server id, stale delete request, or unauthorized replay request arrives
- **THEN** it is rejected
