## ADDED Requirements

### Requirement: Single connection generation per mounted workspace

A mounted workspace SHALL be served by exactly one host-owned transport
generation at a time. A failure SHALL be delivered once, carrying the exact
generation identity, and the stale application client, peer, data channels,
subscriptions, and attachments SHALL be retired before a replacement begins.
Automatic recovery and manual retry SHALL create a fresh generation and SHALL
NOT consult, await, or reuse retired peer or channel state.

#### Scenario: One replacement per fault

- **WHEN** a required lane or the native peer fails
- **THEN** exactly one replacement generation is created

#### Scenario: Repeated retry during backoff coalesces

- **WHEN** retry is invoked repeatedly while the host is unreachable and
  reachability is then restored
- **THEN** the requests coalesce into one successful replacement generation

#### Scenario: Identity survives replacement

- **WHEN** a replacement generation becomes usable
- **THEN** the workspace revision, active project, panel, terminal session, and
  single PTY are unchanged

### Requirement: Explicit generation liveness signals

Termination or failure of the server application-protocol reader SHALL be
treated as failure of the whole host-owned transport generation, even when the
native peer and every required data channel remain open. The host SHALL NOT
continue to present such a transport as connected.

#### Scenario: Split-brain protocol failure is detected

- **WHEN** the server application-protocol reader ends while the peer and
  application data channel are still open
- **THEN** the host fails that transport generation and begins replacement

#### Scenario: Retry is not trapped behind a stale generation

- **WHEN** the user retries after a protocol-only failure
- **THEN** a fresh generation is created rather than reusing or awaiting the
  stale one

### Requirement: Bootstrap lanes close after application handoff

Bootstrap-only enrollment and asset lanes SHALL be closed and unreachable after
a successful canonical application handoff and after every replacement. They
SHALL be independently faultable before handoff and SHALL NOT be treated as
permanent mounted lanes.

#### Scenario: Bootstrap lanes are closed after handoff

- **WHEN** a mounted application handoff or replacement completes
- **THEN** the bootstrap enrollment and asset lanes are closed and unreachable

### Requirement: Bounded generation establishment

Establishing a replacement generation, including terminal hydration and its
verification, SHALL be bounded. A candidate transport that acquires an endpoint
but never becomes usable SHALL be retired and the client SHALL return to a
retry-wait state, so a manual retry can activate a fresh generation.

#### Scenario: Unusable candidate retires

- **WHEN** a candidate generation acquires an endpoint but never becomes usable
- **THEN** it is retired and the client returns to retry-wait
- **AND** one manual retry then activates a fresh generation

### Requirement: Isolation of one failing generation

The failure or retry of one browser generation SHALL NOT affect a Local Desktop
client, another browser client, or server-owned terminal processes.

#### Scenario: Others are unaffected

- **WHEN** one browser generation fails and retries
- **THEN** Local Desktop, another connected browser, and the server-owned
  terminal processes continue unaffected

### Requirement: Content-free transport failure evidence

First-failure evidence for a transport generation SHALL record only an opaque
profile identifier, the transport generation, the lane label, peer and ICE
state, the lifecycle phase, the attempt, the close reason, and the outcome. It
SHALL NOT record terminal bytes, filesystem paths, credentials, SDP, ICE
candidates, or signaling secrets.

#### Scenario: Evidence carries no secrets

- **WHEN** a transport generation fails and first-failure evidence is recorded
- **THEN** the record contains only the permitted metadata fields
