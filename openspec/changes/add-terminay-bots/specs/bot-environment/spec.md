## MODIFIED Requirements

### Requirement: A container engine is required and detected

Bots SHALL run on a container engine on the server's machine, either **Docker** or **Podman**, accessed through the Docker-compatible local socket API as specified by bot-container-engine. The server SHALL report whether an engine is available. When none is, the server SHALL name the reason:

- not installed;
- not running;
- permission denied;
- remote engine;
- unsupported engine mode;
- unsupported platform;
- engine changed.

While no engine is available:

- the Bots section SHALL show a setup state that names the reason, says how to resolve it, and offers **Check again**;
- bots SHALL stay listed and editable;
- no other part of Terminay SHALL be affected.

The server SHALL check availability at startup, when the Bots section opens, when the user chooses Check again, and when a bot action needs the engine. It SHALL NEVER check on a timer. While the engine is available, the server SHALL follow the engine's event stream, and SHALL mark the engine unavailable when that stream ends.

#### Scenario: Engine stopped

- **WHEN** the Podman machine is stopped
- **THEN** the Bots section shows that the container engine is not running, and bots can still be renamed and edited

#### Scenario: Engine started later

- **WHEN** the user starts the engine and chooses Check again
- **THEN** the setup state clears and the bots show their container states

#### Scenario: Engine stops while in use

- **WHEN** the engine stops while a bot's session runs
- **THEN** the Bots section shows the setup state, and that session is marked failed

### Requirement: Supported engines, and pinning

The server SHALL support these engines:

- **Docker**, running rootful, on a local Unix socket. This covers Docker Desktop and OrbStack on macOS, and Docker on Linux.
- **Podman**, rootful or rootless. This covers Podman on Linux, and the local Podman machine on macOS.

A Podman machine SHALL count as local when accessed through its forwarded host Unix socket. The server SHALL refuse:

- any other SSH or TCP connection;
- rootless Docker;
- Windows servers.

When Docker and Podman are both available, the user SHALL choose one in the Bots section. The engine kind SHALL be identified from the server API, independently of installed CLI names. Aliases of one engine SHALL appear as one candidate.

On first use, the server SHALL record:

- the engine kind;
- its endpoint or connection;
- its stable engine-local identity marker, as specified by bot-container-engine.

The server SHALL address that recorded engine explicitly on every later call.

- **Different engine.** If the recorded endpoint answers with a different identity, the server SHALL mark the engine as changed, and no bot SHALL act until the user chooses **Use this engine**.
- **After Use this engine.** Every bot SHALL show as not created on the new engine. Nothing on the previous engine SHALL be changed. The server SHALL adopt only resources that carry both its own server id and the bot's id.
- **Engine that cannot enforce limits.** If the engine cannot enforce CPU, memory, or process limits, such as rootless Podman without cgroup delegation, the setup state SHALL warn, and each bot's Overview SHALL show its limits as not enforced.

#### Scenario: Podman machine on macOS

- **WHEN** the server runs on macOS where `docker` is Podman's shim and the default Podman machine is running
- **THEN** the server selects Podman through that machine's forwarded local socket, and bots run there

#### Scenario: Context switched while running

- **WHEN** a user switches their default Docker context or Podman connection to another local engine while Terminay is running
- **THEN** the bots keep using the recorded engine

#### Scenario: Rootless Docker

- **WHEN** the only engine is rootless Docker
- **THEN** the setup state says rootless Docker is not supported, and no bot starts

#### Scenario: Same name on a new engine

- **WHEN** the user chooses Use this engine and the new engine has a container named `terminay-bot-<id>` that does not carry this server's id
- **THEN** that container is not adopted, and the bot shows as not created

#### Scenario: Remote connection

- **WHEN** the default connection points at `ssh://build-host`
- **THEN** the setup state says bots need a local engine, and nothing is created on that host

### Requirement: The bot image is built locally

Every bot SHALL run from one image, `terminay-bot:local`. The server SHALL build it on its own machine from a Dockerfile that ships with Terminay, and SHALL NEVER pull a prebuilt bot image.

