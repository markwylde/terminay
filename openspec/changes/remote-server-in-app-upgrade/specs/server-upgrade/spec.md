## ADDED Requirements

### Requirement: Release check on the server's own channel

A standalone Terminay Server SHALL learn whether a newer release of its installed channel exists by reading the project's GitHub release metadata over HTTPS. A tagged install SHALL compare against the newest tagged release and a `main` install against the newest `main` revision. The check SHALL run when the server starts, when a client attaches and the last check is more than an hour old, and once an hour while at least one client is attached; it SHALL NOT run while no client is attached. The request SHALL carry no server id, device record, workspace, terminal, or setting data. A failed check SHALL leave the last known result in place, SHALL be retried at the next check, and SHALL NOT disturb any connection.

A server built from source, and the embedded Local server, SHALL NOT check and SHALL report that no upgrade is offered.

#### Scenario: Newer tagged release

- **WHEN** a server installed from tag `v5.1.1` checks and the newest tagged release is `v5.2.0`
- **THEN** it records that `5.2.0` is available

#### Scenario: Newer main revision

- **WHEN** a `main` install checks and the `main` prerelease was built from a later revision
- **THEN** it records that a newer `main` build is available

#### Scenario: No client attached

- **WHEN** the last attached client detaches
- **THEN** no further check runs until a client attaches

#### Scenario: Check fails

- **WHEN** the release metadata cannot be fetched
- **THEN** the last known result stands and connected clients see no error

#### Scenario: Embedded Local server

- **WHEN** the server is the embedded Local server of Terminay Desktop
- **THEN** it performs no check and reports that no upgrade is offered

### Requirement: Upgrade status is server-owned state every client receives

The server SHALL publish its upgrade status to every attached client under the optional `server.upgrade` capability, and SHALL republish it whenever it changes. The status SHALL state the running version and channel, the available version when there is one, whether the server can carry out the upgrade itself, the upgrade modes it offers, and the state of an upgrade: none, in progress, or the outcome of the last one. When the server cannot carry out the upgrade itself, the status SHALL give the reason and the command an operator runs on the host. A client connected to a server without the capability SHALL show no upgrade indication for it.

#### Scenario: Status reaches every client

- **WHEN** a check finds a newer release while a Desktop, a browser, and a phone client are attached
- **THEN** all three receive the same status naming the available version

#### Scenario: Server cannot upgrade itself

- **WHEN** a system-scope server has no upgrade helper installed
- **THEN** its status reports the available version, that in-app upgrade is unavailable, and the command to run on the host

#### Scenario: Server without the capability

- **WHEN** a client attaches to a server that does not declare `server.upgrade`
- **THEN** the client shows no upgrade indication and sends no upgrade operation to it

### Requirement: Any paired device may start an upgrade, and names nothing but the mode

The server SHALL accept an upgrade request from any authenticated paired device. The request SHALL carry only the upgrade mode, which SHALL be one the server's status offers. It SHALL NOT carry a version, reference, URL, path, or flag, and the server SHALL reject a request that does. The server SHALL always upgrade to the release its own check resolved on its own channel, SHALL never move to an older release, and SHALL install a release in place only after its SHA-256 digest and Ed25519 signature verify. A request made while an upgrade is in progress, or when none is available, SHALL be rejected with a structured error and SHALL change nothing.

#### Scenario: Paired device starts an upgrade

- **WHEN** a paired device requests an upgrade in an offered mode while one is available
- **THEN** the server begins the upgrade and publishes that it is in progress

#### Scenario: Request names a version

- **WHEN** an upgrade request carries a version, URL, or path
- **THEN** the server rejects it and no upgrade begins

#### Scenario: Unoffered mode

- **WHEN** a request names the recreate mode on a server whose status does not offer it
- **THEN** the server rejects it

#### Scenario: Upgrade already running

- **WHEN** a second device requests an upgrade while one is in progress
- **THEN** the request is rejected and the running upgrade is unaffected

### Requirement: The upgrade runs outside the server it replaces

