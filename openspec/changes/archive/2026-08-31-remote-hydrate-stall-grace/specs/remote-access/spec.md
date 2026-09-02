## ADDED Requirements

### Requirement: Hydration outbound stall grace
An outbound lane that pauses after a hydration checkpoint SHALL NOT fail as
stalled while inbound handshake traffic continues. A generation SHALL be failed
as outbound-stalled only when its first unacknowledged outbound frame is older
than the hydrate grace period of 15 seconds.

#### Scenario: Checkpoint dump followed by a short pause
- **WHEN** a generation sends a hydration checkpoint, pauses outbound for four
  seconds, and continues to receive handshake inbound frames
- **THEN** the generation is not failed and is not closed

#### Scenario: Stall beyond the grace
- **WHEN** the first unacknowledged outbound frame is older than the hydrate
  grace
- **THEN** the generation fails as outbound-stalled

### Requirement: Metadata-only diagnostics for peer-closed reasons
A peer-closed generation SHALL carry an explicit reason classification.
Outbound-stall and required-lane close SHALL each be classified as themselves
and MUST NOT be reported as an unclassified reason.

#### Scenario: Stall close is named
- **WHEN** a generation is closed because its outbound lane stalled past the
  grace
- **THEN** the recorded reason class names the stall rather than reporting an
  unclassified reason
