## MODIFIED Requirements

### Requirement: Upgrade and rollback

`daemon upgrade [ref]` with no reference SHALL follow the installed channel: a `main` install upgrades to the newest `main` revision, a tagged install to the newest tag, and a source install requires an explicit reference. The CLI SHALL refuse an upgrade that would move to an older version unless `--allow-downgrade` is given. Upgrade SHALL verify and stage the new version beside the current one, stop the unit, switch `current`, start the unit, and wait for readiness; on failure it SHALL switch `current` back to the previous version, start it, and exit non-zero. The CLI SHALL NOT read or write server state in the data root during upgrade. After a successful upgrade exactly one previous version SHALL be retained and older versions removed.

#### Scenario: Follow the main channel

- **WHEN** a `main` install runs `daemon upgrade` and the `main` prerelease has a newer revision
- **THEN** that revision is installed and activated

#### Scenario: Refused downgrade

- **WHEN** the resolved version is older than the active one and `--allow-downgrade` is absent
- **THEN** the command fails and names both versions

#### Scenario: Readiness failure rolls back

- **WHEN** the upgraded server does not report ready within the timeout
- **THEN** `current` points back at the previous version, that version is started, and the command exits non-zero

#### Scenario: Retention

- **WHEN** an upgrade succeeds
- **THEN** the previous version remains under `versions/` and any older versions are removed

#### Scenario: Server state is untouched

- **WHEN** an upgrade succeeds or rolls back
- **THEN** the server's database, vault, identity, and recordings in the data root are byte-for-byte what they were, apart from what the running server itself wrote

## ADDED Requirements

### Requirement: The server archive carries the CLI

Every server archive SHALL contain the `terminay` CLI of the same version, runnable on the Node runtime the archive carries as `<version>/bin/terminay`. An installed server and a container server SHALL therefore be upgradable with no Node.js, npm, or registry access beyond the release download itself. The CLI in the archive and the `terminay` npm package of the same version SHALL be built from the same source and embed the same release public key.

#### Scenario: CLI present in an installed version

- **WHEN** a server version is installed
- **THEN** `<prefix>/current/bin/terminay daemon status` runs on a host with no system Node.js

#### Scenario: Same key as the npm package

- **WHEN** a release is built
- **THEN** the CLI inside the archive embeds the same release public key as the published npm package, and the release fails otherwise

### Requirement: System-scope upgrade helper

For a system-scope install, `daemon install` and `daemon upgrade` SHALL write two root-owned systemd units beside the service unit: a path unit that watches one request file the run-as account can write, and a oneshot service, started by that path unit, that runs the installed CLI's `daemon upgrade --system` as root with no reference and no other argument. The oneshot service SHALL execute only files under the root-owned install prefix and SHALL NOT read the request file's contents. The helper SHALL never downgrade. `daemon uninstall` SHALL remove both units. A user-scope install SHALL have no helper.

`daemon upgrade` SHALL add the helper to a system-scope install that lacks it.

#### Scenario: Helper installed

- **WHEN** a system-scope install completes
- **THEN** the path unit is enabled and active, and both units are owned by root and not writable by the run-as account

#### Scenario: Request triggers a fixed upgrade

- **WHEN** the run-as account writes the request file
- **THEN** the oneshot service runs `daemon upgrade --system` on the installed channel as root

#### Scenario: Request contents are ignored

- **WHEN** the request file contains a reference, a flag, or a path
- **THEN** the upgrade that runs is the same channel upgrade, to the same release, as with an empty file

#### Scenario: Upgrade adds a missing helper

- **WHEN** `daemon upgrade --system` runs as root against an install with no helper units
- **THEN** both units exist and the path unit is active afterwards

#### Scenario: Uninstall removes the helper

- **WHEN** `daemon uninstall --system` runs
- **THEN** neither helper unit remains

### Requirement: In-place upgrade inside a container

Inside the official image, `daemon upgrade` SHALL upgrade in place instead of refusing. It SHALL follow the image's channel, verify the archive exactly as on a systemd host, and stage the release under a releases directory on the data volume that holds release files only. It SHALL then mark that release as the one to run, ask the entrypoint to restart the server, and wait for readiness; on failure it SHALL mark the previous release, have the server restarted on it, and exit non-zero. It SHALL NOT stop the container and SHALL NOT require the Docker socket. Exactly one previous staged release SHALL be retained. `daemon install`, `start`, `stop`, and `uninstall` SHALL keep refusing inside a container and name the container-runtime action instead.

#### Scenario: Upgrade inside a running container

- **WHEN** `docker exec <container> terminay daemon upgrade` runs and a newer release exists
- **THEN** the server restarts on the newer release, the container does not restart, and terminals keep running

#### Scenario: Read-only root filesystem

- **WHEN** the container runs with a read-only root filesystem and a writable data volume
- **THEN** the in-place upgrade succeeds

#### Scenario: Readiness failure in a container

- **WHEN** the newer release does not report ready within the timeout
- **THEN** the previous release is running again and the command exits non-zero

#### Scenario: Install still refused

- **WHEN** `daemon install` runs inside the official image
- **THEN** it refuses and names pulling a different image

### Requirement: Upgrade outcome record

Every `daemon upgrade` that moves, or attempts to move, the active version SHALL leave a record beside the installed versions stating the version it moved from, the version it moved to or attempted, whether it succeeded or rolled back, the failure reason when there is one, and the time. The record SHALL be readable by the account the server runs as and SHALL contain no secret, device record, or workspace data. A later attempt SHALL replace it.

#### Scenario: Success recorded

- **WHEN** an upgrade from `5.1.1` to `5.2.0` succeeds
- **THEN** the record names both versions and a successful outcome

#### Scenario: Rollback recorded

- **WHEN** an upgrade rolls back
- **THEN** the record names the attempted version, the restored version, and the reason
