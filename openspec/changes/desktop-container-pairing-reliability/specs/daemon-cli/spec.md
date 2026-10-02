## MODIFIED Requirements

### Requirement: Documented local-container flow

The operations runbook SHALL document connecting Terminay Desktop to a server running in a container on the same machine. It SHALL explain that WebRTC media uses UDP in addition to HTTPS signaling, that the required UDP port must be published and reachable, and that containers on macOS and Windows run inside a VM whose private address the Desktop host cannot route to; `--network host` does not change that. It SHALL show how to configure `--advertise-address` with the host's routable address and pair through hosted signaling. It SHALL also document the distinct same-host loopback direct-signaling option and state that a loopback direct origin does not make the container's UDP media path reachable. The guide SHALL cover connect-then-disconnect symptoms as well as ICE remaining in `checking` and explain how to collect candidate diagnostics. Every documented example SHALL use a routable address for container media reachability; loopback examples SHALL be clearly identified as signaling-only.

#### Scenario: An operator follows the container flow

- **WHEN** an operator wants to connect Desktop to a server in a local container
- **THEN** the runbook gives a container command publishing the advertised UDP port, an install command naming the host's routable address, and a hosted pairing step

#### Scenario: An operator diagnoses a transient container connection

- **WHEN** signaling and data channels open but the media peer disconnects shortly afterward
- **THEN** the runbook identifies unpublished or unreachable UDP candidates as a likely cause and directs the operator to the candidate-pair diagnostics

#### Scenario: Loopback direct origin is used in a container

- **WHEN** an operator advertises `https://localhost:<port>` for a server inside a container
- **THEN** the runbook explains that this reaches only the host-published signaling listener and does not configure WebRTC's UDP route

### Requirement: Pairing from the terminal

`daemon qr-code`, with alias `daemon pairing-url`, SHALL obtain the running server's live pairing handoffs through the data-root socket, render a terminal QR code for the hosted URL when hosted exposure is enabled and for the direct URL only when hosted exposure is unavailable or `--mode direct` is selected, print every URL with its expiry and mode, and then wait for a device to request enrollment. When a request arrives the CLI SHALL show the device name and match code and prompt to approve or deny; when the room is about to expire it SHALL request a fresh room and redraw. `--no-wait` SHALL print and exit; `--mode hosted|direct` SHALL select the rendered URL. `daemon approvals`, `daemon approve <id>`, and `daemon deny <id>` SHALL forward to the server's approval operations for non-interactive use. The CLI SHALL never print a host key or device key.

#### Scenario: QR and approval in one session

- **WHEN** `daemon qr-code` runs and a device scans the code
- **THEN** the device name and match code are shown and the operator's approval or denial is sent to the server

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

## ADDED Requirements

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

- **WHEN** the Node.js binary running the CLI is not executable by the service account
- **THEN** the CLI reports that path and recommends a system-wide Node.js installation
