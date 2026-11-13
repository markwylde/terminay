## ADDED Requirements

### Requirement: Readiness means the server is usable

Wherever the CLI reports an installed server ready — `daemon install`, `daemon start`, `daemon upgrade`, and the readiness field of `daemon status` — it SHALL mean all of: the health endpoint reports ready, the approval socket answers a status request when reached the way pairing commands reach it, and the server can start a terminal with its default shell. When any check fails, the command SHALL name the failed check, the underlying detail, and the fix, and SHALL exit non-zero. A health endpoint that is ready while another check fails SHALL NOT be reported as ready.

The server SHALL answer a `probe-terminal` request on the approval socket by starting the shell its default terminal would use, non-interactively, with a command that exits immediately, and reporting success, or the exit status and the last lines it printed, within a bounded time. The probe SHALL start no terminal session and touch no workspace state.

#### Scenario: Install on a server whose terminals cannot start

- **WHEN** `daemon install` finishes and the server's default shell exits non-zero at once
- **THEN** the command does not say the server is running and ready, names the shell and its exit status, and gives the fix

#### Scenario: Socket unreachable as the service account

- **WHEN** health is ready but the approval socket cannot be reached as the service account
- **THEN** `daemon start` reports which check failed and why, not that the server is ready

#### Scenario: Everything works

- **WHEN** health is ready, the socket answers, and the terminal probe succeeds
- **THEN** the command reports the server ready

### Requirement: Root-run commands reach the service account on the release runtime

A root-run CLI that runs anything as the service account SHALL run it with the Node.js runtime shipped in the installed release, which the service itself runs on, and SHALL fall back to the CLI's own Node.js only when the installed release has none. The service account SHALL NOT need to read or execute any file of the CLI's own installation or of the operator's Node.js installation. The CLI SHALL classify a failed launch from what the launched process printed, never from the command line it was given.

#### Scenario: Operator's Node.js is under a private home

- **WHEN** root runs `daemon qr-code` with Node.js installed by nvm under `/root` or another private home, against a service run by the dedicated account
- **THEN** the command reaches the socket as that account and shows the pairing code

#### Scenario: Launch failure is not reported as a stopped server

- **WHEN** the privilege drop fails before the socket client runs
- **THEN** the error names the launch failure and its detail, and does not say that no server is running

### Requirement: Daemon doctor

`terminay daemon doctor` SHALL check an installed server and print one line per check with its result, and for every failed check the command that fixes it. The checks SHALL cover at least: the unit is active and enabled; the release runtime is executable by the service account; the service account's login shell is a real shell; the data root is owned by the service account with mode 0700; the approval socket answers as the service account; the health endpoint is ready; the terminal probe succeeds; and the configured protocol port is bound by the server. `doctor` SHALL change nothing, SHALL print no secret, device record, or pairing material, and SHALL exit non-zero when any check fails.

#### Scenario: Healthy install

- **WHEN** `daemon doctor` runs on a working install
- **THEN** every check passes and it exits zero

#### Scenario: Service account has no login shell

- **WHEN** the run-as account's shell is `/usr/sbin/nologin`
- **THEN** the shell check fails and the output gives the command that sets a login shell

#### Scenario: Doctor changes nothing

- **WHEN** `daemon doctor` runs with any number of failing checks
- **THEN** no file, unit, or account is modified

### Requirement: Installed launcher

`daemon install` and `daemon upgrade` SHALL place a `terminay` launcher at `/usr/local/bin/terminay` for system scope and `~/.local/bin/terminay` for user scope that runs the CLI shipped in the active release on the release's own Node.js runtime. The launcher SHALL NOT depend on `npx`, on the invoking user's `PATH`, or on any Node.js installation outside the release. Install SHALL NOT overwrite a `terminay` file at that path that it did not write, and SHALL say so. `daemon uninstall` SHALL remove a launcher it wrote. When the user-scope directory is not on `PATH`, install SHALL say so.

#### Scenario: Commands after install

- **WHEN** a system-scope install completes
- **THEN** `sudo terminay daemon qr-code` works from a login shell with no Node.js on root's `PATH`

#### Scenario: Foreign file at the launcher path

