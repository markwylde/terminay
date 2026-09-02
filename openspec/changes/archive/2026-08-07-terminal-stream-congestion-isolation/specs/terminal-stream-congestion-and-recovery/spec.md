## ADDED Requirements

### Requirement: Presentation-stream traffic ownership

Raw terminal output SHALL NOT be delivered through the generic ordered event
journal. The server connection SHALL own a terminal-stream scheduler with one
independently bounded lane per exact terminal attachment and a separately
bounded control lane. Only the scheduler SHALL call the transport writer. It
SHALL preserve order within each lane and select ready terminal lanes fairly.
Exact attachment authorization and terminal event subscription semantics SHALL
be unchanged by this routing.

#### Scenario: Output bypasses the journal FIFO

- **WHEN** a terminal produces live output
- **THEN** it is delivered through that attachment's lane
- **AND** it is not enqueued into the connection-wide event journal FIFO

#### Scenario: Ordering within an attachment

- **WHEN** dimensions, presentation ownership, output, exit, and resync
  transitions occur for one attachment
- **THEN** they are delivered in that order on that attachment's lane

#### Scenario: Fair progress across noisy terminals

- **WHEN** several terminals produce sustained output at once
- **THEN** each attachment's lane makes progress

### Requirement: Reserved control capacity

Command and query results, workspace events, resync notifications, and
lifecycle traffic SHALL have reserved capacity on the control lane. Terminal
output SHALL NOT admit bytes against that reserved capacity.

#### Scenario: Commands work during congestion

- **WHEN** one terminal is congested
- **THEN** workspace commands and terminal creation still succeed

#### Scenario: Output cannot starve control traffic

- **WHEN** a terminal produces output faster than the transport drains it
- **THEN** control-lane results and events are still delivered

### Requirement: Lane overflow resynchronizes one attachment

Terminal-lane overflow SHALL move that attachment to a resync-pending state and
SHALL NOT fail the connection, the transport, or the PTY. Pending raw
presentation frames for that attachment SHALL be released, and a single
control-lane resync-required transition SHALL record the last confirmed and the
current output positions. Repeated congestion SHALL remain bounded and SHALL
NOT create an unbounded retry, checkpoint-pin, event-journal, parser, or
hydration queue.

#### Scenario: Congestion does not close the connection

- **WHEN** an attachment's lane exceeds its byte, frame, or age limit
- **THEN** that attachment enters resync-pending
- **AND** the shared application connection stays open

#### Scenario: One transition per overflow

- **WHEN** a lane overflows
- **THEN** exactly one resync-required transition is emitted on the control lane
  with the last confirmed and current output positions

#### Scenario: Unrelated terminals are unaffected

- **WHEN** one attachment is resynchronizing
- **THEN** other terminals remain interactive and their PTYs stay live

### Requirement: Checkpoint hydration rejoins live delivery contiguously

A resynchronizing client SHALL replace or clear only the affected emulator
presentation, hydrate from a newly pinned canonical checkpoint at a precise
safe position, and rejoin live delivery without gaps or duplicates. Controller
input for that presentation SHALL be restored only after valid hydration.

#### Scenario: No gap and no duplicate

- **WHEN** hydration from the pinned checkpoint completes
- **THEN** live delivery resumes contiguously from that position

#### Scenario: Input waits for hydration

- **WHEN** a presentation is hydrating
- **THEN** its controller input is restored only once hydration is valid

### Requirement: Connection failure state machine

Local and remote clients SHALL expose the observable lifecycle
`connected → reconnecting → resubscribing → hydrating → connected`. A disposed
client SHALL be replaced atomically under a generation guard with bounded
backoff, and a half-closed transport SHALL NOT be reused. A failed attempt
SHALL remain visible and retryable rather than leaving a disposed client
mounted.

#### Scenario: Reconnect is observable

- **WHEN** the transport fails
- **THEN** the client reports reconnecting, then resubscribing, then hydrating,
  before reporting connected again

#### Scenario: Commands fail promptly while reconnecting

- **WHEN** a new command is issued during reconnection
- **THEN** it fails promptly rather than timing out against an inert client
- **AND** the same command succeeds after recovery

#### Scenario: Failed recovery stays actionable

- **WHEN** recovery attempts are exhausted
- **THEN** an actionable retry state is presented
- **AND** the workspace is never left silently inert

### Requirement: Post-reconnect restoration

After a genuine transport failure the client SHALL reload authoritative
workspace state and reattach mounted terminal panels without creating another
PTY and without losing presentation identity. Mutations SHALL be re-enabled
only once workspace reload and terminal hydration have completed.

#### Scenario: No second PTY

- **WHEN** a mounted terminal panel is reattached after reconnection
- **THEN** it binds to the existing server terminal session
- **AND** no additional PTY is created

#### Scenario: Mutations wait for hydration

- **WHEN** a replacement connection is established
- **THEN** mutations are enabled only after workspace reload and terminal
  hydration complete

### Requirement: Content-free congestion diagnostics

Congestion and recovery diagnostics SHALL record only metadata: traffic class,
opaque attachment id, queued bytes and frames, last confirmed and head output
positions, congestion transitions, and connection rehydration outcome. They
SHALL NOT record terminal bytes.

#### Scenario: Diagnostics omit content

- **WHEN** a congestion transition is recorded
- **THEN** the record contains only metadata fields
- **AND** it contains no terminal output bytes

### Requirement: Burst and sustained-output outcomes

A finite or sustained terminal producer SHALL NOT close or starve the shared
application connection. Queue memory SHALL be bounded per attachment and per
traffic class. A deliberately stalled renderer SHALL NOT cause unbounded server
memory growth, and unrelated terminals and workspace commands SHALL remain
responsive throughout.

#### Scenario: Large finite burst completes

- **WHEN** a terminal emits a burst large enough to cross the presentation
  limits
- **THEN** the burst completes, subsequent input is accepted, the connection
  stays healthy, and a new terminal can be created

#### Scenario: Stalled renderer stays bounded

- **WHEN** a renderer stops consuming while its terminal keeps producing
- **THEN** server memory for that attachment stays bounded
- **AND** another terminal and workspace commands remain responsive

### Requirement: Identical rules for Local and remote clients

Local and remote clients SHALL obey identical delivery, resynchronization,
authorization, and recovery rules.

#### Scenario: Local and remote behave alike

- **WHEN** the same congestion or transport failure occurs over a Local
  transport and over a remote transport
- **THEN** the observed lane bounds, resynchronization, and recovery lifecycle
  are the same