The image SHALL contain:

- a desktop served over password-protected VNC;
- a browser;
- common developer tools;
- the `docker` command line;
- the Terminay session launcher and home-volume helper;
- the pinned native CLI of every contributed bot agent supported by the server native-driver contract.

The desktop SHALL open Chromium automatically on its own display when it starts, as the unprivileged `bot` user with the browser sandbox enabled. The browser SHALL be owned by the desktop lifecycle, independently of agent sessions and tool commands. A new browser profile SHALL open a blank page without first-run prompts.

On Linux, the image's `bot` user SHALL have the user and group ids of the server account.

The image SHALL carry a fingerprint of its inputs. Build progress and the build log SHALL be shown. A failed build SHALL keep the previous image and SHALL show the step that failed.

#### Scenario: First start

- **WHEN** a user starts the first bot on a machine that has no bot image
- **THEN** the image is built from the shipped Dockerfile with progress shown, and then the bot's container starts

#### Scenario: New agent installed

- **WHEN** an extension that contributes a bot agent is installed
- **THEN** the image is shown as out of date, and that agent is shown as not installed in the bot image until a rebuild completes

#### Scenario: Build fails

- **WHEN** an image rebuild fails while installing a bot agent's native CLI
- **THEN** the previous image is kept and the build log shows the failing step

### Requirement: Containers follow the current image

A container whose fingerprint differs from the current image SHALL be updated as follows:

- if it is stopped, it SHALL be recreated from the current image when it next starts;
- if it is running, its bot SHALL show **Recreate to update**, and the container SHALL be recreated only when the user chooses to.

Recreating a running bot whose session is running SHALL first ask the user to confirm, and SHALL then stop that session.

#### Scenario: Rebuilt while stopped

- **WHEN** the image is rebuilt while a bot is stopped and the bot then starts
- **THEN** its container is recreated from the new image and its home is unchanged

#### Scenario: Rebuilt while running

- **WHEN** the image is rebuilt while a bot is running
- **THEN** the bot keeps running on its old container and shows Recreate to update

### Requirement: Each bot has its own container, home, and network

Each bot SHALL run in its own container, `terminay-bot-<bot id>`, labelled `terminay.bot=<bot id>` and `terminay.managed=1`, and attached only to its own network. The bot's home volume, `terminay-bot-<bot id>-home`, SHALL be mounted at `/home/bot`. The agent and the shell SHALL run as the image's `bot` user in `/home/bot`.

- **What persists.** Everything outside the home volume SHALL be reset when the container is recreated. The home SHALL persist until the bot is deleted with its home.
- **Ports.** Terminay SHALL publish no port of a bot's container. It SHALL reach the bot's services, including the desktop, only through the engine's `exec` streams to the container's own loopback.
- **Resource limits.** Each container SHALL run with the bot's CPU, memory, and process limits, which default to 2 CPUs, 4 GiB, and 1024 processes and are settable in the Overview.

#### Scenario: Home persists across recreation

- **WHEN** a bot writes a file to its home and its container is then recreated
- **THEN** the file is still in the bot's home

#### Scenario: Bots are isolated from each other

- **WHEN** one bot tries to connect to another bot's desktop, over the container network or through the host gateway
- **THEN** the connection fails, because the desktop listens only on its own container's loopback and no port is published

#### Scenario: Memory limit

- **WHEN** a bot's processes exceed its memory limit
- **THEN** the engine enforces the limit inside that container, and the host and other bots are unaffected

### Requirement: Container lifecycle

A bot's environment SHALL be in one of these states: not created, building, starting, running, stopping, stopped, or failed. Environment › Overview SHALL offer Start, Stop, Restart, and Recreate.

- **Stop** SHALL stop the bot's running session as session Stop does, then stop the container.
- **Recreate** SHALL remove the container and create it again from the current image, keeping the home.
- **Idle stop.** A running bot SHALL be stopped after an idle period with no running or queued session, no open shell, and no viewed desktop. The idle period SHALL be settable per bot, SHALL default to 30 minutes, and SHALL also allow never.
- **Starting on demand.** A session or trigger that needs a stopped container SHALL start it.
- **Reconciliation.** The server SHALL reconcile each bot's recorded state with the engine at startup and whenever the engine reports a container event.

