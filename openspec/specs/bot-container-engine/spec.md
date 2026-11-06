# bot-container-engine Specification

## Purpose

Define local container-engine discovery, identity, transport, recovery, and the bot’s shared browser and desktop environment.

## Requirements

### Requirement: One local socket transport

The server SHALL operate bots through the Docker-compatible HTTP API over a local Unix socket, regardless of whether Docker or Podman implements the API. Container, network and volume lifecycle, image inspect/build/tag/remove, event subscriptions, logs, usage, file helpers, agent exec, interactive shell and device sign-in, and desktop tunnels SHALL use this transport. A reachable configured or standard socket SHALL work without a host `docker` or `podman` executable. Engine services SHALL stay in the privileged server; clients SHALL receive neither the socket nor an arbitrary engine-request interface.

#### Scenario: Packaged app with minimal PATH

- **WHEN** Terminay starts from the Dock with neither engine CLI on PATH and a reachable Docker-compatible socket
- **THEN** bots can inspect and build their image and run on that engine

#### Scenario: Real Docker CLI points to Podman

- **WHEN** the socket belongs to Podman and a real Docker CLI is also installed
- **THEN** the engine is identified as Podman from the server API and CLI selection has no effect

### Requirement: Local endpoint discovery and selection

The server SHALL discover sockets from explicit server-side environment configuration, the selected Docker context, standard Docker/Podman locations and local Podman machine metadata. Explicitly configured remote TCP or SSH endpoints SHALL be refused; the server SHALL NOT silently substitute another endpoint for an invalid explicit selection. A local Podman machine SHALL be reached through its forwarded host Unix socket. Optional engine tooling SHALL only supply discovery metadata, never execute bot operations. Multiple aliases of the same engine SHALL appear as one candidate. Distinct engines SHALL require a choice; a single engine SHALL be selected automatically. Unsupported platforms and rootless Docker SHALL retain their setup refusals. Rootful Docker and rootful/rootless Podman on macOS and Linux SHALL remain supported.

#### Scenario: Socket aliases

- **WHEN** `/var/run/docker.sock` and the Podman machine socket resolve to the same engine
- **THEN** the dashboard offers one Podman candidate

#### Scenario: Explicit remote host

- **WHEN** the server account sets `DOCKER_HOST=tcp://build-host:2375`
- **THEN** setup reports that bots require a local engine and no request reaches that host

#### Scenario: Two engines

- **WHEN** two distinct supported local engines are reachable and no pin exists
- **THEN** the dashboard offers both and asks the user to choose

### Requirement: Stable engine pin and owned resources

The server SHALL persist the selected endpoint and a stable identity verified on that endpoint. Podman's compatibility `info.ID` SHALL NOT supply that identity. Discovery SHALL NOT create engine resources. Selection SHALL establish an engine-local persistent identity marker when needed. A pinned endpoint whose identity marker disappears or changes SHALL require explicit Use this engine confirmation before bot operations resume. Later default-context changes SHALL NOT redirect a pin. Repeated checks and a server restart SHALL retain a valid pin. Engine switching SHALL leave the old engine untouched and adoption SHALL require both server and bot ownership labels.

#### Scenario: Changing compatibility IDs

- **WHEN** Podman's Docker-compatible info response generates a different ID on every request
- **THEN** repeated checks keep the same verified engine available

#### Scenario: Socket now serves a different engine

- **WHEN** the pinned socket is redirected to an engine with a different identity marker
- **THEN** bots stop acting and setup requires explicit engine selection

### Requirement: Engine and image status recover independently

A missing bot image reported with HTTP 404 SHALL be shown as missing with a Build image action. An image probe failure SHALL preserve the engine selection and report an image failure rather than reject the whole status read. Unavailable engines SHALL leave bots editable and other application features responsive. Status reads SHALL publish no invalidation; explicit checks SHALL publish only the final changed state. Reads SHALL be coalesced, without timer polling. A failed dashboard status read SHALL clear its current status rather than present a previous engine as current.

#### Scenario: First Podman use

- **WHEN** the selected Podman engine has no `terminay-bot:local` image
- **THEN** status succeeds, identifies Podman as available, and offers Build image

#### Scenario: Image inspection fails

- **WHEN** the engine responds to availability probes but image inspection fails
- **THEN** status still identifies the selected engine and exposes a bounded image error

#### Scenario: Failed read after switching

- **WHEN** the user switches from Docker to Podman and the subsequent status read fails
- **THEN** the page reports the failure and does not show the old Docker status as current

### Requirement: Socket sharing uses the daemon-side path

