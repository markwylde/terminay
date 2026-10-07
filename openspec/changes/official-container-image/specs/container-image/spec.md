## ADDED Requirements

### Requirement: A bare run produces a pairable server

The official image SHALL run the standalone Terminay Server in the foreground as the container's main process, with hosted and direct exposure enabled, without any argument, environment variable, published port, or init system. The image SHALL NOT run or require systemd. The container SHALL stop within the server's bounded graceful shutdown when it receives `SIGTERM`.

#### Scenario: Run with no configuration

- **WHEN** an operator runs the image with only a container name
- **THEN** the server reaches readiness and advertises a hosted pairing link
- **AND** no init system is running in the container

#### Scenario: Graceful stop

- **WHEN** the container runtime stops the container
- **THEN** the server exits with status 0 inside the runtime's default stop timeout

### Requirement: Pairing from inside the container

The image SHALL carry the `terminay` command on the default `PATH`. `terminay daemon qr-code`, `daemon approvals`, `daemon approve`, `daemon deny`, and `daemon status`, run through the container runtime's exec as the image's default user, SHALL reach the running server without `sudo`, without an install record, and without further arguments.

#### Scenario: Pair with two commands

- **WHEN** an operator starts a container from the image and then execs `terminay daemon qr-code` in it
- **THEN** the terminal shows the pairing QR code and links and waits for a device
- **AND** a device that opens the link is approved from that same terminal

#### Scenario: Lifecycle commands defer to the container runtime

- **WHEN** an operator execs `terminay daemon install`, `upgrade`, `start`, `stop`, or `uninstall` in the container
- **THEN** the command changes nothing and says the server is managed by the container runtime, naming the runtime action that corresponds

### Requirement: Image defaults

The image SHALL listen for signaling on TCP port 8443 on all container interfaces and SHALL keep the data root at `/var/lib/terminay`, declared as a volume. When no direct origin and no public host is supplied, the direct origin SHALL be `https://localhost:8443`. With no public host and no ICE port configured, the server SHALL gather ICE candidates on ephemeral ports, so that the number of devices it can serve is not bounded by a published range. When a public host that is a routable literal address or an ICE port is configured, the server SHALL pin its ICE ports to a run of sixteen consecutive UDP ports beginning at 51000 unless configured otherwise. Each default SHALL be overridable by the server's documented environment variables.

#### Scenario: Defaults with no configuration

- **WHEN** the image runs with no configuration
- **THEN** the direct pairing link names `https://localhost:8443`
- **AND** the server offers ICE candidates on ephemeral ports

#### Scenario: A public host replaces the loopback default

- **WHEN** the image runs with `TERMINAY_PUBLIC_HOST` set to a routable literal address
- **THEN** the direct pairing link names that address on port 8443
- **AND** the server offers that address as a candidate on UDP port 51000
- **AND** every candidate it offers uses a UDP port from 51000 through 51015

### Requirement: Unprivileged runtime user

The image SHALL run the server, its terminals, and the bundled CLI as one unprivileged account that owns the data root. The image SHALL NOT require a privileged container, added capabilities, or a writable root filesystem.

#### Scenario: Runs with capabilities dropped

- **WHEN** the image runs with all capabilities dropped, no new privileges, and a read-only root filesystem with a writable data volume and temporary directory
- **THEN** the server reaches readiness and a paired device opens a terminal

### Requirement: Identity survives container recreation

The server identity, host key, paired devices, and hosted session origin SHALL be read from the data root. The image SHALL NOT derive the server identity from the container's hostname: the identity is chosen once, on the first start against an empty data root, and a later container with a different hostname started against the same data root SHALL report the same identity. The container's hostname SHALL be used only as the host name shown in pairing links and connection labels.

#### Scenario: New container, same volume

- **WHEN** a container is removed and a new one is started from the image with the same data volume
- **THEN** the server reports the same identity and host key
- **AND** a previously paired device reconnects without pairing again

#### Scenario: A named host

- **WHEN** a container is started with an explicit hostname
- **THEN** pairing links name that hostname

### Requirement: The image reports its build

The server in the image SHALL report the version and the source revision the image was built from, in its readiness record and through `terminay daemon status`. An image built from the default branch is identified by its revision.

#### Scenario: Status names the build

- **WHEN** an operator execs `terminay daemon status` in the container
- **THEN** the report includes the image's version and revision

### Requirement: Container health

The image SHALL declare a container health check that reports healthy only when the server is ready. The health endpoint SHALL return lifecycle status only and SHALL NOT be the signaling port.

#### Scenario: Health follows readiness

- **WHEN** the server has reached readiness
- **THEN** the container runtime reports the container as healthy

### Requirement: Publication

The image SHALL be published as `markwylde/terminay` on Docker Hub for Linux `amd64` and `arm64`, from the same build that publishes `ghcr.io/<owner>/terminay-server`, so both names resolve to one manifest digest. `latest` SHALL name the newest tagged release. A pull request SHALL build the image and run its smoke test without publishing. Publication to Docker Hub SHALL be skipped, without failing the release, where its credential is not configured.

#### Scenario: Both names are one image

- **WHEN** a tagged release is published
- **THEN** `markwylde/terminay:<version>` and `ghcr.io/<owner>/terminay-server:<version>` resolve to the same manifest digest

#### Scenario: Latest is a release

- **WHEN** a commit is merged to the default branch without a release tag
- **THEN** `markwylde/terminay:latest` does not move

#### Scenario: No Docker Hub credential

- **WHEN** a release runs where the Docker Hub credential is absent
- **THEN** the image is published to GHCR and the release does not fail

### Requirement: Image smoke test

Pull-request CI SHALL start the built image with no configuration and no published UDP port, pair Terminay Desktop's own pairing and reconnect code with it through a signaling route, approve the device through the bundled CLI, and require that the session's selected candidate pair succeeds and stays connected. A second case SHALL set a public host, publish the pinned UDP range, and require that a client the server cannot route to, and which cannot route the container's own address, connects over the advertised candidate.

#### Scenario: No configuration, no UDP port

- **WHEN** the smoke test runs the image with only its signaling port published
- **THEN** Desktop's pairing code pairs, reconnects, and holds the connection

#### Scenario: Public host and published range

- **WHEN** the smoke test runs the image with a public host and the pinned UDP range published
- **THEN** a client on a network isolated from the server's connects over the advertised candidate
