## ADDED Requirements

### Requirement: Lane close does not hang up a connected peer

A `control` or `assets` data-channel close SHALL NOT tear down the WebRTC peer while the ICE connection is connected. The close SHALL be recorded as a metadata-only warning naming the channel and reporting `hangup: false`.

#### Scenario: Control lane closes while ICE is connected

- **WHEN** the `control` data channel closes and the ICE connection is connected
- **THEN** the peer is kept and a warning names the channel with `hangup: false`

#### Scenario: Assets lane closes while ICE is connected

- **WHEN** the `assets` data channel closes and the ICE connection is connected
- **THEN** the peer is kept and a warning names the channel with `hangup: false`
