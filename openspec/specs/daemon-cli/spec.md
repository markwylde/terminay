# daemon-cli Specification

## Purpose
TBD - created by archiving change local-container-ice-advertising. Update Purpose after archive.

## Requirements

### Requirement: Advertised ICE address flag

`daemon install` and `daemon upgrade` SHALL accept `--advertise-address <host>:<port>`, validate it as a literal IPv4 or IPv6 address with a port before writing anything, record it in the install record, and write it into the service environment so the server offers it as an additional ICE candidate. `upgrade` with no `--advertise-address` SHALL keep the recorded value, because an upgrade is not the moment to change how a server is reached. `--advertise-address ''` SHALL remove it.

The CLI SHALL refuse a loopback host, naming the machine's routable address as the value to use instead. A browser is not obliged to send connectivity checks to a remote loopback candidate and Firefox does not, so a loopback address produces a server that pairs from one browser family and hangs with no diagnosis from the other. The routable address is reachable by every browser and is the address a published container port already answers on.

The CLI SHALL print, after an install that supplied one, the UDP port that must be reachable for the advertised candidate to work, because forwarding that port is a step the CLI cannot take on the operator's behalf.

#### Scenario: Install with an advertised address

- **WHEN** `daemon install --advertise-address 192.168.2.218:51000` runs
- **THEN** the service environment carries that address and port
- **AND** the install record carries it
- **AND** the output names UDP port 51000 as the port that must be reachable

#### Scenario: Malformed address is refused before anything is written

- **WHEN** `--advertise-address` is not a literal address and port
- **THEN** the command fails naming the value, and no unit, environment file, or version is written

#### Scenario: A hostname is refused

- **WHEN** `--advertise-address box.example.com:51000` runs
- **THEN** the command fails and says an ICE candidate must be a literal address

#### Scenario: A loopback address is refused

- **WHEN** `--advertise-address 127.0.0.1:51000` or `--advertise-address [::1]:51000` runs
- **THEN** the command fails, says a browser need not send connectivity checks to a loopback candidate, and tells the operator to use the machine's routable address
- **AND** no unit, environment file, or version is written

#### Scenario: Upgrade keeps the advertised address

- **WHEN** `daemon upgrade` runs with no `--advertise-address` on a server installed with one
- **THEN** the upgraded service keeps the recorded advertised address

#### Scenario: Clearing the advertised address

- **WHEN** `daemon upgrade --advertise-address ''` runs
- **THEN** the recorded advertised address is removed and the server returns to gathered candidates only

### Requirement: Status reports the advertised address

`daemon status` SHALL report the advertised ICE address when one is configured. It is service configuration an operator needs when a connection fails, and it names no workspace, path, account, or device.

#### Scenario: Status shows the advertised address

- **WHEN** `daemon status` runs on a server configured with an advertised ICE address
- **THEN** the report includes that address and port

#### Scenario: Status omits it when unset

- **WHEN** `daemon status` runs on a server with no advertised ICE address
- **THEN** the report does not mention one

### Requirement: Documented local-container flow

The operations runbook SHALL document connecting Terminay Desktop to a server running in a container on the same machine: publishing the advertised UDP port, installing with `--advertise-address` naming the machine's routable address, and pairing through the hosted signaling service. It SHALL state why the container's own address does not work — on macOS and Windows the container runs inside a virtual machine whose network the client cannot route to, and `--network host` does not change that — so an operator who hits the failure recognises it rather than assuming the server is broken. Every documented example SHALL use a routable address, because a loopback example is a value the CLI refuses.

#### Scenario: An operator follows the container flow

- **WHEN** an operator wants to try a server in a local container
- **THEN** the runbook gives the `docker run` publishing the UDP port, the `daemon install` naming the machine's routable address, and the pairing step

### Requirement: CLI package and platform scope

The `terminay` npm package SHALL expose one binary, `terminay`, whose `daemon` command group installs and controls a headless Terminay Server. The CLI SHALL support 64-bit GNU/Linux on x64 and arm64 with systemd as the service manager and SHALL refuse, with a message naming the requirement, to run `daemon` commands on any other operating system or on a Linux host without systemd. The CLI SHALL NOT bundle the server; it SHALL fetch a server distribution at install time.

#### Scenario: Unsupported host

- **WHEN** a `daemon` command runs on macOS, Windows, or a Linux host without `/run/systemd/system`
- **THEN** it exits non-zero and names the supported platforms and service manager

#### Scenario: Supported host

- **WHEN** a `daemon` command runs on a systemd Linux host on x64 or arm64
- **THEN** it proceeds

### Requirement: Version reference resolution

`daemon install` and `daemon upgrade` SHALL accept an optional reference. With no reference, `install` SHALL resolve the latest tagged release. A reference of the form `vX.Y.Z` SHALL resolve that tag; `main` SHALL resolve the rolling `main` prerelease; any other branch name or commit SHALL resolve to a source build of that ref. Resolution SHALL select the archive matching the host architecture and SHALL fail with a clear message when the release exists but lacks an archive for that architecture.

#### Scenario: Latest tag

