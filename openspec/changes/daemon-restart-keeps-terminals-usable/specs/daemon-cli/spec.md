## MODIFIED Requirements

### Requirement: Service unit and configuration

The CLI SHALL write an environment file readable only by the run-as account and a systemd unit whose `ExecStart` runs `<prefix>/current/bin/terminay-server`, restarts on failure, stops with `SIGTERM` within a bounded timeout, and carries `NoNewPrivileges=true`. The unit SHALL NOT carry `PrivateTmp=` or any other directive that gives the service a filesystem view systemd tears down when the service stops. The environment file SHALL set a stable server id defaulting to the machine hostname, the data root, the project root, `TERMINAY_EXPOSE` defaulting to `hosted,direct`, the hosted domain, a direct origin derived from the machine's primary address and the chosen port, agent integration enabled, AI providers disabled, and a loopback-only health endpoint. The CLI SHALL never write a vault passphrase, device key, or pairing material into the environment file or unit.

Install SHALL leave the running service on the configuration it just wrote. A service that is already running SHALL be restarted, because enabling a unit that is already active changes nothing and would leave the operator testing the previous configuration against the new output.

#### Scenario: Unit installed and enabled

- **WHEN** install completes
- **THEN** the unit is enabled and started and `daemon status` reports the server ready

#### Scenario: Re-installing with changed options takes effect

- **WHEN** `daemon install` runs on a machine whose service is already running and writes a different advertised address
- **THEN** the service is restarted and the running server carries the new address

#### Scenario: Secrets stay out of configuration

- **WHEN** the environment file and unit are written
- **THEN** they contain no passphrase, key, or pairing token

#### Scenario: Server id is stable

- **WHEN** the server is upgraded or reinstalled over the same data root
- **THEN** the server id in the environment file is unchanged

#### Scenario: Terminals share the host's temporary directory

- **WHEN** the service is installed and a terminal runs `touch /tmp/terminay-probe`
- **THEN** the file exists in the host's `/tmp` as seen by a process of the same account outside the service

## ADDED Requirements

### Requirement: The unit's temporary-directory setting follows the active release

A release whose manifest declares that it keeps scratch files safe in a shared temporary directory SHALL run under a unit without `PrivateTmp=`. Any other release SHALL run under a unit with `PrivateTmp=true`. `daemon upgrade` SHALL change the unit only between stopping the service and starting the new release. When the upgrade rolls back, it SHALL restore the unit's previous bytes. It SHALL say when it changed the unit, and a unit that already matches SHALL be left byte-for-byte unchanged.

#### Scenario: Upgrade to a safe release

- **WHEN** `daemon upgrade` moves an install whose unit contains `PrivateTmp=true` to a release that declares shared-temporary-directory safety
- **THEN** after the stop, the unit loses its `PrivateTmp=` line, systemd is reloaded, the new release starts, and the output says the unit was updated

#### Scenario: Rollback restores the unit

- **WHEN** that upgrade fails readiness and rolls back
- **THEN** the unit's bytes are exactly as they were before the upgrade

#### Scenario: Downgrade to an unsafe release

- **WHEN** `daemon upgrade --allow-downgrade` moves to a release whose manifest lacks the declaration
- **THEN** the unit carries `PrivateTmp=true` when that release starts

### Requirement: Upgrade repairs the unit even when nothing is upgraded

`daemon upgrade` SHALL compare the unit with what the active release requires before it checks the channel or resolves a release. When the unit does not match and no upgrade follows, whether the install is already current, has no channel to follow, or cannot reach the release server, the command SHALL rewrite the unit, reload systemd, restart the service once, and wait for readiness. It SHALL then report the original outcome.

#### Scenario: Already current but the unit is faulty

- **WHEN** `daemon upgrade` runs on an install already on the newest release, whose release is safe but whose unit contains `PrivateTmp=true`
- **THEN** the line is removed, the service is restarted once, and the command exits zero

#### Scenario: Offline

- **WHEN** `daemon upgrade` cannot reach the release server and the unit does not match the active release
- **THEN** the unit is repaired and the service restarted once, and the command then reports that it could not reach the release server

#### Scenario: Source install

- **WHEN** `daemon upgrade` runs with no reference on a source install whose unit does not match
- **THEN** the unit is repaired, and the command then reports that a source install needs an explicit reference

### Requirement: A server started under a private temporary directory requests its own repair

A standalone server whose release declares shared-temporary-directory safety SHALL detect at start-up when its `/tmp` is a systemd private temporary directory. On a system-scope install, once the upgrade helper's service is no longer running, the server SHALL request the repair through the helper, at most once per boot. Otherwise, the server SHALL report in its diagnostics and in `daemon status` that the unit must be repaired with `terminay daemon upgrade`.

#### Scenario: Upgraded by an older CLI

- **WHEN** a release from before this requirement upgrades a system-scope install to a release that declares safety, leaving `PrivateTmp=true` in the unit
- **THEN** after the older upgrade's helper run ends, the new server requests the repair, the unit loses its `PrivateTmp=` line, the service restarts once, and a terminal opened afterwards can `mkdir` in `/tmp`

#### Scenario: Helper still running

- **WHEN** the server detects the private temporary directory while the upgrade helper's service is still active
- **THEN** the server waits until that service is inactive before requesting the repair, so the request is not lost

#### Scenario: User-scope install with a private temporary directory

- **WHEN** a user-scope server starts under a systemd private temporary directory
- **THEN** `daemon status` and the server diagnostics say the unit must be repaired with `terminay daemon upgrade`

#### Scenario: Normal start

- **WHEN** a server starts with the host's shared `/tmp`
- **THEN** no repair is requested and nothing is reported
