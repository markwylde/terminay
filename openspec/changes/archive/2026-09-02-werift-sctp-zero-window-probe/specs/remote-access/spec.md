## ADDED Requirements

### Requirement: Outbound delivery recovers from a peer zero receive window

The WebRTC transport SHALL make progress again when a peer's receive window reopens. When the sender has queued outbound data, nothing in flight, and the peer's last advertised receive window is zero, it SHALL transmit exactly one chunk past that window and arm its retransmission timer, so an acknowledgement carrying the reopened window is elicited. The probe SHALL NOT grow the congestion window from its acknowledgement and SHALL remain bounded by the existing retransmission backoff. Outbound delivery SHALL NOT be permanently deadlocked while the peer connection reports connected and every lane reports open.

#### Scenario: Receiver stops draining

- **WHEN** a peer advertises a zero receive window and the sender has queued data with nothing in flight
- **THEN** the sender transmits one probe chunk and arms its retransmission timer rather than going idle

#### Scenario: Window reopens

- **WHEN** the peer's receive window reopens after it drains
- **THEN** outbound delivery resumes without a reconnect and without replacing the connection generation

#### Scenario: Probe does not inflate the window

- **WHEN** a zero-window probe is acknowledged
- **THEN** the congestion window is not grown from that acknowledgement

### Requirement: Serialized data-channel flush

A data-channel flush SHALL be serialized against re-entry. Because the flush draws from a queue shared by every channel of one association and is reachable from both the send path and the association's own callbacks, a flush already running SHALL NOT be entered again concurrently, so sends on one stream cannot interleave.

#### Scenario: Send during a running flush

- **WHEN** a send is issued while a flush of the shared outbound queue is already running
- **THEN** no second flush loop runs concurrently and sends on each stream stay in order

#### Scenario: Two channels flushing

- **WHEN** sends interleave on two channels of one association
- **THEN** each channel's stream is delivered in order

### Requirement: Ordered hash-pinned runtime patch set

The selected WebRTC runtime SHALL be an artifact built by the governed build from a pinned upstream source with an ordered list of patches. Each patch SHALL be pinned by hash and attested in the artifact's provenance, and the ordering SHALL be part of what is attested. The server SHALL validate the selection against that ordered list at load and SHALL refuse a selection whose patch set, order, hashes, or stated purposes do not match. No stage of that governance SHALL assume a fixed number of patches.

#### Scenario: Selection with an unexpected patch set

- **WHEN** the selected runtime's patch list, order, hashes, or purposes do not match the pinned record
- **THEN** the server refuses the selection at load

#### Scenario: Adding a patch

- **WHEN** a further patch is added to the runtime
- **THEN** the build script, selection record, server validation, and release-readiness check accept the extended ordered list without a fixed-count assumption

#### Scenario: Independent rebuild

- **WHEN** the candidate is rebuilt offline from the pinned source mirror a second time
- **THEN** the archive and every file hash are identical to the first build