- **WHEN** `daemon install` runs with no reference
- **THEN** the newest tagged release's archive for the host architecture is selected

#### Scenario: Explicit tag

- **WHEN** `daemon install v4.0.0` runs
- **THEN** the archive attached to release `v4.0.0` for the host architecture is selected

#### Scenario: Main channel

- **WHEN** `daemon install main` runs
- **THEN** the archive attached to the `main` prerelease for the host architecture is selected

#### Scenario: Branch or commit

- **WHEN** `daemon install <branch-or-commit>` runs
- **THEN** the CLI resolves it to a source build of that ref

#### Scenario: Missing architecture

- **WHEN** the resolved release has no archive for the host architecture
- **THEN** the command fails and names the architecture and release

### Requirement: Archive verification

Before unpacking a downloaded archive the CLI SHALL verify its SHA-256 against the release sidecar and its Ed25519 signature against a public key embedded in the CLI. Verification failure SHALL abort the command, delete the download, and leave the installation unchanged. There SHALL be no option to skip verification.

#### Scenario: Valid archive

- **WHEN** the sidecar hash and signature match
- **THEN** the archive is unpacked into a new versioned directory

#### Scenario: Tampered archive

- **WHEN** the hash or signature does not match
- **THEN** the command aborts, removes the download, and the active installation is untouched

### Requirement: Source build fallback

When a reference resolves to a source build, the CLI SHALL first check for git, python3, make, and a C++ compiler and SHALL fail with the missing tools named before downloading anything. It SHALL clone the repository at that ref, fetch the pinned Node runtime named by the repository, build the standalone archive with the repository's own builder, and install the result through the same versioned layout. The resulting manifest SHALL record the built commit and a `source` channel.

#### Scenario: Toolchain missing

- **WHEN** a required build tool is absent
- **THEN** the command fails before any download and names the missing tools

#### Scenario: Source build installs

- **WHEN** the toolchain is present and the build succeeds
- **THEN** the built archive is installed exactly as a downloaded archive would be, with its manifest recording the commit

### Requirement: Install layout

The CLI SHALL install each server version under `<prefix>/versions/<version-or-revision>/` and SHALL point `<prefix>/current` at the active version through an atomically replaced symbolic link. `<prefix>` SHALL be `/opt/terminay` for system scope and `~/.local/share/terminay` for user scope. Installed versions SHALL be immutable after verification; the CLI SHALL never edit files inside a versioned directory.

#### Scenario: Fresh install

- **WHEN** a version is installed for the first time
- **THEN** its files sit under `versions/<version>` and `current` points at that directory

#### Scenario: Versioned directory is immutable

- **WHEN** configuration changes after install
- **THEN** only files outside `versions/` change

### Requirement: Install scope selection

`daemon install` SHALL support a system scope, which installs a system systemd unit and requires root, and a user scope, which installs a user unit for the invoking account and enables login lingering. When standard input is a terminal and no scope flag is given, the CLI SHALL prompt for the scope with system scope preselected. When standard input is not a terminal, the CLI SHALL require `--system` or `--user` and SHALL fail without one.

#### Scenario: Interactive scope prompt

- **WHEN** `daemon install` runs on a terminal without a scope flag
- **THEN** the operator is asked to choose system or user scope with system preselected

#### Scenario: Non-interactive scope

- **WHEN** `daemon install` runs without a terminal and without `--system` or `--user`
- **THEN** it fails and names the missing flag

#### Scenario: System scope without root

- **WHEN** system scope is selected by a non-root user
- **THEN** the command fails and asks to re-run with elevated privileges

### Requirement: Run-as account for system scope

In system scope the CLI SHALL let the operator choose the account the server and its terminals run as: a dedicated `terminay` system account, created if absent, or an existing login user named with `--run-as <user>`. On a terminal without the flag the CLI SHALL prompt with the dedicated account preselected. The data root SHALL be owned by the chosen account with mode 0700, and the project root SHALL default to that account's home directory.

#### Scenario: Dedicated account

- **WHEN** the dedicated account is chosen
- **THEN** a `terminay` system user and group exist and own the data root

#### Scenario: Named login user

- **WHEN** `--run-as` names an existing login user
- **THEN** the unit runs as that user, the data root is owned by that user, and the project root defaults to that user's home

#### Scenario: Unknown user

- **WHEN** `--run-as` names an account that does not exist
- **THEN** the command fails before writing anything

### Requirement: Service unit and configuration

The CLI SHALL write an environment file readable only by the run-as account and a systemd unit whose `ExecStart` runs `<prefix>/current/bin/terminay-server`, restarts on failure, stops with `SIGTERM` within a bounded timeout, and carries `NoNewPrivileges=true` and `PrivateTmp=true`. The environment file SHALL set a stable server id defaulting to the machine hostname, the data root, the project root, `TERMINAY_EXPOSE` defaulting to `hosted,direct`, the hosted domain, a direct origin derived from the machine's primary address and the chosen port, agent integration enabled, AI providers disabled, and a loopback-only health endpoint. The CLI SHALL never write a vault passphrase, device key, or pairing material into the environment file or unit.

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

