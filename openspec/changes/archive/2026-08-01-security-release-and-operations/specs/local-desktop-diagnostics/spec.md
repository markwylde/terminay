## ADDED Requirements

### Requirement: Telemetry-free diagnostics and opt-in support bundles

Local diagnostics SHALL be telemetry-free: no diagnostic data SHALL be
transmitted off the device automatically. A support bundle SHALL be produced only
on explicit user action and SHALL have its sensitive content redacted before it
is written.

#### Scenario: Diagnostics collected

- **WHEN** local diagnostics are collected during normal operation
- **THEN** nothing is transmitted off the device

#### Scenario: Support bundle requested

- **WHEN** a user explicitly requests a support bundle
- **THEN** it is produced with sensitive content redacted
