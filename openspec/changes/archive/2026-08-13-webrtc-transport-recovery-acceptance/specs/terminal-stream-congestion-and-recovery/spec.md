## ADDED Requirements

### Requirement: Transport failure recovery outcomes

Every required-lane failure and every peer failure SHALL either recover
automatically or reach a typed terminal state. A mounted workspace SHALL NEVER
be left silently inert. Recovery SHALL restore the mounted workspace without
navigation, enrollment UI, profile loss, duplicate project, panel, or terminal
session, or duplicate command, and SHALL NOT require a page reload. Explicit
browser refresh SHALL remain independently supported without being required by
retry.

#### Scenario: Automatic recovery restores the workspace

- **WHEN** a required lane fails while the workspace is mounted
- **THEN** the workspace is restored without navigation or re-enrollment
- **AND** no project, panel, or terminal session is duplicated

#### Scenario: Retry restores ordered input

- **WHEN** the user clicks retry after a failure
- **THEN** a fresh transport generation is created
- **AND** post-retry terminal input reaches the PTY exactly once, in order,
  without a page reload

#### Scenario: Refresh remains supported

- **WHEN** the user refreshes the browser instead of retrying
- **THEN** the bootstrap is recreated independently

### Requirement: ICE and peer state handling outcomes

Peer and ICE transitions — disconnected then recovered, disconnected past the
grace period, failed, closed, host shutdown, exposure stop, and device
revocation — SHALL each reach a defined outcome. A required-lane replacement
SHALL close the retired native peer, an independently closed native peer SHALL
produce exactly one replacement, and device revocation SHALL terminate the
active application generation.

#### Scenario: Transient disconnect recovers within grace

- **WHEN** the peer or ICE connection is disconnected and recovers within the
  grace period
- **THEN** the mounted workspace continues without a replacement generation

#### Scenario: Revocation terminates the generation

- **WHEN** the device is revoked
- **THEN** the active application generation is terminated

### Requirement: Uncertain terminal input is discarded, not replayed

When the outcome of a terminal input is unknown, the active input queue SHALL
close and discard both already-queued and later input for that queue, and a
replacement attachment SHALL NOT replay any of it. The client SHALL NOT infer or
blindly replay an uncertain terminal mutation.

#### Scenario: Unknown outcome closes the queue

- **WHEN** a terminal input outcome cannot be determined
- **THEN** the active queue closes and discards queued and later input

#### Scenario: Replacement cannot replay

- **WHEN** a replacement attachment is created after an unknown-outcome input
- **THEN** none of the discarded input is replayed

### Requirement: Presentation continuity across replacement

After a replacement generation becomes usable, the mounted emulator's row
geometry SHALL equal the canonical terminal dimensions, the terminal process
SHALL have received that exact resize, retained output SHALL remain painted, the
replacement SHALL own writable presentation control, and new canonical output
SHALL reach both the server output head and the mounted emulator. A terminal
created immediately after replacement SHALL actively reconcile the authoritative
workspace even if its change notification is lost, and SHALL complete only once
that snapshot contains its session and terminal panel.

#### Scenario: Geometry and output survive

- **WHEN** a replacement generation completes
- **THEN** the emulator geometry matches the canonical dimensions, retained
  output is still painted, and new output reaches the emulator

#### Scenario: Lost notification still reconciles

- **WHEN** the change notification for a terminal created after replacement is
  lost
- **THEN** the client reconciles the authoritative workspace
- **AND** creation completes only once the snapshot contains that session and
  panel

### Requirement: Typed recovery diagnostics

Recovery diagnostics SHALL report the typed lifecycle state rather than a broad
disconnected-client message, while user-facing language remains safe and
non-technical.

#### Scenario: Typed state replaces generic text

- **WHEN** a recovery-related failure is reported
- **THEN** the diagnostic identifies the typed lifecycle state
- **AND** the user-facing message stays safe and understandable
