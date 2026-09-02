## ADDED Requirements

### Requirement: One workspace renderer per selected server
Every connection entry path — initial open, auto-restore, explicit profile
selection, transport close, application-send failure, and manual retry — SHALL
reach one controller keyed only by stable profile id plus verified server and
session identity. URL, origin marker, client id, React mount, and transport
attempt MUST NOT act as alternative generation keys. Transport acquisition
SHALL be an injected host operation so that WebRTC, direct WebSocket, and
Desktop message-port providers satisfy the same interface without
transport-specific branches in the renderer.

#### Scenario: Entry paths converge
- **WHEN** a workspace is activated through any connection entry path
- **THEN** the same controller, stable profile identity, attempt ordering,
  disposal, hydration, and error semantics apply

#### Scenario: Retired client cannot act
- **WHEN** a late event arrives from a retired client
- **THEN** it cannot dispose, replace, or change UI state for the current
  client

#### Scenario: Activation follows enrollment
- **WHEN** pairing and enrollment complete for a new server
- **THEN** the stable profile is created or updated first and is then activated
  through the same controller used for a remembered profile
