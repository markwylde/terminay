## ADDED Requirements

### Requirement: Explicit generation liveness signals
A remote connection SHALL have exactly one connection-scoped lifecycle
authority that evaluates combined peer and transport-candidate state. Neither
the peer callback nor the candidate callback SHALL close a connection
independently. A recoverable `disconnected` state SHALL start exactly one
bounded recovery grace period, which SHALL be cancelled when transport health
returns. An explicit `failed` or `closed` state SHALL close the connection
immediately. Expiry of the grace period SHALL close the connection exactly
once. Normal host cleanup SHALL cancel a pending recovery without publishing a
second close.

#### Scenario: Transient interruption recovers
- **WHEN** an authenticated session enters a recoverable `disconnected` state
  and returns to `connected` within the grace period
- **THEN** the connection is not closed
- **AND** it continues on its original application and terminal channels

#### Scenario: Interruption outlasts the grace period
- **WHEN** a recoverable `disconnected` state persists beyond the bounded
  recovery grace period
- **THEN** the connection closes exactly once

#### Scenario: Permanent failure
- **WHEN** the connection reports an explicit `failed` or `closed` state
- **THEN** it closes immediately without waiting for a grace period

#### Scenario: Host cleanup during pending recovery
- **WHEN** the host tears down normally while a recovery grace period is
  pending
- **THEN** the pending recovery is cancelled
- **AND** no second close is published

### Requirement: Recovery scope and revocation
Recovery SHALL reuse the existing authenticated peer and SHALL NOT recreate a
PTY, an application session, or an authentication. Recovery SHALL NOT delay or
mask device revocation. A connection's recovery or closure SHALL be scoped to
that connection alone.

#### Scenario: Recovery does not re-establish state
- **WHEN** a connection recovers from a transient interruption
- **THEN** no new PTY or application session is created

#### Scenario: Other clients unaffected
- **WHEN** one remote connection is recovering or closing
- **THEN** local Desktop and other remote clients continue unaffected