#### Scenario: Idle stop

- **WHEN** a bot has had no running or queued session, open shell, or viewed desktop for its idle period
- **THEN** its container is stopped and its card shows stopped

#### Scenario: Removed outside Terminay

- **WHEN** a user removes a bot's container with `docker rm -f` while Terminay is running
- **THEN** the bot is shown as not created, and its next session creates the container again

### Requirement: Environment overview

Environment › Overview SHALL show:

- the bot's environment state and uptime;
- the image, and whether the container is current;
- the home volume;
- the resource limits;
- the shared engine proxy and its attribution rules;
- the lifecycle actions.

It SHALL show CPU use, memory use, and home size as read when the Overview opened, with a **Refresh** action. It SHALL NOT sample them on a timer. It SHALL show the container's recent log, capped at its last 256 KiB, with injected secrets redacted.

#### Scenario: Refresh usage

- **WHEN** a user chooses Refresh on a running bot's Overview
- **THEN** CPU, memory, and home size are read again and shown with the time they were read

### Requirement: Files

Environment › Files SHALL browse the bot's home. It SHALL let the user:

- open a folder;
- preview a text or image file;
- download a file or a folder;
- upload files of up to 1 GiB each;
- create a folder, rename, and delete.

Files SHALL work whether the container is running or stopped, through one helper per bot. The helper SHALL:

- mount only the bot's home volume;
- have no network;
- run as `bot`;
- have bounded CPU, memory, and processes;
- stop once no view has used it for 5 minutes.

Uploaded files SHALL be owned by `bot`, and SHALL be written whole or not at all. When the bot has never started, opening Files SHALL create the home volume if the image exists. If the image does not exist, Files SHALL offer to build it.

Files SHALL never follow a symbolic link. It SHALL refuse any operation that would reach outside `/home/bot`, including through a link swapped in during the operation. It SHALL refuse to rename or delete an agent home directory, such as `.codex` or `.claude`.

A folder's contents SHALL update when they change, without the user reloading.

#### Scenario: Upload while stopped

- **WHEN** a user uploads a file to a stopped bot's home
- **THEN** the file is in the bot's home, owned by `bot`, and the container is still stopped

#### Scenario: Link outside home

- **WHEN** a user opens a symbolic link in the bot's home that points to `/etc`
- **THEN** the request is refused and nothing outside the home is shown

#### Scenario: Agent home

- **WHEN** a user tries to delete `.codex` in a Codex bot's home
- **THEN** the request is refused and `.codex` is unchanged

### Requirement: Shell

Environment › Shell SHALL open an interactive terminal in the bot's container, as the `bot` user, in `/home/bot`. Opening it SHALL start the container if it is stopped. The terminal SHALL render, resize, copy, and paste like a Terminay terminal. It SHALL count as activity for idle stop. Closing it SHALL end the shell process.

#### Scenario: Open a shell

- **WHEN** a user opens Shell on a running bot and types `whoami`
- **THEN** the terminal prints `bot`

### Requirement: Shared engine proxy

Every bot SHALL receive the pinned engine through a container-owned proxy at /var/run/docker.sock, as specified by bot-engine-proxy. The proxy SHALL attribute newly created workloads without filtering engine access. Docker CLI and Compose SHALL be installed. The environment SHALL describe default proxy access without a socket-sharing toggle.

#### Scenario: New bot uses Compose
- **WHEN** a newly started bot runs docker compose up with valid configuration
- **THEN** it can reach the engine and created containers carry the bot's ownership labels

### Requirement: Containers

Environment › Containers SHALL list workload containers that carry `terminay.bot=<bot id>`. It SHALL exclude the bot's own container and Terminay infrastructure. A `terminay.workload=1` marker SHALL identify attributed workloads independently of inherited image labels. The same exclusion SHALL apply to container actions. For each workload, it SHALL show the name, image, state, ports, and age, and SHALL offer start, stop, restart, view logs, and remove. Remove SHALL require confirmation.

