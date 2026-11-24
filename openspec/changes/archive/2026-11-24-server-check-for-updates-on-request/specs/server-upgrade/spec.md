## ADDED Requirements

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
