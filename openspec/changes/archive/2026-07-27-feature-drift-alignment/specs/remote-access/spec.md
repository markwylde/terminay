## ADDED Requirements

### Requirement: Distinct visible failure states
When a configured remote host cannot become ready, the client SHALL present an accurate
recoverable-state explanation. It SHALL distinguish registering, ready, relay loss after
readiness, pairing-peer loss, relay error, and premature close, and SHALL NOT report a
scaffold or unimplemented-handler state.

#### Scenario: Configured host cannot become ready
- **WHEN** a configured host fails to reach the ready state
- **THEN** the surface explains the recoverable state rather than reporting a scaffold or unavailable peer handler

#### Scenario: Loss after readiness
- **WHEN** the relay or pairing peer is lost after the host became ready
- **THEN** that state is reported distinctly from a relay error and from a premature close