The list SHALL say that workloads are attributed by the bot's engine proxy and that the bot can control the shared engine. Resources created outside its proxy SHALL not be attributed automatically.

#### Scenario: Bot starts a database

- **WHEN** a bot that shares the engine socket runs `docker run -d postgres`
- **THEN** that container appears in the bot's Containers tab

#### Scenario: Shared engine control

- **WHEN** a user opens Containers
- **THEN** the tab lists that bot's attributed workloads while stating that engine access is shared

#### Scenario: Internal helpers share the bot label

- **WHEN** Terminay creates a Files helper or temporary probe carrying the bot's label
- **THEN** it does not appear in Containers and cannot be targeted through that tab's actions

### Requirement: Bot sign-in choice

Each bot SHALL have a **Sign-in** setting in its Profile. It SHALL offer, from what the bot's agent declares:

- one option for each declared credential secret, such as a sign-in token or an API key, whose value the user enters for that bot;
- the agent's device sign-in, such as **Sign in with ChatGPT**, when the agent declares one.

A bot SHALL sign in only with its own credential. Terminay SHALL NOT read, detect, mount, or copy any login of the server account. A new bot SHALL be **Not signed in** until the user chooses a sign-in. While a bot is not signed in:

- its Profile and its agent status SHALL say Not signed in;
- sending it a message, or a trigger firing for it, SHALL be refused with `unavailable` and a message that names Configure › Profile › Sign-in;
- no session SHALL be created and no agent SHALL start.

A change of sign-in SHALL apply to sessions that start after it. A session SHALL record its sign-in. Each user message SHALL start a fresh execution using the current sign-in; earlier execution diagnostics SHALL retain their original sign-in metadata.

#### Scenario: New bot is not signed in

- **WHEN** a user creates a bot and sends it a message before choosing a sign-in
- **THEN** the message is refused with a reason that names Configure › Profile › Sign-in, and no session is created

#### Scenario: Claude Code options

- **WHEN** a user opens Sign-in for a Claude Code bot on any platform
- **THEN** it offers Sign in with Claude through its own sign-in terminal, a sign-in token from `claude setup-token`, and an API key

#### Scenario: Server account already signed in

- **WHEN** the server account is signed in to Codex and a user creates a Codex bot
- **THEN** the bot is Not signed in, and Terminay has not read the server account's `~/.codex`

### Requirement: Device sign-in runs in the bot's own container

When the user chooses an agent's device sign-in, the server SHALL start the bot's container if it is stopped, and SHALL run the declared sign-in command in it as `bot`, with `HOME=/home/bot` and in `/home/bot`. The command SHALL run in a terminal shown in the Sign-in section, so the user sees its browser URL and either approves its device code in their browser or pastes the browser-returned authorization code into the terminal.

- **Config.** Before running the command, and before each session while the bot's sign-in is `device`, the host SHALL write the device sign-in's own bot config files in place of the agent's files of the same path.
- **The login stays in the bot.** The login the command saves SHALL stay in the bot's home volume. Terminay SHALL NEVER read, copy, or display it, and SHALL NOT pass it to any other bot.
- **Outcome.** When the command exits successfully, the bot's sign-in SHALL become `device`. When it fails, or the user closes the terminal first, the bot's sign-in SHALL be unchanged.
- **Sign out.** Signing out SHALL run the declared sign-out command in the bot's container as `bot`, and SHALL set the bot to Not signed in only after successful sign-out.
- **Deletion.** Deleting a bot with its home SHALL remove its login. Choosing another sign-in SHALL leave the saved login in the home until the user signs out.

#### Scenario: Codex signs in with ChatGPT

- **WHEN** a user chooses Sign in with ChatGPT for a Codex bot and approves the code in their browser
- **THEN** the bot's sign-in is `device`, its next session runs signed in, and the login is in that bot's home only

#### Scenario: Each bot signs in separately

- **WHEN** one Codex bot has signed in with ChatGPT and the user creates a second Codex bot
- **THEN** the second bot is Not signed in

#### Scenario: Sign-in abandoned

