## MODIFIED Requirements

### Requirement: Supported runtime matrix

Terminay Desktop SHALL support macOS 12 Monterey or newer on Apple silicon through an arm64 DMG and 64-bit GNU/Linux on x64 through an AppImage. Terminay Server SHALL support 64-bit GNU/Linux on x64 and arm64 through self-contained archives that contain the pinned Node runtime, server code, matching responsive UI, and target-native dependencies, and SHALL require no system Node, npm, compiler, display server, or browser. Supported GNU/Linux hosts, for Desktop and Server alike, SHALL provide a glibc userspace of version 2.31 or newer, such as Debian 11, Ubuntu 20.04, or anything newer. macOS x64, Linux arm64 Desktop, Windows Desktop, standalone macOS and Windows Server, and Alpine/musl Linux are outside the supported matrix.

#### Scenario: Installing the standalone archive

- **WHEN** an operator installs a standalone server archive on a supported Linux host
- **THEN** the server runs without a system Node, npm, compiler, display server, or browser

#### Scenario: Desktop on the oldest supported glibc

- **WHEN** the Desktop AppImage runs on an x64 host whose glibc is 2.31
- **THEN** it starts terminals

#### Scenario: Desktop on a newer distribution than the build

- **WHEN** the Desktop AppImage runs on a host whose glibc is newer than any runner it could have been built on
- **THEN** it starts terminals

#### Scenario: Unsupported platform

- **WHEN** the runtime is used on a platform outside the supported matrix
- **THEN** it is not covered by this contract

## ADDED Requirements

### Requirement: Linux artifacts are built at the glibc floor

Every published Linux artifact SHALL be compiled, packaged, and staged inside one floor build image. That covers the Desktop AppImage on the tag and `main` channels and every standalone server archive. The image is pinned by digest, provides glibc 2.31 and the pinned Node runtime, and is declared in one place together with the floor. The runner a job lands on SHALL NOT decide the glibc an artifact needs.

#### Scenario: The runner image moves

- **WHEN** the runner image a Linux lane runs on gains a newer glibc
- **THEN** the artifact's native code is still compiled against glibc 2.31

### Requirement: Linux artifacts are checked against the glibc floor before publication

Before an artifact is checksummed, signed, or uploaded, release packaging SHALL read the symbol-version requirements of every ELF file in it for the artifact's architecture. It SHALL fail if any file requires a `GLIBC_` version above 2.31, a `GLIBCXX_` version above 3.4.28, or a `CXXABI_` version above 1.3.12. Files for other architectures SHALL NOT fail the check.

#### Scenario: A native addon built against a newer glibc

- **WHEN** a Linux artifact contains an x64 `pty.node` that requires `GLIBC_2.42`
- **THEN** the floor check fails, naming the file and the version, and the artifact is not published

#### Scenario: A bundled library for another architecture

- **WHEN** an x64 artifact contains an armhf library that requires `GLIBC_2.34`
- **THEN** the floor check skips it and does not fail

### Requirement: Linux artifacts start terminals on a clean floor host before merge and publication

Release packaging SHALL extract each Linux artifact in a clean glibc 2.31 environment with no compiler, npm, or system Node. Using the artifact's own runtime, it SHALL start the packaged session holder until it reports ready and run a shell in a PTY through the packaged `node-pty`. Publication SHALL fail if either does not succeed. Pull-request CI SHALL build the x64 AppImage and the x64 server archive in the floor build image, and SHALL run the floor check and this probe on both.

#### Scenario: Holder cannot start on the floor host

- **WHEN** the session holder from a candidate AppImage or server archive exits before it is ready in the clean glibc 2.31 environment
- **THEN** the probe fails with the holder's reported reason and the artifact is not published

#### Scenario: Pull request raises the floor

- **WHEN** a pull request adds a native dependency whose x64 build requires a glibc above 2.31
- **THEN** pull-request CI fails before the change can merge
