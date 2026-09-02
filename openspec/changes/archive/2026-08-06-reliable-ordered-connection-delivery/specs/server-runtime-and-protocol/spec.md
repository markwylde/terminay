## ADDED Requirements

### Requirement: Ordered outbound pump and fail-closed admission
Every command result, query result, error, replay frame, resync frame, and live
event SHALL leave a connection through one bounded outbound pump per ordered
lane. The pump SHALL preserve accepted frame order, observe transport
writability, and enforce queued byte and frame limits without holding feature
or journal locks while waiting. Send admission and connection close SHALL be
atomic: after the first terminal send failure the connection SHALL reject
pending and later sends with one typed connection reason. No transport send may
be issued without an owned rejection path that closes the connection exactly
once.

#### Scenario: Ordered delivery or explicit close
- **WHEN** frames are accepted on one ordered lane
- **THEN** they arrive in their accepted order, or the whole affected
  connection closes with an explicit reason; silent partial delivery is not a
  valid outcome

#### Scenario: Fail-closed after a send failure
- **WHEN** an outbound send fails terminally on a connection
- **THEN** no later command is accepted on that connection and pending sends
  reject with the same typed connection reason

#### Scenario: No escaping rejection
- **WHEN** a live event send triggered by PTY output is rejected
- **THEN** the rejection is observed by the connection, the connection closes
  once, and no `unhandledRejection` or `uncaughtException` is raised

### Requirement: Transport adapter lifecycle fidelity
WebSocket, MessagePort, and WebRTC adapters SHALL derive writability from both
their logical lifecycle and the current state of the underlying primitive. The
shared transport contract SHALL define send-versus-close, error-versus-close,
and backpressure-versus-abort behaviour deterministically, and duplicate close
or error notifications SHALL be idempotent.

#### Scenario: Closing socket is not writable
- **WHEN** the underlying socket has begun closing while the adapter's logical
  state is still open
- **THEN** the adapter reports itself as not writable and refuses admission

#### Scenario: Close during send
- **WHEN** a connection closes while a send is in flight
- **THEN** the outcome is deterministic and the connection reports exactly one
  close

### Requirement: Connection-scoped failure containment
A failed connection SHALL clean up only its own requests and subscriptions. It
MUST NOT terminate the host process, stop a PTY, or affect any other
connection.

#### Scenario: One failing browser peer
- **WHEN** one browser peer's transport fails during live PTY output
- **THEN** Desktop and the server continue running, the PTY continues, and
  other connections are unaffected

### Requirement: Metadata-only diagnostics
Connection diagnostics SHALL record first failure, close reason, queue
occupancy, and reconnect outcome as bounded metadata only.

#### Scenario: No content in diagnostics
- **WHEN** connection failure diagnostics are recorded
- **THEN** they contain no terminal bytes, payloads, credentials, paths, or
  project names
