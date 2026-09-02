## ADDED Requirements

### Requirement: Single connection generation per mounted workspace
The hosted generation set SHALL retain only live connection generations. A
generation SHALL be removed from the set as soon as its lifecycle fails, and
every generation SHALL be closed when the host stops. Closed transport peers
SHALL NOT be retained in the host process until it exits.

#### Scenario: Generation lifecycle fails
- **WHEN** a connection generation's lifecycle fails
- **THEN** it is dropped from the hosted generation set immediately

#### Scenario: Host stops
- **WHEN** the remote host stops
- **THEN** every generation in the set is closed

#### Scenario: Reconnect storm
- **WHEN** a device reconnects repeatedly over a long period
- **THEN** only the live generation is retained
- **AND** a new connection hydrates a checkpoint and then streams later
  terminal output normally

### Requirement: Durable reconnect registration
Device signaling registration SHALL be refreshed on a bounded delay of twenty
minutes after registration. Refresh SHALL NOT accumulate closed peers in the
hosted generation set.

#### Scenario: Refresh after a long-lived registration
- **WHEN** the device signaling refresh runs twenty minutes after registration
- **THEN** the registration is renewed
- **AND** no closed peer is added to or retained in the generation set