The server SHALL carry out an upgrade by handing it to the upgrader shipped in its own release, running as a process that outlives the server. It SHALL NOT fetch an upgrader from a package registry and SHALL NOT require a system Node.js or npm. A user-scope service SHALL run the upgrader as its own account. A system-scope service SHALL request the upgrade through the root-owned upgrade helper and SHALL NOT gain privileges itself. A container server SHALL upgrade in place by default.

#### Scenario: Host without npm

- **WHEN** an upgrade starts on a host that has no Node.js or npm installed outside the server's release
- **THEN** the upgrade completes

#### Scenario: User-scope service

- **WHEN** a user-scope server starts an upgrade
- **THEN** the upgrader runs as that account, restarts the user unit on the new release, and the server reports ready

#### Scenario: System-scope service

- **WHEN** a system-scope server starts an upgrade
- **THEN** the root-owned helper performs it and the server process holds no more privilege than before

### Requirement: Terminal sessions survive an in-place upgrade

An in-place upgrade SHALL NOT end a terminal session. Attached clients SHALL see that server's connection drop and return, and SHALL find every terminal that was running still running with its output intact, on a systemd service and in a container alike.

#### Scenario: Shell keeps running on a service

- **WHEN** a systemd-managed server is upgraded in place while a shell is running a command
- **THEN** the command is still running when the client reconnects

#### Scenario: Shell keeps running in a container

- **WHEN** a container server is upgraded in place while a shell is running a command
- **THEN** the container keeps running, and the command is still running when the client reconnects

### Requirement: A container with the Docker socket can be recreated on the newer image

When the Docker socket is mounted into a container server and usable by it, the server's status SHALL offer a recreate mode beside the in-place mode. Recreating SHALL pull the newer image and replace the container with one of the same name, configuration, volumes, networks, and published ports, running that image. It SHALL end every terminal session of that server, and the server SHALL say so in its status so a client can warn before it is chosen. If the newer container does not report ready, the previous container SHALL be started again. Without a usable socket the recreate mode SHALL NOT be offered.

The image pulled SHALL be the repository the container was created from, at the same moving tag or at the version tag of the available release, and SHALL be trusted as that registry is trusted; it is not covered by the release signature. A container created from an image digest, or one the engine removes when it stops, SHALL NOT be offered the recreate mode.

#### Scenario: Digest-pinned container

- **WHEN** a container server with a usable Docker socket was created from an image digest
- **THEN** its status offers in-place only

#### Scenario: Socket mounted

- **WHEN** a container server with a usable Docker socket has an upgrade available
- **THEN** its status offers both in-place and recreate, and marks recreate as ending terminals

#### Scenario: Socket absent

- **WHEN** a container server has no Docker socket
- **THEN** its status offers in-place only

#### Scenario: Recreate

- **WHEN** a paired device chooses recreate
- **THEN** a container of the same name, volumes, and ports runs the newer image, and paired devices reconnect without pairing again

#### Scenario: Recreated container is not ready

- **WHEN** the newer container does not report ready within the timeout
- **THEN** the previous container is running again and the outcome reports the failure

### Requirement: The outcome of an upgrade is reported after reconnect

The server that is running after an upgrade attempt SHALL report its outcome in its upgrade status: the version it moved from and to on success, or on failure the reason and that the previous version was restored. The outcome SHALL be available to every client that attaches after the attempt, not only the device that started it, until the next check or attempt replaces it.

#### Scenario: Successful upgrade

- **WHEN** a client reconnects after an upgrade from `5.1.1` to `5.2.0` succeeded
- **THEN** the status reports version `5.2.0`, no upgrade available, and the completed move

#### Scenario: Rolled back

- **WHEN** the upgraded server did not report ready and the previous version was restored
- **THEN** a reconnecting client is told the upgrade failed and that `5.1.1` is running again

#### Scenario: Another device attaches later

- **WHEN** a device that did not start the upgrade attaches after it failed
- **THEN** it sees the same failure outcome