Every bot SHALL receive default proxy access as specified by bot-engine-proxy. The transport's host socket path SHALL be separate from the daemon-side bind source. The daemon-side path SHALL be an absolute filesystem path without a `unix://` scheme. A local Podman machine's native metadata SHALL supply its daemon-side socket. Socket access and group probing SHALL run inside the engine's namespace. Rootless ownership and resource-limit warnings SHALL remain correct.

#### Scenario: Podman machine remote socket has a URI scheme

- **WHEN** native metadata reports `unix:///run/podman/podman.sock` and a bot starts with its engine proxy
- **THEN** the bind source is `/run/podman/podman.sock` and the bot receives it at `/var/run/docker.sock`

### Requirement: Bounded API streams and supervised execution

The transport SHALL negotiate a compatible API version, classify errors by transport and HTTP status, bound finite requests by absolute deadlines and output size, and cancel requests on authority loss. Build progress SHALL detect structured build failures and publish the local image tag only after success. Binary non-TTY streams SHALL demultiplex stdout/stderr correctly across arbitrary frame boundaries; TTY streams SHALL use API resize. Backpressure SHALL bound queued data. Closing a transport SHALL retire requests and streams; closing a socket SHALL NOT substitute for confirmed container-side session process-group cleanup. Secrets SHALL travel only in exec request bodies, SHALL be redacted before storage or client delivery, and SHALL NOT occur in URLs, argv or diagnostics. Event streams SHALL be subscribed without periodic availability polling.

#### Scenario: Fragmented exec frame

- **WHEN** an exec response splits its frame header and binary payload across network chunks
- **THEN** stdout and stderr receive the exact original bytes without frame headers

#### Scenario: Shell resize and close

- **WHEN** a user resizes and closes a bot shell
- **THEN** the engine receives the TTY dimensions and the container-side supervised shell group is terminated

#### Scenario: Build stream contains an error

- **WHEN** image build HTTP succeeds but its progress stream contains `errorDetail`
- **THEN** the build fails and the previous local image remains current

### Requirement: Saved selections and recovery actions remain usable

The server SHALL verify a saved native engine selection against its recorded local endpoint and identity before adopting the stable socket pin. A verifiable saved selection SHALL continue without asking the user to choose it again. An unavailable pin SHALL offer an explicit recovery action for each reachable candidate, including the same address. Socket addresses SHALL fit within the engine summary without hiding that action. An alias of the selected engine SHALL NOT be offered as another engine.

#### Scenario: Saved native Podman machine connection

- **WHEN** the saved connection belongs to the same local Podman machine and root mode and its native identity matches
- **THEN** the engine remains selected and available through its local socket without another selection

#### Scenario: Recovery at the same long address

- **WHEN** a pinned engine is unavailable and a reachable candidate has the same kind and a long socket address
- **THEN** Use this engine is visible and usable within the summary rail without horizontal scrolling

### Requirement: Browser work is verified on the shared desktop

Bot environment instructions SHALL identify the actual shared display and installed control tools, direct agents to reuse the desktop browser, and require inspecting visible results before claiming completion. A background shell launch exit SHALL NOT constitute browser success. The user and agent SHALL operate the same desktop.

#### Scenario: Navigation fails

- **WHEN** the browser does not show the requested page after an action
- **THEN** the instructions direct the bot to inspect and report the failure rather than claim the page opened

### Requirement: Chat messages can be revised and cleared

A user SHALL be able to right-click a user or assistant message to edit or delete it. Edits and deletions SHALL persist on the server, update attached clients, and update future bot context without resuming the prior provider conversation or rerunning earlier tools. Mutations SHALL require write authority, bot/message ownership and an unchanged message revision. Clear chat SHALL require confirmation and clear the shared message log, revoke active execution capabilities and stop active executions, while preserving the bot home, memories, credentials, triggers and external effects.

#### Scenario: Edit an incorrect assistant claim

- **WHEN** a user edits an idle assistant message and saves
- **THEN** the revised message persists and the next turn uses the revised history in a fresh provider conversation

#### Scenario: Delete a user message

- **WHEN** a user deletes an idle user message
- **THEN** it is removed from the stored conversation and future context

#### Scenario: Clear conversation

- **WHEN** a user confirms Clear chat
- **THEN** the selected conversation is removed and the next message starts without its history

#### Scenario: Stale or unauthorized mutation

- **WHEN** a reader, another bot's session, a changed target, or a running turn is targeted
- **THEN** the mutation is refused and the transcript is preserved

