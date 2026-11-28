## ADDED Requirements

### Requirement: Desktop setup command

`terminay daemon desktop install` SHALL install the server desktop's packages on a Debian host: the desktop session and the Chromium and Firefox browsers. It SHALL install exactly the packages named in the installed release and the dependencies the package manager resolves for them, without recommended packages, from the host's configured package sources. It SHALL accept no package name, source, or version from its arguments, its environment, or any file the run-as account can write, and SHALL run the package manager with an environment it builds itself. It SHALL NOT add a package source, and SHALL NOT leave any system service enabled or running that was not before.

The command SHALL hold an exclusive lock for its whole run, so two runs never overlap, and SHALL wait a bounded time for another package operation on the host to finish before failing. When every program it installs, the browsers included, is already present it SHALL exit zero without contacting a package source. It SHALL first complete any package installation a previous run left unfinished.

#### Scenario: Fresh Debian host

- **WHEN** `terminay daemon desktop install` runs as root on a Debian host without the packages
- **THEN** the named packages are installed, no new system service is enabled or running, and the command exits zero

#### Scenario: Run twice

- **WHEN** the command runs on a host that already has the packages
- **THEN** it exits zero, installs nothing, and contacts no package source

#### Scenario: Desktop set up without the browsers

- **WHEN** the command runs on a host that has the desktop session's programs and lacks a browser
- **THEN** the named packages are installed, the browser is present afterwards, and the command exits zero

#### Scenario: Two runs at once

- **WHEN** a second run starts while the first is installing
- **THEN** the second waits for the first or exits without running the package manager, and the host's packages end in the same state as after one run

#### Scenario: Unsupported host

- **WHEN** the command runs on a host that is not Debian
- **THEN** it exits non-zero, names the supported hosts, and changes nothing

#### Scenario: Extra argument

- **WHEN** the command is given a package name as an argument
- **THEN** it exits non-zero as a usage error and installs nothing

#### Scenario: Hostile environment

- **WHEN** the command is run with environment variables that would redirect the package manager's configuration or sources
- **THEN** the package manager runs without them

### Requirement: Desktop setup progress

While it runs, the setup command SHALL report each step and the package manager's own completed fraction to its terminal. When started by the setup helper it SHALL also write them to a status file in a directory only root can write and the run-as account can read, replacing the file atomically on each update, and SHALL record the final outcome there with the failing step and reason on failure. Each run SHALL identify itself in the file, so a reader can tell a finished run from one that ended without an outcome.

#### Scenario: Server reads progress

- **WHEN** the helper is installing packages
- **THEN** the run-as account can read the current step and fraction from the status file and cannot modify it

#### Scenario: Run killed

- **WHEN** a run is killed before it records an outcome and a new run starts
- **THEN** the status file shows the new run's identity and progress, not the old run's

#### Scenario: Failure recorded

- **WHEN** a package cannot be downloaded
- **THEN** the status file records failure, the download step, and the package manager's error

### Requirement: Desktop setup helper

A system-scope install SHALL carry a desktop-setup helper beside the upgrade helper: a path unit that watches one request file the run-as account may change, and a root oneshot service whose command line is fixed to that install's own `terminay daemon desktop install`. The path unit SHALL NOT pass the file on and the service SHALL NOT read it, so nothing the run-as account writes can choose what is installed. The service SHALL have a start deadline and a start-rate limit, so repeated requests cannot run the package manager continuously. Install and upgrade SHALL both render and enable the helper, and uninstall SHALL remove it. A user-scope install SHALL have no helper.

The trigger SHALL be a regular file in a root-controlled directory. The run-as account may signal a request but SHALL NOT be able to replace the trigger. Install, upgrade and repair SHALL NOT follow links or change the metadata of account-selected files. They SHALL leave the watch enabled and active without starting a desktop installation.

#### Scenario: Upgrade from an account-writable trigger directory

- **WHEN** an upgrade encounters a previous trigger in a directory writable by the run-as account
- **THEN** the helper watches a trigger under root control without following the previous entry or requiring an operator step

#### Scenario: Retry interrupted activation

- **WHEN** the units already exist and the watch is disabled or inactive
- **THEN** repeating install or upgrade restores the watch and does not request package installation

#### Scenario: Server requests setup

- **WHEN** the server changes the request file on a system-scope install
- **THEN** systemd starts the helper as root and it runs the fixed setup command

#### Scenario: Request file with content

- **WHEN** the run-as account writes package names into the request file
- **THEN** the helper installs only the release's named packages

#### Scenario: Repeated requests

- **WHEN** the run-as account changes the request file many times in a minute
- **THEN** the helper starts no more often than its rate limit allows

#### Scenario: Uninstall

- **WHEN** `daemon uninstall` runs
- **THEN** the helper's units are removed, a running server desktop is stopped, and installed desktop packages are left in place

### Requirement: Doctor reports the desktop

`daemon doctor` SHALL report the server desktop's state without changing anything: whether the host is supported, whether each required program is present, whether the setup helper is installed, and, when the desktop is running, that its display accepts the server's cookie, that no network listener belongs to it, and that its display server cannot open a network connection. An unsupported host or an absent desktop SHALL be reported as information, not as a failure.

#### Scenario: Desktop not set up

- **WHEN** `daemon doctor` runs on a Debian install without the desktop packages
- **THEN** it reports the desktop as not set up, names the command that sets it up, and its exit status is unaffected

#### Scenario: Unexpected listener

- **WHEN** the desktop is running and a TCP listener belongs to its display server
- **THEN** doctor reports a failure naming the listener

#### Scenario: Display server with network access

- **WHEN** the desktop is running and its display server is able to open a network connection
- **THEN** doctor reports a failure
