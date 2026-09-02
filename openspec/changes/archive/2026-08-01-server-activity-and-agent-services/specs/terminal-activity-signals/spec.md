## ADDED Requirements

### Requirement: Server-side parsing pipeline

Structured signal parsing SHALL run beside the server PTY stream and SHALL
leave output bytes unmodified as they are forwarded to clients. Fallback
interpretation, inactivity timeouts, foreground-process signals, and
acknowledgement authority SHALL be owned by the server. No client host SHALL
maintain a parallel terminal or activity authority.

#### Scenario: Parsed output is forwarded unchanged

- **WHEN** a terminal emits bytes that contain structured activity sequences
- **THEN** the server parses them for activity
- **AND** the client receives the original bytes unmodified

#### Scenario: Embedded host delegates instead of duplicating

- **WHEN** an embedded Desktop renderer requests terminal creation or an
  inactivity wait
- **THEN** the request is served by the server terminal service
- **AND** no host-side PTY authority answers it

### Requirement: Foreground process facts follow the session

The terminal runtime adapter SHALL emit deduplicated foreground process and
shell facts only while a subscriber is attached, and SHALL carry the immutable
server, project, and terminal session identity with each fact. The subscription
SHALL be disposed when the terminal exits.

#### Scenario: Repeated identical facts are suppressed

- **WHEN** the foreground process is reported unchanged
- **THEN** no further foreground change is published

#### Scenario: Exit disposes the observer

- **WHEN** a terminal exits
- **THEN** its foreground observation is disposed
- **AND** no later foreground fact is attributed to that session

### Requirement: Activity protocol surface

The server SHALL expose the canonical activity projection through an
authenticated `activity.snapshot` query, an `activity.delta` query, ordered
`activity` events, and an `activity.acknowledge` command bound to exact
identities. A client SHALL apply snapshot and replay state and SHALL request a
fresh snapshot when it detects a gap.

#### Scenario: Ordered publication

- **WHEN** activity transitions occur
- **THEN** they are published as ordered events after the snapshot they follow

#### Scenario: Client resyncs on a gap

- **WHEN** a client detects a gap in the ordered activity stream
- **THEN** it requests a complete snapshot rather than inferring the missing
  transitions

#### Scenario: Acknowledgement is identity-bound

- **WHEN** a client acknowledges an activity entry
- **THEN** the acknowledgement is accepted only for that entry's exact project
  and terminal session
- **AND** acknowledgement of a sibling session or a forged cross-project target
  is rejected

### Requirement: Renderer-authorized embedded terminal access

Embedded terminal reads and mutations SHALL be authorized against the attached
renderer before reaching server-owned terminal state. Reads from an unattached
renderer SHALL be rejected, and mutations from one SHALL have no effect.

#### Scenario: Unattached renderer is refused

- **WHEN** an unattached renderer requests the current working directory or
  buffer of a terminal
- **THEN** the request is rejected

#### Scenario: Unattached mutation is inert

- **WHEN** an unattached renderer requests a kill or a remote metadata update
- **THEN** the request is a no-op

### Requirement: Scoped client facts without a canonical client

The server SHALL accept scoped focus, viewed, and recent-input facts from any
authorized client without treating one client as canonical. Multiple attached
clients SHALL observe one identical ordered transition sequence and identical
acknowledgement revisions.

#### Scenario: Two clients converge

- **WHEN** two clients are attached to the same server and an activity
  transition occurs
- **THEN** both observe the same ordered transition sequence and revision

#### Scenario: Reconnect reproduces current state

- **WHEN** a client reconnects
- **THEN** it receives exactly the current snapshot without duplicated or
  invented transitions