### Requirement: Browser lifecycle follows explicit user intent
The container SHALL launch Chromium once at desktop startup. Closing Chromium SHALL leave it closed. An explicit URL command SHALL use Chromium single-instance dispatch to navigate an existing browser or launch one when closed, outside the agent tool process group. It SHALL accept only bounded HTTP(S) URLs and SHALL acknowledge launch requests without claiming page-load success. No browser monitoring or automatic restart SHALL occur.

#### Scenario: Browser is closed
- **WHEN** the user or agent closes Chromium
- **THEN** the desktop leaves it closed until container startup or an explicit website request

#### Scenario: Website request after closing
- **WHEN** the agent requests an HTTP(S) URL with the browser closed
- **THEN** the desktop launches Chromium for that request and the agent verifies the page through a fresh screenshot

### Requirement: Unreported tool outcomes remain explicit
A transcript SHALL animate an unfinished tool only while its turn is active. A finished turn with no terminal tool status SHALL show an unknown outcome rather than success.

#### Scenario: Foreground browser command outlives the response
- **WHEN** the response ends without a final tool status
- **THEN** the entry stops animating and says no final status was reported

### Requirement: Container image previews in chat
Chat and session transcripts SHALL render local PNG, JPEG, GIF and WebP Markdown images through authenticated, bounded container reads. Reads SHALL require bot I/O authority and matching bot ownership, execute as the unprivileged bot user, refuse symlinks, traversal and non-regular files, and accept only paths beneath the container's /tmp or /home/bot. Remote images SHALL NOT load automatically. Unavailable images SHALL show a readable error without opening a host path.

#### Scenario: Agent posts a desktop screenshot
- **WHEN** an assistant message contains a Markdown image referencing its screenshot in /tmp
- **THEN** chat displays the image inline using bounded bytes from that bot's container

#### Scenario: Image is unavailable
- **WHEN** a referenced file is absent or the container is stopped
- **THEN** chat displays an unavailable-image message

### Requirement: Browser fills the desktop
Chromium SHALL start maximized within the container desktop.

#### Scenario: Browser starts at container startup or on request
- **WHEN** Chromium launches
- **THEN** its initial window fills the desktop work area

### Requirement: Supervised commands never auto-launch a session bus

Every supervised command in a bot container SHALL get a session bus address set by the supervisor. This covers agent executions, trigger sources, shells and desktop launches. The address SHALL replace any value the caller supplied, including an empty or `autolaunch:` address. When the bot's desktop session bus is running, the address SHALL be that bus. Otherwise it SHALL be the disabled address. A D-Bus client that only opens the session bus SHALL therefore never start a session bus daemon.

#### Scenario: Command-line tool that uses a keyring

- **WHEN** a trigger source runs a command that opens the D-Bus session bus 35 times a minute for an hour
- **THEN** the bot container has no more `dbus-daemon` processes at the end of the hour than at the start

#### Scenario: Desktop not running

- **WHEN** a supervised command runs before the desktop session has started
- **THEN** its session bus address is the disabled address and no `dbus-daemon` is started for it

#### Scenario: Caller asks for auto-launch

- **WHEN** a supervised command is started with `DBUS_SESSION_BUS_ADDRESS=autolaunch:`
- **THEN** the command sees the desktop bus address or the disabled address instead

### Requirement: Process exhaustion is reported as its own cause

An execution or trigger check SHALL be recorded as having run out of processes only when it failed with an `EAGAIN` failure to create a process or thread and the container engine reports the container's process count within 16 of its limit. The reason SHALL then give the count and the limit and tell the user to restart the bot container. The server SHALL read the count and limit from the container engine, never by running a command inside the container.

#### Scenario: Agent cannot spawn

- **WHEN** the agent CLI fails with `spawn ... EAGAIN` while the container is at 1013 of 1024 processes
- **THEN** the execution's reason says the bot container has run out of processes, shows 1013 of 1024, and says to restart the bot container

### Requirement: EAGAIN without engine evidence is reported neutrally

When an `EAGAIN` failure to create a process or thread is seen but the engine cannot report the process count, or the count is not near the limit, the reason SHALL say that the agent could not start a process. The failure SHALL NOT be recorded as process exhaustion.

#### Scenario: Engine cannot report the count

- **WHEN** the agent fails with `EAGAIN` and the engine's stats do not include a process count
- **THEN** the reason says the agent could not start a process, and the failure is not recorded as process exhaustion

#### Scenario: Trigger check cannot spawn

- **WHEN** a trigger's condition command fails to start with `EAGAIN` while the container is at its process limit
- **THEN** the trigger's health error says the bot container has run out of processes, with the count and limit
