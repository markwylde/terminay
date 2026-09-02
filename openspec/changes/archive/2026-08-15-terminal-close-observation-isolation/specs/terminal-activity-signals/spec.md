## ADDED Requirements

### Requirement: Client projection of activity
Activity snapshot and delta reads SHALL return committed activity projection
state. They SHALL NOT start or await host foreground-process inspection. Exact
project filtering, ordered activity events, and snapshot resynchronization
semantics SHALL be preserved.

#### Scenario: Snapshot during slow host observation
- **WHEN** a client requests an activity snapshot while a session's
  foreground-process observation is slow
- **THEN** the snapshot returns committed projection state immediately
- **AND** it does not await that observation

#### Scenario: Project-filtered read
- **WHEN** a snapshot is requested for one project
- **THEN** it contains only that project's sessions, in the same ordered
  event sequence as before

### Requirement: Foreground observation availability
The canonical activity projection SHALL carry exact-session foreground
observation state of `available` or `limited`. Idle and busy SHALL NOT be
derived from raw terminal output.

#### Scenario: Observation unsupported by the environment
- **WHEN** a session's environment cannot inspect foreground processes
- **THEN** the projection reports `limited` for that session

#### Scenario: Output does not imply state
- **WHEN** a session produces continuous output
- **THEN** its foreground state is not inferred from that output

### Requirement: Session-owned bounded foreground observation
Each exact terminal session SHALL have at most one running foreground sample
and at most one replaceable latest pending sample. Continued PTY output SHALL
supersede obsolete pending sampling work and SHALL NOT require complete output
silence before the current sample settles. A slow, failed, or unsupported
observation SHALL be contained to its own session and SHALL publish only safe
metadata and state.

#### Scenario: Continuously emitting session
- **WHEN** a session emits output continuously
- **THEN** its foreground sampling, memory, and pending work stay bounded
- **AND** the current sample settles without requiring the producer to stop

#### Scenario: Failed observation
- **WHEN** foreground observation fails for one session
- **THEN** only that session reports a limited state and other sessions are
  unaffected

### Requirement: Destructive close protection
Closing one terminal SHALL consult only that exact
`{serverId, projectId, sessionId}` target, through a server-owned close
preflight rather than a global activity refresh. Target observation SHALL be
subject to a named bounded deadline with a cancellation path, and privileged
process inspection SHALL remain in the owning environment or host boundary.
When observation reaches its deadline or is unavailable, the confirmation SHALL
state the limited condition and SHALL default to keeping the terminal running.
The control SHALL NOT wait indefinitely and SHALL NOT assume idle from stale or
missing data. Project close aggregation SHALL remain limited to the project's
canonical sessions.

#### Scenario: Closing an idle terminal beside a noisy one
- **WHEN** the user closes an idle terminal while another terminal emits
  continuously
- **THEN** the close completes within the bounded control deadline
- **AND** the noisy terminal remains live

#### Scenario: Target observation times out
- **WHEN** the target's foreground observation reaches its deadline
- **THEN** a limited-state confirmation is presented defaulting to keeping the
  terminal running

#### Scenario: Non-shell foreground process
- **WHEN** a non-shell foreground process is running in one terminal
- **THEN** it protects only that exact terminal
