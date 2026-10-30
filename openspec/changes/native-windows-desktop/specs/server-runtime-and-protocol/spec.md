## MODIFIED Requirements

### Requirement: Supported runtime matrix

Terminay Desktop SHALL support macOS 12 Monterey or newer on Apple silicon through an arm64 DMG, 64-bit GNU/Linux on x64 through an AppImage, and Windows 10 22H2 or Windows 11 on x64 through a per-user NSIS installer. Terminay Server SHALL support 64-bit GNU/Linux on x64 and arm64 through self-contained archives that contain the pinned Node runtime, server code, matching responsive UI, and target-native dependencies, and SHALL require no system Node, npm, compiler, display server, or browser. Supported GNU/Linux hosts, for Desktop and Server alike, SHALL provide a glibc userspace of version 2.31 or newer, such as Debian 11, Ubuntu 20.04, or anything newer. Windows Desktop SHALL require no WSL, Node, npm, compiler, or Git to start terminals. macOS x64, Linux arm64 Desktop, Windows on ARM, standalone macOS and Windows Server, and Alpine/musl Linux are outside the supported matrix.

#### Scenario: Installing the standalone archive

- **WHEN** an operator installs a standalone server archive on a supported Linux host
- **THEN** the server runs without a system Node, npm, compiler, display server, or browser

#### Scenario: Desktop on the oldest supported glibc

- **WHEN** the Desktop AppImage runs on an x64 host whose glibc is 2.31
- **THEN** it starts terminals

#### Scenario: Desktop on a newer distribution than the build

- **WHEN** the Desktop AppImage runs on a host whose glibc is newer than any runner it could have been built on
- **THEN** it starts terminals

#### Scenario: Desktop on a clean Windows machine

- **WHEN** a user installs `Terminay-Windows-<version>-Setup.exe` on Windows 10 22H2 or Windows 11 x64 with no WSL, Node, or Git installed
- **THEN** Terminay starts and opens a terminal in the system default shell

#### Scenario: Unsupported platform

- **WHEN** the runtime is used on a platform outside the supported matrix
- **THEN** it is not covered by this contract

## ADDED Requirements

### Requirement: Windows Desktop starts terminals on Windows before publication

The tag release and the `main` prerelease SHALL build the Windows installer on a Windows x64 runner. Before the installer or its update payload is checksummed, attached, or named in update metadata, release packaging SHALL install that exact installer silently for the current user. It SHALL start the installed application with an isolated data directory and wait until the embedded server and its session holder report ready. It SHALL then run Windows PowerShell and Command Prompt in PTYs through the packaged `node-pty`, write input to each, resize each, observe output, and observe a clean exit. It SHALL also restart the server and observe that a held terminal is still running. Publication SHALL fail if any step does not succeed, and the probe SHALL record the installer's SHA-256 with its result.

#### Scenario: Probe passes

- **WHEN** a candidate installer passes every probe step
- **THEN** it and its update metadata are published, and the probe record names the installer's SHA-256

#### Scenario: Holder never becomes ready

- **WHEN** the installed application's session holder exits before it reports ready
- **THEN** the probe fails with the holder's reported reason and nothing for Windows is published for that run

#### Scenario: A shell cannot start

- **WHEN** PowerShell or Command Prompt does not start or does not echo input in the packaged PTY
- **THEN** publication fails and names the shell

### Requirement: Windows native files match the artifact architecture

Before publication, release packaging SHALL read the header of every PE file (`.exe`, `.dll`, and `.node`) in the Windows payload, including those inside `app.asar.unpacked`. It SHALL fail if any file is not a PE32+ image for x64, unless it is on a declared allow-list of files that load only into another process of a matching architecture.

#### Scenario: An arm64 addon in the x64 payload

- **WHEN** the Windows x64 payload contains a `pty.node` built for arm64
- **THEN** the check fails, naming the file and its machine type, and nothing is published

#### Scenario: Payload of x64 files

- **WHEN** every PE file in the payload is PE32+ x64
- **THEN** the check passes
