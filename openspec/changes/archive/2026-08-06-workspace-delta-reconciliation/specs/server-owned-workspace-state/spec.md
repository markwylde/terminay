## ADDED Requirements

### Requirement: Workspace delta envelope

The server SHALL answer a workspace delta request with one runtime-validated
envelope containing the resulting scoped workspace state and the ordered events
that produced it. The client and the server SHALL use the same shared
validators and types for that envelope, and a delta envelope SHALL NOT be
parsed as a complete snapshot. Before publication the client SHALL validate
server identity, schema, revision and cursor monotonicity, event bounds, scope,
references, and agreement between the envelope and its embedded state.

#### Scenario: Delta is not parsed as a snapshot

- **WHEN** the server returns a delta envelope
- **THEN** it is parsed as a delta
- **AND** it is not passed to the complete-snapshot parser

#### Scenario: Envelope disagreeing with its state is rejected

- **WHEN** the ordered events in an envelope do not agree with the scoped state
  it carries
- **THEN** the envelope is rejected before publication

#### Scenario: Non-monotonic revision is rejected

- **WHEN** a delta carries a revision or cursor that is not monotonic against
  the last confirmed projection
- **THEN** it is rejected as stale

### Requirement: Atomic delta application and bounded recovery

A valid delta SHALL be applied atomically to the cached projection and
published once. An invalid or stale delta SHALL leave the last confirmed
projection in place, mark it stale, and trigger exactly one bounded
full-snapshot recovery without a polling loop. An invalid delta SHALL NOT
partially mutate the projection. Changes arriving during a refresh SHALL be
coalesced, and the published revision SHALL NOT regress or skip a committed
mutation.

#### Scenario: Invalid delta cannot partially apply

- **WHEN** a delta fails validation part-way through its events
- **THEN** the cached projection is unchanged

#### Scenario: One bounded recovery

- **WHEN** a delta is rejected
- **THEN** the client performs a single full-snapshot recovery
- **AND** it does not repeat the request in a loop

#### Scenario: Coalesced refresh does not regress

- **WHEN** further changes arrive while a refresh is in flight
- **THEN** they are coalesced
- **AND** the final published revision neither regresses nor skips a committed
  mutation

### Requirement: Reconciliation failure is observable

A reconciliation failure SHALL be surfaced through the connection and workspace
state and through diagnostics. It SHALL NOT be discarded inside an event or
resync callback. A client whose delta failed SHALL either recover from a
complete authorized snapshot or report a typed connection failure.

#### Scenario: Failure is visible, not silent

- **WHEN** delta reconciliation fails
- **THEN** the workspace state is marked stale and the failure is reported
- **AND** the client does not continue presenting the state as current

### Requirement: Cross-client convergence for panel changes

Every connected client of one server SHALL converge on the same server-owned
workspace revision after panel and project mutations, with the same panel and
terminal session identities, without a reload or polling. Recovery SHALL remain
scoped: a project-scoped client SHALL NOT obtain objects or change records
belonging to another project during delta or fallback snapshot recovery.

#### Scenario: Desktop mutation reaches a connected browser

- **WHEN** a second terminal tab is opened in Desktop
- **THEN** an already-connected browser shows it at the same workspace
  revision, panel id, and terminal session id

#### Scenario: Browser mutation reaches Desktop

- **WHEN** a tab is created or closed in the browser
- **THEN** Desktop converges identically without a reload

#### Scenario: Scope holds during recovery

- **WHEN** a project-scoped client performs delta or fallback snapshot recovery
- **THEN** it receives no objects or change records belonging to another project
