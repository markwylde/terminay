## ADDED Requirements

### Requirement: Embedded server exposure routes

An embedded Local server SHALL offer one primary WebRTC exposure lifecycle and
one independently controlled advanced direct network listener. Both SHALL bind
to the canonical embedded server authority rather than constructing a second
server. The private Local connection SHALL remain connected and separate from
both routes, and neither route SHALL rebind or replace it.

#### Scenario: Direct listener serves the same workspace

- **WHEN** the advanced direct network listener is started from a Local Desktop
  window
- **THEN** exactly one listener opens at the displayed origin
- **AND** a second Desktop or browser can pair, render the same workspace, and
  use an existing terminal

#### Scenario: Stopping one route leaves the other running

- **WHEN** WebRTC exposure is stopped
- **THEN** new WebRTC admission closes
- **AND** the Local workspace, its terminals, and an independently enabled
  direct listener continue running

#### Scenario: Stopping the direct listener is narrow

- **WHEN** the direct network listener is stopped
- **THEN** its network socket and admission close
- **AND** WebRTC exposure and the Local connection are unaffected

### Requirement: Exposure lifecycle is atomic and fails closed

Starting, stopping, and rotating an exposure route SHALL be atomic. A bind,
TLS, or protocol startup failure SHALL leave exposure stopped and SHALL publish
no usable pairing URL. Starting exposure again SHALL rotate its one-time
material.

#### Scenario: Bind failure publishes nothing

- **WHEN** the listener fails to bind or its TLS setup fails
- **THEN** exposure remains stopped and no pairing URL is published

#### Scenario: Restart rotates material

- **WHEN** exposure is stopped and started again
- **THEN** the one-time pairing material is rotated

### Requirement: Per-mode exposure availability is reported before use

The host SHALL report the availability of each exposure mode before the user
starts it. A mode whose privileged composition is incomplete SHALL be presented
as unavailable in this build, with its start and QR actions disabled, and SHALL
NOT allocate a hosted room. An unavailable WebRTC mode SHALL NOT cause the
direct network listener to start as an implicit fallback.

#### Scenario: Incomplete composition is disabled before click

- **WHEN** a build lacks the authenticated WebRTC composition
- **THEN** WebRTC exposure is shown as unavailable before the user clicks
- **AND** no hosted room is allocated

#### Scenario: No silent fallback

- **WHEN** the user starts the primary WebRTC exposure action and WebRTC is
  unavailable
- **THEN** the missing runtime or registrar is shown
- **AND** the direct network listener is not started instead

### Requirement: Privileged WebRTC peer composition

WebRTC exposure SHALL be composed only when one authenticated hosted registrar
supplies both room registration and per-peer SDP and ICE signaling, over an
integrity-pinned WebRTC runtime resolved from the staged runtime location. The
exposing peer SHALL run in-process as a privileged peer; it SHALL NOT create a
hidden renderer and SHALL NOT expose a renderer preload capability.

#### Scenario: One registrar supplies both functions

- **WHEN** room registration and per-peer signaling do not come from the same
  authenticated registrar
- **THEN** WebRTC exposure is not composed

#### Scenario: No renderer capability

- **WHEN** the privileged peer is running
- **THEN** it holds the WebRTC runtime, signaling, enrollment, live terminal
  sessions, and the verified UI bundle without a hidden renderer or preload
  capability

### Requirement: Bootstrap lanes hand off to the canonical session

After device authentication a WebRTC peer SHALL move to the canonical
`control`, `application`, `terminal`, and `assets` application session. The
bootstrap `api` and `asset` lanes SHALL remain scoped to enrollment and
verified UI installation. The authenticated ticket SHALL be consumed exactly
once before the embedded server accepts the application lane.

#### Scenario: Handoff to canonical lanes

- **WHEN** device authentication completes
- **THEN** the canonical application session lanes are established
- **AND** the bootstrap lanes remain limited to enrollment and bundle
  installation

#### Scenario: Ticket is single-use

- **WHEN** an authenticated ticket is presented a second time
- **THEN** the application lane is refused

### Requirement: Bounded exposure credential handling

Exposure SHALL bound incorrect PIN attempts, SHALL refuse a consumed or rotated
pairing URL, and SHALL bind reconnect proof to the exact origin and exact
server. Permitted device and reconnect records SHALL be persisted beneath the
host data root and restored only against that exact server identity and origin.

#### Scenario: Reused pairing URL is refused

- **WHEN** a consumed or rotated pairing URL is presented again
- **THEN** pairing is refused

#### Scenario: Reconnect proof is exact

- **WHEN** a stored reconnect record is presented from a different origin or
  for a different server identity
- **THEN** it is not accepted
