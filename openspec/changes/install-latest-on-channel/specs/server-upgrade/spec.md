## MODIFIED Requirements

### Requirement: Any paired device may start an upgrade, and names nothing but the mode

The server SHALL accept an upgrade request from any authenticated paired device. The request SHALL carry the upgrade mode, which SHALL be one the server's status offers, and MAY carry `allowOlder: true`. It SHALL NOT carry a version, reference, URL, path, or any other flag, and the server SHALL reject a request that does. Without `allowOlder`, the server SHALL upgrade only to a release its own check resolved as newer on its own channel and SHALL never move to an older release. With `allowOlder`, the server SHALL install the latest release its own check resolved on its own channel even when that release is older than the running one. It SHALL reject the request when that release is the running one or the check resolved none. The server SHALL install a release in place only after its SHA-256 digest and Ed25519 signature verify. A request made while an upgrade is in progress, or when the release it asks for is unavailable, SHALL be rejected with a structured error and SHALL change nothing.

#### Scenario: Paired device starts an upgrade

- **WHEN** a paired device requests an upgrade in an offered mode while one is available
- **THEN** the server begins the upgrade and publishes that it is in progress

#### Scenario: Request names a version

- **WHEN** an upgrade request carries a version, URL, or path
- **THEN** the server rejects it and no upgrade begins

#### Scenario: Install the channel's latest release when it is older

- **WHEN** a `main` server is ahead of the newest `main` build and a paired device requests an in-place upgrade with `allowOlder`
- **THEN** the server installs the newest `main` build after verifying it, and publishes that it is in progress

#### Scenario: Older release without consent

- **WHEN** the channel's latest release is older than the running one and a request omits `allowOlder`
- **THEN** the server rejects it and no upgrade begins

#### Scenario: Already the latest

- **WHEN** a request carries `allowOlder` and the running release is the channel's latest
- **THEN** the server rejects it and no upgrade begins

#### Scenario: Unoffered mode

- **WHEN** a request names the recreate mode on a server whose status does not offer it
- **THEN** the server rejects it

#### Scenario: Upgrade already running

- **WHEN** a second device requests an upgrade while one is in progress
- **THEN** the request is rejected and the running upgrade is unaffected

## ADDED Requirements

### Requirement: Status names the channel's latest release

The server's upgrade status SHALL name the latest release its check resolved on its own channel, and SHALL state whether that release is newer than, the same as, or older than the running one. It SHALL state whether a request can install it in place. A status SHALL offer an older latest release only through a request with `allowOlder`. A system-scope server SHALL offer the older release in place only when its install-latest helper is installed. Otherwise, the status SHALL give that as the reason, with the host command, which runs `daemon upgrade` with `--allow-downgrade --system`.

#### Scenario: Ahead of the channel

- **WHEN** a server's check finds the channel's latest release older than the running one
- **THEN** its status names that release as older and reports no upgrade available

#### Scenario: System-scope server without the install-latest helper

- **WHEN** a system-scope server installed before the install-latest helper existed is ahead of its channel
- **THEN** its status reports that the older release cannot be installed in place and gives the host command

### Requirement: A container installs an older release in place only down to its image

A container server SHALL install an older channel release in place only when that release is no older than the release built into its image. The container runs the newest verified release among the one in its image and the one staged on its data volume. A staged release older than the image would therefore never run. When the channel's latest release is older than the image's release, the status SHALL offer no install-latest action, in either mode. It SHALL report that the release cannot be installed in this container and that the image's tag decides its version.

#### Scenario: Older release above the image floor

- **WHEN** a container whose image carries `5.1.0` runs a staged `5.3.0-main.40.canary` and the channel's latest release is `5.2.0`
- **THEN** the status offers `5.2.0` in place with `allowOlder`

#### Scenario: Older release below the image floor

- **WHEN** the channel's latest release is older than the release built into the image
- **THEN** the status reports that the release cannot be installed in this container and no install-latest action is offered, even when recreate is