- **WHEN** the user closes the sign-in terminal before approving the code
- **THEN** the bot's sign-in is unchanged

#### Scenario: Sign out

- **WHEN** the user signs a Codex bot out
- **THEN** `codex logout` runs in that bot's container, and the bot is Not signed in

### Requirement: Tokens are kept in the vault and injected without arguments

A token SHALL be entered in a bot's Profile, and SHALL be kept in the server vault for that bot. Terminay SHALL pass a token only into the environment of the agent processes it starts for that bot. The server SHALL supply the value in the execution environment through the pinned local engine’s socket API; it SHALL NOT interpolate the value into a command or process argument.

Terminay SHALL NEVER put the value in process arguments, the container's configuration, the image, the volume, logs, diagnostics, or errors. It SHALL launch each agent with the declared bot config files and launch environment that keep the agent itself from writing the token to the bot's home or passing it to tool shells. The image SHALL provide `terminay-tool-shell`, which runs a command without the variables named in `TERMINAY_CREDENTIAL_VARIABLES`, and Terminay SHALL set that variable, for each agent it starts, to the names of the agent's declared credential variables, never their values. Copying a token to another bot SHALL be an explicit user action.

The agent and anything it runs act as the same user, so they can read the token from the agent's own process. Profile and Settings SHALL say so where a token is entered.

#### Scenario: Claude Code with a sign-in token

- **WHEN** a Claude Code bot whose Sign-in is a sign-in token starts a session
- **THEN** the agent is signed in, and neither the host's process listing nor inspection of the container or the exec shows the token

#### Scenario: API key

- **WHEN** a user sets a Claude Code bot's Sign-in to API key and enters a key
- **THEN** its sessions use that key, and no other bot can use it

### Requirement: Desktop

Environment › Desktop SHALL show the bot's desktop live, in either view-only or control mode. It SHALL open in view-only mode. The user SHALL be able to switch modes, open the desktop in its own window, and reconnect.

- **Authentication.** The desktop's VNC service SHALL require a password. The server SHALL hold the password in its vault and SHALL deliver it at start through a root-only bootstrap. The desktop SHALL NOT start until the bootstrap completes, and a container that receives no bootstrap SHALL exit. The `bot` user SHALL NOT be able to read the password.
- **Transport.** The VNC service SHALL listen only on the container's own loopback. The server SHALL reach it through an engine `exec` stream into the container, and SHALL relay the desktop to the client through the Terminay connection, so no port is published and remote clients need no other port.
- **Stream binding.** Each desktop stream SHALL be bound to the authorized client connection, the bot, the mode, and a stream generation. Changing the mode SHALL open a new stream.
- **Allowlist.** The server SHALL forward only a bounded allowlist of client messages, and SHALL close the stream on any unknown or oversized message.
- **View-only enforcement.** In view-only mode, the server SHALL discard every keyboard, pointer, and clipboard message.
- **Thumbnail.** The context rail's thumbnail SHALL be a view-only relay of the same desktop, shown only while the container runs. Activating it SHALL open Desktop.
- **Idle stop.** Viewing the desktop SHALL count as activity for idle stop.

#### Scenario: Remote client

- **WHEN** a paired remote browser client opens a bot's Desktop
- **THEN** the desktop is shown through the Terminay connection and no container port is reachable from that device

#### Scenario: Forged input in view-only mode

- **WHEN** a client in view-only mode sends a pointer event over the desktop stream
- **THEN** the server discards it and the bot's desktop receives no input

#### Scenario: Malformed traffic

- **WHEN** a client sends an unknown RFB message type, or a `ClientCutText` longer than 1 MiB
- **THEN** the server closes that desktop stream and the bot's desktop receives nothing

#### Scenario: No bootstrap

- **WHEN** a bot's container starts but the server never delivers the bootstrap
- **THEN** the container exits and no desktop service listens

#### Scenario: No direct connection

- **WHEN** a process on the server machine, or in another bot, tries to connect to a bot's desktop
- **THEN** there is no published port to connect to, and inside the bot's own container the VNC service still requires the password
