## ADDED Requirements

### Requirement: Consumed pairing links stop admitting new peers

When a pairing approval consumes a one-time pairing room, the server SHALL rotate or invalidate that room before completing the approval response, independent of client platform or whether the peer later closes normally. A later attempt to use the same link SHALL fail with an error that identifies it as already used or expired and directs the user to generate a fresh link. Rotation SHALL NOT disconnect the peer that completed enrollment or existing paired-device connections.

#### Scenario: Approved link is retired immediately

- **WHEN** the host approves an enrollment request for a pairing room
- **THEN** the room is no longer available to a new `client-join` before the approval completes

#### Scenario: Reusing an approved link gives recovery guidance

- **WHEN** a client attempts to join a consumed or expired pairing room
- **THEN** it is rejected without replacing a live peer and receives a fresh-link recovery message

### Requirement: Desktop and server expose transport-path diagnostics

The Desktop pairing and reconnect host and the standalone signaling host SHALL record the selected WebRTC candidate-pair state and candidate types, protocol, and addresses when the pair is selected or changes. Diagnostics SHALL exclude pairing fragments, pairing secrets, device keys, tickets, SDP, and application data.

#### Scenario: Candidate pair is selected

- **WHEN** ICE selects or changes its candidate pair
- **THEN** both peers emit a structured diagnostic identifying local and remote candidate types, protocol, address, port, and pair state without credentials or SDP

#### Scenario: Candidate-pair diagnostics are recorded

- **WHEN** pairing later fails or the peer disconnects
- **THEN** the preceding candidate-pair details are available in the local diagnostics for both sides

### Requirement: Desktop observes transport loss after connection establishment

Desktop SHALL continue observing WebRTC peer and required data-channel state after initial connection setup resolves. A terminal peer failure or closure, or a required lane closing after the handshake, SHALL notify the owning pairing or connection flow once and allow its profile to remain available for retry.

#### Scenario: Peer fails after channels open

- **WHEN** a peer enters `failed` or `closed` after its channels have opened
- **THEN** the Desktop connection flow is notified once and marks that connection as unavailable

#### Scenario: Peer disconnect recovers within grace

- **WHEN** the peer and ICE report `disconnected`
- **THEN** Desktop retains the connection during the recovery grace period and reports failure if the peer does not recover before the grace expires

#### Scenario: ICE blip while peer remains connected

- **WHEN** ICE reports `disconnected` while the peer remains `connected`
- **THEN** Desktop retains the connection and leaves the application heartbeat and required lanes to detect a half-open transport
