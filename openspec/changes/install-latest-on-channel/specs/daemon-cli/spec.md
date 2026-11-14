## MODIFIED Requirements

### Requirement: System-scope upgrade helper

For a system-scope install, `daemon install` and `daemon upgrade` SHALL write two root-owned systemd unit pairs beside the service unit. Each pair is a path unit that watches one request file the run-as account can write, and a oneshot service started by that path unit that runs the installed CLI as root. The upgrade pair SHALL run `daemon upgrade --system` with no reference and no other argument, and SHALL never downgrade. The install-latest pair SHALL watch a different request file and SHALL run `daemon upgrade --system --allow-downgrade` with no reference and no other argument, so it installs the newest signed release on the installed channel whether or not it is older. Each oneshot service SHALL execute only files under the root-owned install prefix and SHALL NOT read its request file's contents. `daemon uninstall` SHALL remove every helper unit. A user-scope install SHALL have no helper.

`daemon upgrade` SHALL add any missing helper unit to a system-scope install.

#### Scenario: Helper installed

- **WHEN** a system-scope install completes
- **THEN** both path units are enabled and active, and every helper unit is owned by root and not writable by the run-as account

#### Scenario: Request triggers a fixed upgrade

- **WHEN** the run-as account writes the upgrade request file
- **THEN** the oneshot service runs `daemon upgrade --system` on the installed channel as root

#### Scenario: Install-latest request installs an older release

- **WHEN** the run-as account writes the install-latest request file and the newest release on the installed channel is older than the running one
- **THEN** the oneshot service runs `daemon upgrade --system --allow-downgrade` as root and that release is installed

#### Scenario: Request contents are ignored

- **WHEN** either request file contains a reference, a flag, or a path
- **THEN** the upgrade that runs is that pair's fixed upgrade, to the same release, as with an empty file

#### Scenario: Upgrade adds a missing helper

- **WHEN** `daemon upgrade --system` runs as root against an install with no install-latest units
- **THEN** every helper unit exists and both path units are active afterwards

#### Scenario: Uninstall removes the helper

- **WHEN** `daemon uninstall --system` runs
- **THEN** no helper unit remains

## ADDED Requirements

### Requirement: Upgrade check reports the channel's latest release

`daemon upgrade --check` SHALL report, beside `available`, the newest release on the installed channel as `latest`, whether it is newer than, the same as, or older than the installed release, and how it orders against the installed release. A `source` install SHALL report no latest release.

#### Scenario: Installed build is ahead of the channel

- **WHEN** a `main` install is newer than the newest `main` build the check can read
- **THEN** the report has no `available` release and a `latest` release ordered as older

#### Scenario: Installed build is the latest

- **WHEN** a tagged install of `5.2.0` checks and the newest tagged release is `5.2.0`
- **THEN** the report's `latest` is `5.2.0`, ordered as the same
