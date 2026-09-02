## ADDED Requirements

### Requirement: Connection failure state machine
A client SHALL treat loss of outbound events as full connection loss rather
than a feature-specific frozen state. On that loss it SHALL mark cached
projections stale, disable unsafe mutations, authenticate a replacement
transport, and resume subscriptions from confirmed revision and position
watermarks. A half-closed transport MUST NOT be reused by reconnect.

#### Scenario: Frozen event path
- **WHEN** the server-to-client event path can no longer deliver
- **THEN** the client reports connection loss, marks projections stale, and
  disables mutations rather than continuing to accept input against a frozen
  feature

#### Scenario: Reconnect never reuses a half-closed transport
- **WHEN** reconnect selects a transport
- **THEN** a half-closed transport is excluded and a replacement is
  authenticated

### Requirement: Post-reconnect restoration
After reconnection a client SHALL restore workspace and terminal subscriptions
from confirmed watermarks without loss, duplication, or creation of another
PTY.

#### Scenario: Browser reconnect after a forced socket failure
- **WHEN** a browser's socket is forced through closing and failure while PTY
  output is streaming, and the browser then reconnects
- **THEN** workspace and terminal subscriptions resume from their confirmed
  watermarks with no lost or duplicated output and no new PTY