- **WHEN** `/usr/local/bin/terminay` exists and was not written by the installer
- **THEN** install leaves it unchanged and reports that the launcher was not installed

## MODIFIED Requirements

### Requirement: Install scope selection

`daemon install` SHALL support a system scope, which installs a system systemd unit and requires root, and a user scope, which installs a user unit for the invoking account and enables login lingering. When standard input is a terminal and no scope flag is given, the CLI SHALL prompt for the scope with system scope preselected. When standard input is not a terminal, the CLI SHALL require `--system` or `--user` and SHALL fail without one.

When system scope is selected by a non-root user on a terminal, the CLI SHALL re-run the same command through `sudo` with the absolute paths of its own Node.js binary and entry script and the answers already given, so `sudo` asks for the password and a Node.js installed under the user's home works. Without a terminal, or without `sudo`, it SHALL fail and print the exact command to run, using those absolute paths.

#### Scenario: Interactive scope prompt

- **WHEN** `daemon install` runs on a terminal without a scope flag
- **THEN** the operator is asked to choose system or user scope with system preselected

#### Scenario: Non-interactive scope

- **WHEN** `daemon install` runs without a terminal and without `--system` or `--user`
- **THEN** it fails and names the missing flag

#### Scenario: System scope without root

- **WHEN** system scope is selected by a non-root user on a terminal
- **THEN** the CLI re-runs itself through `sudo`, which asks for the password, and the install continues as root without asking for the scope again

#### Scenario: Node.js from nvm

- **WHEN** the non-root user's Node.js and `npx` live under their home directory and system scope is selected
- **THEN** the elevated install runs without `npx` being on root's `PATH`

#### Scenario: System scope without root and without a terminal

- **WHEN** system scope is selected by a non-root user without a terminal
- **THEN** the command fails and prints a `sudo` command, with absolute paths, that performs the install

### Requirement: Run-as account for system scope

In system scope the CLI SHALL let the operator choose the account the server and its terminals run as: a dedicated `terminay` system account, created if absent, or an existing login user named with `--run-as <user>`. On a terminal without the flag the CLI SHALL prompt with the dedicated account preselected. The data root SHALL be owned by the chosen account with mode 0700, and the project root SHALL default to that account's home directory.

The dedicated account SHALL have a real login shell — `/bin/bash` when present, otherwise `/bin/sh` — because the server starts that shell for every terminal. When the dedicated account already exists with a shell that refuses logins, such as `/usr/sbin/nologin` or `/bin/false`, install and upgrade SHALL set the login shell and say so. The CLI SHALL NOT change the shell of an account named with `--run-as`; it SHALL warn when that account's shell refuses logins.

#### Scenario: Dedicated account

- **WHEN** the dedicated account is chosen
- **THEN** a `terminay` system user and group exist, own the data root, and have a login shell

#### Scenario: Existing dedicated account without a login shell

- **WHEN** install or upgrade runs and the `terminay` account's shell is `/usr/sbin/nologin`
- **THEN** its shell is set to `/bin/bash`, or `/bin/sh` when bash is absent, and the output says so

#### Scenario: Named login user

- **WHEN** `--run-as` names an existing login user
- **THEN** the unit runs as that user, the data root is owned by that user, and the project root defaults to that user's home

#### Scenario: Named user without a login shell

- **WHEN** `--run-as` names an account whose shell is `/usr/sbin/nologin`
- **THEN** install leaves the account unchanged and warns that its terminals cannot start a shell

#### Scenario: Unknown user

- **WHEN** `--run-as` names an account that does not exist
- **THEN** the command fails before writing anything

### Requirement: Pairing from the terminal

`daemon qr-code`, with alias `daemon pairing-url`, SHALL obtain the running server's live pairing handoffs through the data-root socket, render a terminal QR code for the hosted URL when hosted exposure is enabled and for the direct URL only when hosted exposure is unavailable or `--mode direct` is selected, print every URL with its expiry and mode, and then wait for a device to request enrollment. When a request arrives the CLI SHALL show the device name and match code and prompt to approve or deny; when the room is about to expire it SHALL request a fresh room and redraw. `--no-wait` SHALL print and exit; `--mode hosted|direct` SHALL select the rendered URL. `daemon approvals`, `daemon approve <id>`, and `daemon deny <id>` SHALL forward to the server's approval operations for non-interactive use. The CLI SHALL never print a host key or device key.

