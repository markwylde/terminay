## ADDED Requirements

### Requirement: Consumed pairing links stop admitting new peers

When an enrollment request is approved or denied, the server SHALL rotate or invalidate its one-time pairing room before completing the decision response, independent of client platform or whether the peer later closes normally. A later attempt to use the same link SHALL fail with an error that identifies it as already used or expired and directs the user to generate a fresh link. Rotation SHALL NOT disconnect an authenticated peer that completed enrollment or existing paired-device connections.

#### Scenario: Decided link is retired immediately

- **WHEN** the host approves or denies an enrollment request for a pairing room
- **THEN** the room is no longer available to a new `client-join` before the decision completes

#### Scenario: Reusing an approved link gives recovery guidance

- **WHEN** a client attempts to join a consumed or expired pairing room
- **THEN** it is rejected without replacing a live peer and receives a fresh-link recovery message

### Requirement: Desktop and server expose transport-path diagnostics

The Desktop pairing and reconnect host and the standalone signaling host SHALL record the selected WebRTC candidate-pair state, candidate types, and protocol when the pair is selected or changes. Diagnostics SHALL exclude candidate addresses and ports, pairing fragments, pairing secrets, device keys, tickets, SDP, and application data.

#### Scenario: Candidate pair is selected

- **WHEN** ICE selects or changes its candidate pair
- **THEN** both peers emit a structured diagnostic identifying local and remote candidate types, protocol, and pair state without candidate addresses, ports, credentials, or SDP

#### Scenario: Candidate-pair diagnostics are recorded

- **WHEN** pairing later fails or the peer disconnects
- **THEN** the preceding candidate-pair details are available in the local diagnostics for both sides

#### Scenario: Candidate diagnostics omit network identifiers

- **WHEN** the selected candidate pair changes
- **THEN** local diagnostics include its types, protocol, and state but omit candidate addresses and ports

### Requirement: Desktop observes transport loss after connection establishment

Desktop SHALL continue observing WebRTC peer, ICE, and required data-channel state after initial connection setup resolves. A terminal peer failure or closure, a required lane closing after the handshake, or ICE remaining `disconnected` for 15 seconds SHALL end that peer and notify the owning pairing or connection flow once, and SHALL release every request and approval wait pending on that peer without waiting for their own timeouts. A saved profile SHALL remain available for retry. When Desktop closes a peer itself it SHALL close the peer's data lanes first, so the server retires the peer and any approval it requested instead of holding them until a timeout.

#### Scenario: Peer fails after channels open

- **WHEN** a peer enters `failed` or `closed` after its channels have opened
- **THEN** the Desktop connection flow is notified once and marks that connection as unavailable

#### Scenario: Peer disconnect recovers within grace

- **WHEN** the peer and ICE report `disconnected`
- **THEN** Desktop retains the connection during the recovery grace period and reports failure if the peer does not recover before the grace expires

#### Scenario: ICE blip while peer remains connected

- **WHEN** ICE reports `disconnected` while the peer remains `connected` and ICE reconnects within 15 seconds
- **THEN** Desktop retains the connection, reports the path as degraded and then recovered, and reports no failure

#### Scenario: ICE stays disconnected

- **WHEN** ICE reports `disconnected` and has not reconnected after 15 seconds, whatever the peer state reports
- **THEN** Desktop ends the peer and notifies the owning flow once

#### Scenario: Server goes away while Desktop awaits approval

- **WHEN** the pairing peer is lost while Desktop is waiting for the host to approve its match code
- **THEN** the pairing attempt rejects with a connection-loss error instead of waiting for the approval to expire, and no device identity or profile is saved

#### Scenario: Desktop closes a peer with an approval pending

- **WHEN** Desktop closes its pairing peer while the host still shows its request as pending
- **THEN** the server retires the peer and withdraws the pending request, so it can no longer be approved

#### Scenario: Bootstrap lanes close after transfer

- **WHEN** the `api` or `asset` bootstrap lane closes after it has opened and completed its transfer
- **THEN** Desktop keeps the connection alive because those lanes are not required for the established session
