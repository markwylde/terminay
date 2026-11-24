# server-upgrade Specification

## Purpose
TBD - created by archiving change server-check-for-updates-on-request. Update Purpose after archive.

## Requirements

### Requirement: A paired device may ask for a release check now

A standalone server SHALL accept `server.upgrade.check` from an administrative connection. The request SHALL carry nothing; any field SHALL be rejected as a validation error and SHALL NOT start a check. The server SHALL read its own channel through its upgrader, publish the resulting status to every attached client, and reply with that status. A check already running SHALL be shared. A request within ten seconds of a check that read the channel SHALL be answered from it without reading again. A check that could not read the channel SHALL be refused with reason `check-failed` and SHALL leave the last known result in place. A server without an upgrader SHALL refuse with reason `cannot-check`. While an upgrade is in progress the server SHALL reply with its status without checking.

#### Scenario: A release published since the last check

- **WHEN** a paired device asks a Canary server to check and a newer Canary build was published since its last check
- **THEN** the reply and every attached client's status name that build as available

#### Scenario: Asked again at once

- **WHEN** a device asks again within ten seconds of a check that read the channel
- **THEN** the server replies with that check's status and does not read the channel again

#### Scenario: The channel cannot be read

- **WHEN** a requested check cannot read the release metadata
- **THEN** the request is refused with `check-failed` and the last known status stands

#### Scenario: A read-only connection asks

- **WHEN** a connection without administrative scope sends `server.upgrade.check`
- **THEN** it is refused as forbidden and no check runs

### Requirement: Upgrade status names real build versions

The version a server's upgrade status names as running SHALL be the version of the release its own process runs, and SHALL NOT lag behind an install record the upgrader has yet to rewrite. On a rolling channel, the available and latest versions SHALL be the published build's own version read from its manifest, never the channel's asset name.

#### Scenario: Canary build on offer

- **WHEN** a Canary server checks and a newer Canary build `6.10.0-main.3428.canary` is published
- **THEN** its status names `6.10.0-main.3428.canary` as available, not `canary`

#### Scenario: Status just after an upgrade

- **WHEN** a server restarts on `6.10.0-main.3428.canary` before the upgrader has rewritten its install record
- **THEN** its status names `6.10.0-main.3428.canary` as the running version, and a window that followed the upgrade reports it succeeded
