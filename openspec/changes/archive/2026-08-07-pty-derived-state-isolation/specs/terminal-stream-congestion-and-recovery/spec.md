## ADDED Requirements

### Requirement: Reserved control capacity
Reliable control capacity SHALL be reserved for handshake, query, command, cancellation, and
subscription-control results. No other traffic SHALL consume it.

#### Scenario: Commands stay available under load
- **WHEN** one terminal emits sustained PTY output while a client is stalled
- **THEN** creating another terminal and completing workspace queries and commands on the
  same connection still succeeds

### Requirement: Bounded projection delivery for subscriptions
Every non-terminal subscription event SHALL be delivered through a bounded keyed
latest-value projection lane, because such events are reconstructible projections. Delivery
SHALL NOT fall back to reliable control capacity for any event name. Pending state for the
same feature and entity key SHALL be superseded in place without reordering unrelated keys.

#### Scenario: Agent snapshots use the projection lane
- **WHEN** provider journal replay publishes a rapid sequence of full agent snapshots to a
  stalled client
- **THEN** the snapshots are coalesced on the projection lane and reliable control capacity
  is not consumed

#### Scenario: No event-name fallback
- **WHEN** a subscription publishes a feature event that the delivery path has no specific
  handling for
- **THEN** it is still delivered on the bounded projection lane rather than the reliable
  control queue

#### Scenario: Keyed supersede is bounded
- **WHEN** many updates arrive for the same feature and entity key while the client is not
  draining
- **THEN** only the latest value is retained for that key and other keys keep their order

### Requirement: Projection congestion resynchronizes rather than disconnects
Projection-lane overflow SHALL be converted into scoped snapshot resynchronization for the
affected subscription. It SHALL NOT close or starve the application connection.

#### Scenario: Overflow emits a scoped resync
- **WHEN** a subscription's projection lane overflows for a lagging client
- **THEN** the client receives `event_resync` for that subscription, the connection stays
  open, and the client reloads that subscription's authoritative snapshot

#### Scenario: PTY volume cannot close the connection
- **WHEN** a terminal emits more than one thousand PTY callbacks before provider authority
  is claimed and the client does not drain
- **THEN** the application connection remains open and no queue-limit close occurs

### Requirement: Activity revisions are current state
Terminal activity SHALL be published as semantic transitions — status, attention,
acknowledgement, authority, progress, and exit — rather than one event per PTY callback.
Raw-output inactivity deadlines SHALL remain current regardless, and snapshot and delta
delivery SHALL converge to the latest authoritative activity state.

#### Scenario: Semantic publication under raw output
- **WHEN** a terminal produces continuous raw output before a provider claims authority
- **THEN** inactivity deadlines stay current while activity events are published only on
  semantic transitions

#### Scenario: Convergence after congestion
- **WHEN** a client resumes after lagging behind an activity workload
- **THEN** its activity state converges to the latest authoritative snapshot

### Requirement: Ordered writer across isolated lanes
Reliable control, state projection, and terminal presentation SHALL share one ordered
transport writer that makes fair progress across the lanes.

#### Scenario: No lane starves another
- **WHEN** terminal presentation and state projection are both saturated
- **THEN** reliable control frames continue to make progress and no lane is starved