A `daemon install` run on a terminal SHALL, once the server is ready, continue into the same pairing session `daemon qr-code` runs, and SHALL say that Ctrl+C ends pairing without affecting the installed server. Without a terminal, install SHALL print the command that shows the pairing code.

#### Scenario: QR and approval in one session

- **WHEN** `daemon qr-code` runs and a device scans the code
- **THEN** the device name and match code are shown and the operator's approval or denial is sent to the server

#### Scenario: Install continues into pairing

- **WHEN** `daemon install` completes on a terminal and the server is ready
- **THEN** the pairing QR code is shown and the CLI waits for a device

#### Scenario: Both modes are enabled

- **WHEN** `daemon qr-code` runs with both hosted and direct exposure and no mode override
- **THEN** the QR encodes the hosted browser-compatible URL and the output clearly labels both URLs

#### Scenario: Direct QR is explicitly selected

- **WHEN** `daemon qr-code --mode direct` runs
- **THEN** the QR encodes the direct URL and the output says to open the direct URL in Terminay Desktop

#### Scenario: Room refresh

- **WHEN** the displayed room is within seconds of expiry with no device pending
- **THEN** a fresh room is requested and the QR is redrawn

#### Scenario: Print only

- **WHEN** `daemon qr-code --no-wait` runs
- **THEN** the URLs are printed and the command exits without waiting

#### Scenario: Server not running

- **WHEN** the server is not running
- **THEN** the command fails and suggests `daemon start`

### Requirement: Container foreground operation is documented

The standalone operations runbook SHALL provide a supported non-systemd container path that runs the server in the foreground as PID 1 or under a container supervisor, documents durable data-root and network-port configuration, and gives the commands to create and approve pairing without relying on `sudo` or a systemd service user. Systemd installation SHALL clearly identify its platform requirement. A root-run CLI that drops to the service account SHALL NOT require that account to read the CLI's own installation, so a CLI run through `sudo npx` works against a dedicated service account. Root-run CLI errors SHALL explain when `sudo` is missing or the Node.js binary cannot be executed by the service account, give a supported recovery path, and keep the underlying detail; an unrelated permission error SHALL NOT be attributed to either.

#### Scenario: Operator runs a foreground container

- **WHEN** an operator uses a stock Node container without systemd
- **THEN** the runbook shows how to start the standalone server in the foreground and request or approve pairing without invoking the systemd installer

#### Scenario: Root CLI cannot find sudo

- **WHEN** a root-run CLI needs to drop privileges but `sudo` is unavailable
- **THEN** it reports that the pairing operation needs `sudo` and recommends invoking the installed CLI as the service account or using the documented foreground server commands

#### Scenario: CLI installed where the service account cannot read

- **WHEN** root runs a pairing or approval command from a CLI unpacked under root's home, against a service owned by a dedicated account
- **THEN** the command reaches the server's socket as that account without that account reading any file of the CLI installation

#### Scenario: Service account cannot run Node.js

- **WHEN** the installed release has no runtime and the Node.js binary running the CLI is not executable by the service account
- **THEN** the CLI reports that path and recommends the installed `terminay` launcher or a system-wide Node.js installation

### Requirement: Release publication

Every tagged release SHALL publish the `terminay` package to npm with the same version as the application, and the release SHALL fail if the public key embedded in the CLI does not match the release signing key. Every server archive on every track SHALL report the version of the build it belongs to, and a Nightly or Canary archive SHALL report its prerelease version; the build SHALL fail rather than publish an archive that reports the workspace placeholder version.

#### Scenario: Lockstep publish

- **WHEN** release `vX.Y.Z` is published
- **THEN** `terminay@X.Y.Z` is published to npm

#### Scenario: Key mismatch

- **WHEN** the embedded public key differs from the signing key
- **THEN** the release fails before publishing

#### Scenario: Nightly archive version

- **WHEN** a Nightly server archive is installed and started
- **THEN** install and `daemon status` show its `<next>-main.<count>.nightly` version, not `0.0.0`
