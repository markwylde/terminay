## MODIFIED Requirements

### Requirement: Supported runtime matrix

Terminay Desktop SHALL support macOS 13 Ventura or newer on Apple silicon through an arm64 DMG and 64-bit GNU/Linux on x64 through an AppImage. Terminay Server SHALL support 64-bit GNU/Linux on x64 and arm64 through self-contained archives that contain the pinned Node runtime, server code, matching responsive UI, and target-native dependencies, and SHALL require no system Node, npm, compiler, display server, or browser. Supported GNU/Linux hosts, for Desktop and Server alike, SHALL provide a glibc userspace of version 2.31 or newer, such as Debian 11, Ubuntu 20.04, or anything newer. macOS x64, Linux arm64 Desktop, Windows Desktop, standalone macOS and Windows Server, and Alpine/musl Linux are outside the supported matrix.

#### Scenario: Installing the standalone archive

- **WHEN** an operator installs a standalone server archive on a supported Linux host
- **THEN** the server runs without a system Node, npm, compiler, display server, or browser

#### Scenario: Desktop on the oldest supported macOS

- **WHEN** the Desktop DMG is installed on an Apple silicon Mac running macOS 13
- **THEN** it launches and starts terminals

#### Scenario: Desktop on the oldest supported glibc

- **WHEN** the Desktop AppImage runs on an x64 host whose glibc is 2.31
- **THEN** it starts terminals

#### Scenario: Desktop on a newer distribution than the build

- **WHEN** the Desktop AppImage runs on a host whose glibc is newer than any runner it could have been built on
- **THEN** it starts terminals

#### Scenario: Unsupported platform

- **WHEN** the runtime is used on a platform outside the supported matrix
- **THEN** it is not covered by this contract
