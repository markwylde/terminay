## ADDED Requirements

### Requirement: Public host flag

`daemon install` and `daemon upgrade` SHALL accept `--public-host <host>`, the one address or name at which devices reach this machine. The CLI SHALL derive the direct origin from it as `https://<host>:<port>` and, when the host is a routable literal address, the advertised ICE address as `<host>:<ice-port>`, and SHALL print both derived values. An explicit `--direct-origin` or `--advertise-address` SHALL take precedence over the value derived for that setting. The CLI SHALL validate the public host before writing anything, SHALL record it in the install record, and SHALL keep the recorded value on `upgrade` when the flag is absent.

A public host that is a name or a loopback address SHALL derive the direct origin only, and the CLI SHALL say that browsers and phones need a routable literal address.

#### Scenario: One address configures both routes

- **WHEN** `daemon install --public-host 192.168.2.218` runs
- **THEN** the service environment carries a direct origin of `https://192.168.2.218:8443` and an advertised ICE address of `192.168.2.218:51000`
- **AND** the output names both and the UDP ports that must be reachable

#### Scenario: A name derives the direct origin only

- **WHEN** `daemon install --public-host box.example.com` runs
- **THEN** the direct origin is `https://box.example.com:8443` and no advertised ICE address is written
- **AND** the output says a routable literal address is needed for browsers and phones

#### Scenario: An explicit setting wins

- **WHEN** `daemon install --public-host 192.168.2.218 --direct-origin https://box.example.com:8443` runs
- **THEN** the direct origin is `https://box.example.com:8443` and the advertised ICE address is `192.168.2.218:51000`

#### Scenario: Upgrade keeps the public host

- **WHEN** `daemon upgrade` runs with no `--public-host` on a server installed with one
- **THEN** the upgraded service keeps the recorded public host and its derived values

### Requirement: Commands against a foreground server

When no install record exists, `daemon qr-code`, `daemon pairing-url`, `daemon approvals`, `daemon approve`, `daemon deny`, and `daemon status` SHALL locate the running server through the data root named by `TERMINAY_DATA_ROOT` and SHALL reach its owner-only socket as the invoking account, without systemd and without `sudo`. `daemon status` SHALL then report readiness, version, revision, exposure modes, public host, and advertised address from the server itself, and SHALL say the server is not managed by a service unit.

`daemon install`, `upgrade`, `start`, `stop`, and `uninstall` SHALL refuse, changing nothing, when the environment declares that a container runtime manages the server, and SHALL name the container-runtime action that corresponds.

#### Scenario: Pairing with no install record

- **WHEN** `daemon qr-code` runs as the account that owns a foreground server's data root, with `TERMINAY_DATA_ROOT` set and no install record
- **THEN** the QR code and pairing links are shown and approval works in that terminal

#### Scenario: Status with no service unit

- **WHEN** `daemon status` runs against a foreground server with no install record
- **THEN** the report gives readiness, version, revision, and exposure modes, and says no service unit manages the server

#### Scenario: No server owns the data root

- **WHEN** a pairing command runs with `TERMINAY_DATA_ROOT` set and no server listening on its socket
- **THEN** the command fails and says no server is running against that data root

#### Scenario: Lifecycle command inside a managed container

- **WHEN** `daemon upgrade` runs where a container runtime manages the server
- **THEN** it changes nothing and says to pull a newer image and recreate the container

## MODIFIED Requirements

### Requirement: Documented local-container flow

The operations runbook SHALL document running Terminay Server from the official image as the container path, with one run command for each of: Terminay Desktop on the same machine or network, which needs no address and no published UDP port; browsers and phones, which need the public host and the pinned UDP range published; and a Linux host using host networking, which needs neither. Each run command SHALL mount a named volume at the data root and another at the image user's home directory, so that neither the server's identity nor a person's projects are lost when the container is recreated. Each SHALL be followed by the single exec command that pairs a device.

The runbook SHALL explain why the cases differ: that WebRTC media uses UDP in addition to HTTPS signaling; that a container on macOS or Windows runs inside a VM whose private address a client cannot route to, and host networking does not change that; that Desktop offers its real addresses so the server can open the path outbound; and that browsers conceal their local addresses, so the server must be given an address they can reach. It SHALL state that a loopback direct origin carries signaling only. It SHALL state that Terminay operates no media relay and SHALL direct an operator whose network defeats direct connectivity to an overlay network such as Tailscale.

The guide SHALL cover connect-then-disconnect symptoms as well as ICE remaining in `checking`, SHALL name a host firewall that blocks inbound UDP to Desktop as a cause when no UDP port is published, SHALL say that a public host given as a literal address must be updated when the machine changes network, and SHALL explain how to collect candidate diagnostics. Every documented example that supplies an address for media reachability SHALL use a routable one; loopback examples SHALL be clearly identified as signaling-only.

#### Scenario: An operator follows the container flow

- **WHEN** an operator wants to connect Desktop to a server in a local container
- **THEN** the runbook gives a run command for the official image that names no address and publishes no UDP port, and the exec command that pairs

#### Scenario: A container is recreated

- **WHEN** an operator removes a container started from a documented run command and starts another with the same command
- **THEN** paired devices reconnect without pairing again
- **AND** the files in the terminal user's home directory are still there

#### Scenario: An operator wants browser or phone access

- **WHEN** an operator wants to reach a containerised server from a browser or a phone
- **THEN** the runbook gives a run command that sets the public host and publishes the pinned UDP range

#### Scenario: An operator runs on a Linux host

- **WHEN** an operator runs the image on a Linux host with host networking
- **THEN** the runbook says no address and no port publishing is needed and gives that command

#### Scenario: An operator diagnoses a transient container connection

- **WHEN** signaling and data channels open but the media peer disconnects shortly afterward
- **THEN** the runbook identifies unpublished or unreachable UDP candidates and a host firewall as likely causes and directs the operator to the candidate-pair diagnostics

#### Scenario: Loopback direct origin is used in a container

- **WHEN** an operator advertises `https://localhost:<port>` for a server inside a container
- **THEN** the runbook explains that this reaches only the host-published signaling listener and does not configure WebRTC's UDP route

#### Scenario: A network defeats direct connectivity

- **WHEN** an operator's devices cannot reach the server by any offered candidate
- **THEN** the runbook says Terminay provides no relay and describes connecting both ends to an overlay network
