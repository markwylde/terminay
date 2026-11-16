## ADDED Requirements

### Requirement: Upgrade runs are serialised on the install

Every `daemon upgrade` run that may change the install SHALL hold an exclusive install-wide lock from before it records its start until after it records its ending. That covers in place, recreating a container, and installing the channel's latest. A lock whose holder is no longer running SHALL be taken over. A run that finds the lock held by a running process SHALL exit non-zero, saying another upgrade is running, and SHALL write no record. `daemon upgrade --check` is read-only: it SHALL take no lock and write no record.

#### Scenario: Two runs at once

- **WHEN** the helper's run starts while an operator's `daemon upgrade` holds the lock
- **THEN** the helper's run exits non-zero without writing the record, and the operator's run's records are untouched

#### Scenario: Holder died

- **WHEN** a run finds a lock left by a process that is no longer running
- **THEN** it takes the lock and proceeds

### Requirement: Every upgrade run is recorded under its run id

Every run that takes the lock SHALL choose a run id. It SHALL record a start, carrying that id and the running release, before it resolves the channel. It SHALL replace the start with exactly one ending carrying the same id before it releases the lock:

- succeeded, after the new release reports ready;
- rolled back, when the previous release was restored;
- unchanged, when the installed build was already current;
- failed, when the run stopped before changing the active release.

Records SHALL name releases by channel, version, and full revision. A failure after the new release is ready SHALL NOT replace a success already recorded. A run that is killed leaves its start record in place. Records SHALL be written atomically, stay readable by the account the server runs as, and contain no secret, device record, or workspace data. The root helper SHALL keep ignoring the request file's contents.

#### Scenario: Already current through the helper

- **WHEN** the helper runs `daemon upgrade --system` and the installed build is the channel's newest
- **THEN** the record holds a start and then an unchanged ending with the same run id naming the running release, and the command exits zero

#### Scenario: Channel unreachable

- **WHEN** `daemon upgrade` cannot resolve its channel
- **THEN** the record holds a failed ending with the reason, the active release is unchanged, and the command exits non-zero

#### Scenario: Bookkeeping fails after success

- **WHEN** the new release reports ready and pruning old versions then fails
- **THEN** the record keeps the succeeded ending

### Requirement: A recreate records its ending after the health verdict

`daemon upgrade --recreate` and its helper SHALL record a container recreate's ending only after the replacement container's health verdict. The ending SHALL be succeeded when the replacement became healthy, and rolled back when the previous container was restored.

#### Scenario: Replacement starts and then fails health

- **WHEN** the replacement container starts its server and then fails its health check
- **THEN** no succeeded ending is ever recorded for the run, and the record ends rolled back