### Requirement: The service environment names the renderer directory the server reads

`daemon install` SHALL write the workspace UI location under the variable the server reads to build its hosted UI archive, in addition to the variable the server reads to serve its local HTTP UI. They are two settings that happen to share a value; writing only one leaves a server that pairs successfully and then serves no workspace.

An installed server SHALL therefore hand a paired device the workspace UI shipped in its own archive, without an operator editing the environment file.

#### Scenario: Install writes both UI variables

- **WHEN** `daemon install` completes
- **THEN** the service environment names the archive's UI directory as the renderer directory
- **AND** it also names it as the local UI bundle

#### Scenario: A paired device receives a workspace

- **WHEN** a device pairs with a server installed by the CLI
- **THEN** it receives the workspace UI from that server's archive, not a placeholder

#### Scenario: Upgrade adds a missing renderer directory

- **WHEN** `daemon upgrade` runs against a server whose environment names only the local UI bundle
- **THEN** the renderer directory is added, so the upgraded server serves a workspace

### Requirement: Lifecycle commands

`daemon start` and `daemon stop` SHALL start and stop the installed unit and SHALL wait for readiness or exit respectively. `daemon status` SHALL report unit state, active version and channel, the server's redacted status, readiness, and enabled exposure modes, and SHALL contain no workspace names, device records, or secrets.

#### Scenario: Start waits for readiness

- **WHEN** `daemon start` runs
- **THEN** it returns after the server reports ready or fails with the unit's last log lines

#### Scenario: Status is redacted

- **WHEN** `daemon status` runs
- **THEN** its output contains only unit state, version, channel, redacted server status, readiness, and exposure modes

### Requirement: Upgrade and rollback

`daemon upgrade [ref]` with no reference SHALL follow the installed channel: a `main` install upgrades to the newest `main` revision, a tagged install to the newest tag, and a source install requires an explicit reference. The CLI SHALL refuse an upgrade that would move to an older version unless `--allow-downgrade` is given. Upgrade SHALL verify and stage the new version beside the current one, stop the unit, switch `current`, start the unit, and wait for readiness; on failure it SHALL switch `current` back to the previous version, start it, and exit non-zero. The data root SHALL NOT be modified by the CLI during upgrade. After a successful upgrade exactly one previous version SHALL be retained and older versions removed.

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

### Requirement: Uninstall

`daemon uninstall` SHALL stop and disable the unit, remove the unit, the environment file, and every installed version, and SHALL keep the data root unless `--purge` is given, in which case it SHALL remove the data root after an explicit confirmation on a terminal or the `--yes` flag otherwise.

#### Scenario: Uninstall keeps data

- **WHEN** `daemon uninstall` runs without `--purge`
- **THEN** the unit and versions are removed and the data root remains

#### Scenario: Purge

- **WHEN** `daemon uninstall --purge` is confirmed
- **THEN** the data root is removed as well

### Requirement: Pairing from the terminal

`daemon qr-code`, with alias `daemon pairing-url`, SHALL obtain the running server's live pairing handoffs through the data-root socket, render a terminal QR code for the direct URL when direct exposure is enabled and for the hosted URL otherwise, print every URL with its expiry, and then wait for a device to request enrollment. When a request arrives the CLI SHALL show the device name and match code and prompt to approve or deny; when the room is about to expire it SHALL request a fresh room and redraw. `--no-wait` SHALL print and exit; `--mode hosted|direct` SHALL select the rendered URL. `daemon approvals`, `daemon approve <id>`, and `daemon deny <id>` SHALL forward to the server's approval operations for non-interactive use. The CLI SHALL never print a host key or device key.

#### Scenario: QR and approval in one session

- **WHEN** `daemon qr-code` runs and a device scans the code
- **THEN** the device name and match code are shown and the operator's approval or denial is sent to the server

#### Scenario: Room refresh

- **WHEN** the displayed room is within seconds of expiry with no device pending
- **THEN** a fresh room is requested and the QR is redrawn

#### Scenario: Print only

- **WHEN** `daemon qr-code --no-wait` runs
- **THEN** the URLs are printed and the command exits without waiting

#### Scenario: Server not running

- **WHEN** the server is not running
- **THEN** the command fails and suggests `daemon start`

### Requirement: Identity reset

`daemon reset-identity` SHALL stop the unit, run the server's identity rotation, and start the unit again, and SHALL require confirmation on a terminal or `--yes` otherwise, because every paired device must pair again.

#### Scenario: Reset with confirmation

- **WHEN** `daemon reset-identity` is confirmed
- **THEN** the server is stopped, its host key rotated and devices revoked, and it is started again

### Requirement: Release publication

Every tagged release SHALL publish the `terminay` package to npm with the same version as the application, and the release SHALL fail if the public key embedded in the CLI does not match the release signing key.

#### Scenario: Lockstep publish

- **WHEN** release `vX.Y.Z` is published
- **THEN** `terminay@X.Y.Z` is published to npm

#### Scenario: Key mismatch

- **WHEN** the embedded public key differs from the signing key
- **THEN** the release fails before publishing
