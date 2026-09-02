## ADDED Requirements

### Requirement: ICE candidate policy
An exposing host SHALL configure its peers with the same STUN and TURN servers
that the browser receives for that exposure. An empty host ICE configuration
combined with client-only STUN and TURN is not a valid production
configuration.

#### Scenario: Shared ICE configuration
- **WHEN** a server is exposed and a browser is issued its ICE server list
- **THEN** the host peer is configured with that same list

### Requirement: Explicit generation liveness signals
A connected peer's liveness SHALL be derived from its peer and ICE state as
well as its application lane. A recoverable `disconnected` SHALL start one
bounded grace period; `failed`, `closed`, or grace expiry SHALL replace or close
that peer exactly once. Completion of the application-protocol reader SHALL
also fail that peer generation. Closing one peer MUST NOT close another live
client's connection or stop any PTY.

#### Scenario: ICE disconnected while the lane is open
- **WHEN** ICE reports `disconnected` while the application data channel is
  still `open`
- **THEN** the bounded grace period starts, and on expiry that one application
  connection is closed exactly once

#### Scenario: Recovery inside grace
- **WHEN** ICE returns to a connected state before the grace period expires
- **THEN** the peer remains live and no connection is closed

#### Scenario: Other clients unaffected
- **WHEN** one peer is closed for liveness failure
- **THEN** Local Desktop and other remote clients continue unaffected

### Requirement: One handshake at a time per room or session
`client-join` and `device-join` messages for one signaling socket SHALL be
serialized. A second join SHALL retire only an incomplete handshake and SHALL
NOT disturb an already authenticated connected peer. Answers and ICE candidates
SHALL apply only to the current handshake generation.

#### Scenario: Overlapping joins
- **WHEN** two `device-join` messages overlap
- **THEN** at most one live handshake exists and no answer is attached to a
  retired peer

#### Scenario: Authenticated peer survives a new join
- **WHEN** a new join arrives while an authenticated peer is connected
- **THEN** the connected peer stays up
