## ADDED Requirements

### Requirement: Upgrade status names real build versions

The version a server's upgrade status names as running SHALL be the version of the release its own process runs, and SHALL NOT lag behind an install record the upgrader has yet to rewrite. On a rolling channel, the available and latest versions SHALL be the published build's own version read from its manifest, never the channel's asset name.

#### Scenario: Canary build on offer

- **WHEN** a Canary server checks and a newer Canary build `6.10.0-main.3428.canary` is published
- **THEN** its status names `6.10.0-main.3428.canary` as available, not `canary`

#### Scenario: Status just after an upgrade

- **WHEN** a server restarts on `6.10.0-main.3428.canary` before the upgrader has rewritten its install record
- **THEN** its status names `6.10.0-main.3428.canary` as the running version, and a window that followed the upgrade reports it succeeded
