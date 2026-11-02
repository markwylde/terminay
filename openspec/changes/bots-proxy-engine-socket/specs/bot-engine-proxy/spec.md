## ADDED Requirements

### Requirement: Every bot has a shared-engine proxy
Each bot SHALL receive a Docker-compatible Unix socket at /var/run/docker.sock when its container starts. Standard Docker CLI, Compose and API clients SHALL use it without an opt-in switch. The proxy SHALL use the pinned engine and the daemon-side socket mount. Agent session completion SHALL not stop the proxy. A failed proxy startup SHALL fail container startup, and unexpected proxy termination SHALL end the container rather than leave apparently working engine access.

#### Scenario: Compose starts on a new bot
- **WHEN** a user or agent runs docker compose up with a valid configuration in a newly started bot
- **THEN** the command can reach the shared engine without enabling socket sharing

### Requirement: Creation is attributed at the API boundary
The proxy SHALL inject the owning server ID, bot ID and workload marker into Docker-compatible container, network and volume creation requests, and native Podman equivalents. It SHALL preserve unrelated labels, including Compose metadata, and override caller-supplied Terminay ownership labels. The caller SHALL not choose the proxy identity. Existing resources SHALL not be relabelled by ordinary control operations.

#### Scenario: Compose and a direct API client create containers
- **WHEN** Compose or a direct API client creates a container through a bot's socket
- **THEN** it carries that bot's ownership labels and appears in that bot's Containers view

#### Scenario: Two bots create workloads
- **WHEN** two bots create containers concurrently through their own sockets
- **THEN** each new container carries its creating bot's identity

### Requirement: Shared engine control remains unrestricted
The proxy SHALL pass through operations on other containers and SHALL not filter engine lists by ownership. Attribution SHALL not be presented as a security sandbox. A request made through one bot's proxy to start, stop, inspect, exec into or remove an existing container SHALL preserve that container's labels.

#### Scenario: Bot controls another container
- **WHEN** a bot stops a container created elsewhere
- **THEN** the operation reaches the engine without changing the container's recorded creator

### Requirement: Bounded transparent HTTP transport
The proxy SHALL preserve API versions, query strings, status codes, response headers, binary data, streaming requests/responses, Docker HTTP upgrades, terminal input/output and backpressure. Creation JSON SHALL be validated and bounded to 2 MiB before forwarding; invalid, compressed or oversized creation bodies SHALL fail without reaching the engine. Connections, outstanding requests, header sizes and finite input deadlines SHALL be bounded. Credentials and bodies SHALL not be logged. Shutdown SHALL close upstream requests, upgraded streams and the owned socket.

#### Scenario: Build, logs and interactive exec
- **WHEN** a client uploads a build context, follows logs or attaches an interactive exec
- **THEN** traffic streams without whole-body buffering and interactive input and output remain usable

### Requirement: Engine UI describes attribution
The bot environment SHALL describe its socket as proxied and engine access as shared. Its Containers view SHALL list its attributed workloads, excluding Terminay infrastructure, while making no claim that the bot cannot control other containers. The image SHALL include Docker CLI and Compose.

#### Scenario: Bot settings
- **WHEN** the user opens Environment
- **THEN** shared proxy access is described without a socket-sharing toggle or confirmation
