# bot-environment Specification

## Purpose

Define each bot’s local container environment, resource lifecycle, files, shell, engine access, and credentials.

## Requirements

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

The image SHALL carry a fingerprint of its inputs: the browser seccomp profile, the Dockerfile, its `.dockerignore`, the build-context files its COPY and ADD instructions read (contents and executable bit), the agent installs, and the `bot` user and group ids. Other files beside the Dockerfile SHALL NOT change the fingerprint. A COPY or ADD source the server cannot resolve to literal context paths SHALL fail the image plan rather than be left out of the fingerprint. Build progress and the build log SHALL be shown. A failed build SHALL keep the previous image and SHALL show the step that failed.

#### Scenario: First start

- **WHEN** a user starts the first bot on a machine that has no bot image
- **THEN** the image is built from the shipped Dockerfile with progress shown, and then the bot's container starts

#### Scenario: New agent installed

- **WHEN** an extension that contributes a bot agent is installed
- **THEN** the image is shown as out of date, and that agent is shown as not installed in the bot image until a rebuild completes

#### Scenario: Build fails

- **WHEN** an image rebuild fails while installing a bot agent's native CLI
- **THEN** the previous image is kept and the build log shows the failing step

#### Scenario: Files the image is not built from

- **WHEN** a file beside the Dockerfile that no COPY or ADD instruction reads changes
- **THEN** the image fingerprint is unchanged and no container becomes out of date

#### Scenario: Unreadable copy source

- **WHEN** the Dockerfile copies a glob, an absolute path, a path outside the context, or uses the JSON or heredoc form
- **THEN** the image plan fails and no image is built from it

### Requirement: Containers follow the current image

A bot's container is out of date when it was made from a different image fingerprint, or under a different AppArmor choice, than the server would give a new container now. When the current fingerprint or AppArmor choice cannot be determined, the container SHALL NOT be treated as out of date.

An out-of-date container SHALL be updated as follows:

- if it is stopped, it SHALL be recreated from the current image when it next starts, including by Restart;
- if it is running and a run is about to start while that run is the bot's only running session and no shell or desktop is open (the desktop preview beside Chat does not count), the current image SHALL first be built if needed, and the container SHALL then be recreated from it before the run, without stopping that run and without asking for confirmation;
- if that build fails, the bot SHALL keep its running container, the run SHALL proceed on it, and the failure SHALL be shown on the image;
- otherwise it SHALL keep running, and its Environment › Overview SHALL show that an update is ready and installs before its next run, with **Update now**, which recreates the container when the user chooses to.

Recreating a container SHALL create it with the bot's current resource limits, so a pending limits change is applied by any recreation. The update notice SHALL be derived from the bot's own container, never from whether the shared image is out of date. An image that is only out of date SHALL NOT be presented as a container engine problem. The engine status SHALL be shown above a bot's Chat and Configure panels only when the engine is unavailable or the image is missing or failed to build.

When the user chooses Recreate or Update now for a running bot whose session is running, Terminay SHALL first ask the user to confirm, and SHALL then stop that session. Recreating SHALL succeed when one of the bot's containers is already being removed by the engine, and SHALL fail without creating a new container when an old one cannot be removed.

#### Scenario: Rebuilt while stopped

- **WHEN** the image is rebuilt while a bot is stopped and the bot then starts
- **THEN** its container is recreated from the new image and its home is unchanged

#### Scenario: Rebuilt while running and idle

- **WHEN** the image is rebuilt while a bot is running with no shell or desktop open, and a run then starts
- **THEN** its container is recreated from the new image before the run, its home is unchanged, and the run proceeds without being stopped or asking for confirmation

#### Scenario: Rebuilt while running

- **WHEN** the image is rebuilt while a bot is running with its shell or desktop open, or with another run in progress
- **THEN** the bot keeps running on its old container, its Overview shows that an update is ready with Update now, and no container engine card is shown

#### Scenario: Chat open with its desktop preview

- **WHEN** a user sends a message from a bot's Chat, whose context rail shows the desktop preview, while the bot's running container is out of date and no shell or desktop is open
- **THEN** the container is recreated from the current image before the run, and the preview reconnects to the new container

#### Scenario: Update build fails

- **WHEN** an idle running bot's container is out of date, a run starts, and the image build fails
- **THEN** the run proceeds on the old container, the bot is not marked failed, and the image shows its build failure

#### Scenario: Another bot already rebuilt the image

- **WHEN** one bot's start has rebuilt the shared image and a second bot is still running on a container from the old image
- **THEN** the second bot's Overview still shows that an update is ready

#### Scenario: AppArmor choice changed

- **WHEN** the server's AppArmor choice for new containers changes while a bot runs on a container made under the old choice
- **THEN** the bot's container is out of date and is updated as above

#### Scenario: Restart applies an update

- **WHEN** a user restarts a running bot whose container is out of date
- **THEN** the container is stopped, recreated from the current image, and started, with its home unchanged

#### Scenario: Pending limits applied by an update

- **WHEN** a bot has a pending limits change and its container is recreated by an update
- **THEN** the new container runs with the new limits and the pending-limits notice disappears

#### Scenario: Recreate while Files is open

- **WHEN** a user recreates a bot while its Files tab is open
- **THEN** the Files helper is closed, the container is recreated from the current image, and no conflict is reported

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
- **Reconciliation.** The server SHALL reconcile each bot's recorded state with the engine at startup and whenever the engine reports a container event. Startup reconciliation SHALL NOT delay the server becoming ready. Bot triggers SHALL start only after it finishes, and a session requested before it finishes SHALL wait for it.
- **Naming the start action.** While the environment is not created, Overview SHALL name its start action **Create environment** and SHALL also offer it in the Actions menu. After a failure it SHALL name the action **Try again**.
- **Unavailable actions.** An Overview action that cannot run in the current state SHALL say why beside its name.
- **Leftover name.** When the engine refuses the bot's container name, lists no container with it, and identifies storage that a removed container left behind under exactly that name, creation SHALL remove that storage by its own identifier and create the container once more. Nothing SHALL be removed by name, a name held by a listed container SHALL NOT be cleared, and a second refusal SHALL fail the start.

#### Scenario: Idle stop

- **WHEN** a bot has had no running or queued session, open shell, or viewed desktop for its idle period
- **THEN** its container is stopped and its card shows stopped

#### Scenario: Removed outside Terminay

- **WHEN** a user removes a bot's container with `docker rm -f` while Terminay is running
- **THEN** the bot is shown as not created, and its next session creates the container again

#### Scenario: Engine slow to answer at startup

- **WHEN** the container engine takes a minute to answer while Terminay Server starts
- **THEN** the server becomes ready and opens projects and terminals without waiting for it, and the bots reconcile once the engine answers

#### Scenario: Name held by leftover storage

- **WHEN** a bot is not created and the engine refuses its container name without listing a container that has it, while holding leftover storage under that name
- **THEN** that storage is removed by its identifier, the container is created, and the bot reaches running

#### Scenario: Name refused with no leftover storage

- **WHEN** the engine refuses the bot's container name and identifies no leftover storage under it
- **THEN** nothing is removed, the start fails, and the bot reports a conflict with an existing container

#### Scenario: Overview for a bot with no container

- **WHEN** a user opens Environment › Overview for a bot that is not created
- **THEN** the primary action reads Create environment, the Actions menu offers Create environment, and Restart and Recreate each say why they cannot run

### Requirement: Environment overview

Environment › Overview SHALL show:

- the bot's environment state and uptime;
- the image, and whether the container is current;
- the home volume;
- the resource limits;
- the shared engine proxy and its attribution rules;
- the lifecycle actions.

It SHALL show CPU use, memory use, and home size as read when the Overview opened, with a **Refresh** action. It SHALL NOT sample them on a timer. It SHALL show the container's recent log, capped at its last 256 KiB, with injected secrets redacted.

The Overview SHALL render from the container's state without waiting for CPU, memory, home size, the log, or an engine security probe. Until those figures are read, it SHALL show them as being read. A figure that could not be read SHALL be shown as unavailable, never as zero. Lifecycle changes SHALL re-read state only.

#### Scenario: Refresh usage

- **WHEN** a user chooses Refresh on a running bot's Overview
- **THEN** CPU, memory, and home size are read again and shown with the time they were read

#### Scenario: Overview renders before usage

- **WHEN** a user opens a bot's Overview and measuring its home takes several seconds
- **THEN** the state, image, limits, and lifecycle actions are shown at once, and home size shows as being read until it arrives

#### Scenario: Usage cannot be read

- **WHEN** the Overview's state is shown and reading usage then fails
- **THEN** the state stays shown, the figures show as unavailable rather than being read, the failure is shown, and Refresh reads them again

#### Scenario: Lifecycle change does not measure

- **WHEN** a user starts or stops a bot from its Overview
- **THEN** the Overview shows the new state without reading CPU, memory, home size, or the log

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

Each entry's actions SHALL be offered in the app's context menu, with the same look as Terminay's other context menus. The menu SHALL open from a "More actions" button at the end of the entry's row, from right-clicking the row, and from the keyboard's context-menu key or Shift+F10 on the row. It SHALL list, as they apply to the entry: Open for a folder, Preview for a file, Download for a file or folder, Rename, and Delete in the danger style. A link or other special entry SHALL offer only Rename and Delete, and the parent-folder row SHALL offer no menu. Delete SHALL ask for confirmation before deleting. A credential link SHALL show as locked and offer no actions by any of these means. The menu SHALL be usable from the keyboard: opening it from the keyboard focuses its first item, the arrow keys move between enabled items, the focused item is visibly marked, and Escape closes it and returns focus to the row's button. An open menu or delete confirmation SHALL close when its entry leaves the listing or the user changes folder.

#### Scenario: Upload while stopped

- **WHEN** a user uploads a file to a stopped bot's home
- **THEN** the file is in the bot's home, owned by `bot`, and the container is still stopped

#### Scenario: Link outside home

- **WHEN** a user opens a symbolic link in the bot's home that points to `/etc`
- **THEN** the request is refused and nothing outside the home is shown

#### Scenario: Agent home

- **WHEN** a user tries to delete `.codex` in a Codex bot's home
- **THEN** the request is refused and `.codex` is unchanged

#### Scenario: Row actions in a context menu

- **WHEN** a user chooses the "More actions" button on a file's row
- **THEN** the app's context menu opens with Preview, Download, Rename, and Delete, and the row shows no other action buttons

#### Scenario: Right-click a row

- **WHEN** a user right-clicks a folder's row
- **THEN** the same context menu opens at the pointer with Open, Download, Rename, and Delete

#### Scenario: Delete asks first

- **WHEN** a user chooses Delete from a file's menu and then Cancel
- **THEN** the file is still in the bot's home

#### Scenario: Keyboard

- **WHEN** a user focuses a row's "More actions" button, presses Enter, presses Down, and then Escape
- **THEN** the menu opens with its first item focused, focus moves to the second item, and the menu closes with focus back on the button

#### Scenario: Context-menu key

- **WHEN** a user focuses a file's row and presses Shift+F10
- **THEN** the context menu opens at the row with Preview focused

#### Scenario: Credential link

- **WHEN** a user right-clicks, or presses Shift+F10 on, a credential link's row
- **THEN** no menu opens, and the row shows it as locked with no "More actions" button

#### Scenario: Entry removed while its menu is open

- **WHEN** a file is deleted from the bot's home while its row's menu is open
- **THEN** the menu closes and the file's row is gone

### Requirement: Shell

Environment › Shell SHALL open an interactive terminal in the bot's container, as the `bot` user, in `/home/bot`, while the container runs. Opening it SHALL NOT start the container, and the server SHALL refuse a shell while the container is not running. The terminal SHALL render, resize, copy, and paste like a Terminay terminal. It SHALL count as activity for idle stop. Closing it SHALL end the shell process.

#### Scenario: Open a shell

- **WHEN** a user opens Shell on a running bot and types `whoami`
- **THEN** the terminal prints `bot`

#### Scenario: Shell on a stopped bot

- **WHEN** a user opens Shell on a stopped bot
- **THEN** the container stays stopped and no shell is opened

#### Scenario: Machine stops before the shell opens

- **WHEN** a client asks to open a shell just as the bot's container stops
- **THEN** the server refuses it as the machine not being started, and does not start the container

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
- **Login check.** An agent's device sign-in MAY declare a status command that reports, offline, whether a login is in the bot's home. Before each session while the bot's sign-in is `device`, the server SHALL run it in the bot's container as `bot`, with `HOME=/home/bot`, and SHALL receive only its exit status. When it exits non-zero, the bot SHALL become Not signed in, and the session SHALL be refused with a reason that names Configure › Profile › Sign-in before the agent starts. When the check cannot run, the bot's sign-in SHALL be unchanged.
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

#### Scenario: Device login removed from the home

- **WHEN** a Codex bot signed in with ChatGPT has its home volume removed, and the user sends it a message
- **THEN** the message is refused with a reason that names Configure › Profile › Sign-in, Codex is not started, and the bot is Not signed in

#### Scenario: Recreate keeps the device login

- **WHEN** a user recreates the container of a Codex bot signed in with ChatGPT
- **THEN** its home volume is kept, and its next session runs signed in

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
- **Allowlist.** The server SHALL forward only a bounded allowlist of client messages, and SHALL close the stream on any unknown or oversized message. `ClientCutText` SHALL be admitted in its Latin-1 form and in its extended form. The payload of either form SHALL be at most 1 MiB, and an extended payload SHALL be at least its 4-byte flags.
- **View-only enforcement.** In view-only mode, the server SHALL discard every keyboard, pointer, and clipboard message.
- **Clipboard.** A Desktop host SHALL keep its clipboard text synchronized with the selected connected, visible control-mode desktop, independently of paste shortcuts:
  - **Host to bot.** Starting sharing SHALL copy the host's current eligible text into the bot clipboard. Subsequent host copies SHALL update the bot clipboard, including copies made while another host application is focused. Synchronizing SHALL NOT press a paste key or insert text into an application.
  - **Bot to host.** A bot clipboard change during the sharing session SHALL update the host clipboard, including while the Desktop window lacks focus. Highlighting PRIMARY alone SHALL NOT update the host clipboard.
  - **Paste.** The bot's own context-menu Paste, Ctrl+V, Ctrl+Shift+V, and Shift+Insert SHALL use the synchronized clipboard, subject to the target application's bindings. On macOS, Cmd+V and Cmd+Shift+V SHALL also paste through the matching Linux chords. The complete chord SHALL be pressed regardless of host modifier release timing.
  - **Ownership.** A host SHALL share with at most one bot desktop at a time: the most recently selected control desktop. Selecting another control desktop SHALL retire the prior session. Closing, disconnecting, hiding that desktop behind another view, or choosing view-only SHALL retire its sharing session. Merely switching focus to another host application SHALL NOT retire it. Sharing SHALL NOT fan clipboard text out to other bots or windows.
  - **Ordering.** Changes SHALL be applied in observation order. Starting a sharing session SHALL use the host as the initial source; afterward the latest observed eligible change SHALL win. An echoed change SHALL NOT cause repeated clipboard writes. No result from a retired sharing session SHALL update either clipboard.
  - **Limits.** Sharing SHALL transfer non-empty text only, at most 1 MiB of UTF-8 with host-to-bot line endings counted as CRLF and the terminating NUL counted. Bot-to-host text SHALL contain no control characters other than tab, LF, or CR. Copied files and images SHALL NOT be transferred. Too-large host text SHALL produce the desktop bar's paste-too-large notice. Clipboard contents SHALL NOT be persisted or logged.
  - **Selections.** The server SHALL isolate PRIMARY on the running bot before admitting a control stream, including on an existing container.
  - **Unicode.** Text SHALL retain characters outside Latin-1 when both endpoints support ExtendedClipboard.
  - **View-only.** View-only streams, including thumbnails, SHALL neither read nor write either clipboard.
  - **Browser hosts.** Where the host cannot provide clipboard synchronization, the focused control desktop SHALL accept the text of native paste events, keep the shortcut away from noVNC, and press the complete matching Linux chord. Unavailable continuous synchronization SHALL be presented honestly, without requesting ambient browser clipboard permission.
- **Thumbnail.** The context rail's thumbnail SHALL be a view-only relay of the same desktop, shown only while the container runs. Activating it SHALL open Desktop.
- **Idle stop.** Viewing the desktop SHALL count as activity for idle stop.

#### Scenario: Remote client

- **WHEN** a paired remote browser client opens a bot's Desktop
- **THEN** the desktop is shown through the Terminay connection and no container port is reachable from that device

#### Scenario: Forged input in view-only mode

- **WHEN** a client in view-only mode sends a pointer event over the desktop stream
- **THEN** the server discards it and the bot's desktop receives no input

#### Scenario: Malformed traffic

- **WHEN** a client sends an unknown RFB message type, or a `ClientCutText` whose payload is longer than 1 MiB in either form
- **THEN** the server closes that desktop stream and the bot's desktop receives nothing

#### Scenario: No bootstrap

- **WHEN** a bot's container starts but the server never delivers the bootstrap
- **THEN** the container exits and no desktop service listens

#### Scenario: No direct connection

- **WHEN** a process on the server machine, or in another bot, tries to connect to a bot's desktop
- **THEN** there is no published port to connect to, and inside the bot's own container the VNC service still requires the password

#### Scenario: Host copy supports context-menu paste

- **WHEN** sharing is active and a user copies `i have copied this from my mac` in another Mac application, then right-clicks the bot browser's address bar
- **THEN** Paste is available and choosing it inserts that text exactly once, without first pressing Cmd+V

#### Scenario: Start sharing

- **WHEN** a user enters control mode with eligible text already in the host clipboard
- **THEN** the bot clipboard receives that text without inserting it into any application

#### Scenario: Linux paste shortcut on a Mac host

- **WHEN** a Mac user copies text while sharing is active, then presses Ctrl+V in the bot's browser address bar
- **THEN** the browser pastes the synchronized text exactly once

#### Scenario: Copy from the bot

- **WHEN** a bot application copies `café ✓` while sharing is active
- **THEN** the host clipboard holds that text, and its echo causes no further writes

#### Scenario: Bot copies while the user is elsewhere

- **WHEN** the Desktop window loses focus to another Mac application while its selected control desktop remains open and visible
- **THEN** clipboard text continues to synchronize in both directions

#### Scenario: Another desktop is selected

- **WHEN** a user selects a different bot's control desktop, including in another window
- **THEN** the old sharing session retires, the new desktop receives the current host text, and subsequent clipboard changes reach only the new desktop

#### Scenario: Sharing ends

- **WHEN** the desktop closes, disconnects, is hidden by another view, or changes to view-only
- **THEN** clipboard observation and forwarding stop, and pending results from the retired session have no effect

#### Scenario: Simultaneous changes

- **WHEN** host and bot text changes are observed while a previous update is still awaiting completion
- **THEN** writes are serialized in observation order and the latest observed eligible change wins without an echo loop

#### Scenario: Paste on macOS

- **WHEN** a user presses Cmd+Shift+V and releases Shift before the clipboard read completes
- **THEN** the bot still receives the complete Ctrl+Shift+V chord without Alt or Super

#### Scenario: Paste with text selected elsewhere

- **WHEN** a browser host without continuous synchronization raises a native paste event on the focused control desktop, including with a stale selection elsewhere in Terminay
- **THEN** its text reaches the bot and is pasted once, and keyboard focus returns to the desktop

#### Scenario: Paste with nothing to paste

- **WHEN** the clipboard contains no eligible text or only files or images
- **THEN** no clipboard text or paste key is sent

#### Scenario: Selection alone

- **WHEN** a user highlights text in the bot without copying it
- **THEN** the host clipboard remains unchanged

#### Scenario: Control characters from the bot

- **WHEN** bot clipboard text contains an escape character
- **THEN** the host clipboard remains unchanged

#### Scenario: View-only clipboard

- **WHEN** a desktop is view-only or a thumbnail
- **THEN** it neither reads nor writes either clipboard

#### Scenario: Paste into the bot

- **WHEN** a user copies text on the host during sharing and invokes Paste in a bot text field
- **THEN** the copied text is inserted exactly once

#### Scenario: Paste in Desktop

- **WHEN** a Desktop user presses Cmd+V on macOS or the host paste shortcut on the focused control desktop
- **THEN** the current host text is published and pasted once through a complete matching Linux chord

#### Scenario: Paste too large

- **WHEN** host text exceeds the sharing size limit
- **THEN** it is not sent and the desktop bar reports that it is too large

### Requirement: Build progress notice

While a bot image build is running, or after one has ended, the Bots surfaces SHALL show a compact notice naming its state. Activating the notice SHALL open the build's progress as a sheet over the workspace, closable by its close control, by Escape, or by clicking outside it, and SHALL keep the rest of the workspace in place.

The notice for a completed build SHALL carry a dismiss control. Once a completed build's notice has been on screen, leaving that surface SHALL retire it, so that coming back does not show it again. A dismissed or retired notice SHALL return only for a different build or a different build state. A failed or interrupted build's notice SHALL NOT be dismissible.

#### Scenario: Dismissing a ready image

- **WHEN** the notice reads "Bot image ready" and the user activates its dismiss control
- **THEN** the notice is removed and does not return after a reload

#### Scenario: Seen and left

- **WHEN** the "Bot image ready" notice has been shown and the user moves to another section and back
- **THEN** the notice is no longer shown

#### Scenario: A failure stays

- **WHEN** an image build has failed
- **THEN** its notice offers no dismiss control and still opens the progress sheet with Retry build

### Requirement: Files downloads

Download SHALL be offered for every file and folder in Environment › Files that is not a credential link, including dotfiles, empty files, and names with any characters the home allows. A file SHALL be saved under its own name and a folder as a `<name>.tar` archive; a name the local filesystem cannot take SHALL be suggested in a safe form. In Desktop, the save SHALL go through the host save of connections-and-client-hosts: the user chooses the destination before any bytes are transferred, and the bytes stream from the Files helper. In a browser, the download SHALL use the browser's own download flow. A download that fails SHALL show its error in the view and SHALL never fail silently. Cancelling the save dialog SHALL show no error.

#### Scenario: Download a file in Desktop

- **WHEN** a user chooses Download on `notes.txt` in Desktop and picks a destination in the save dialog
- **THEN** a file with the same bytes as `notes.txt` is saved at that destination

#### Scenario: Download a folder in Desktop

- **WHEN** a user chooses Download on the folder `project` in Desktop and picks a destination
- **THEN** a `project.tar` archive of that folder is saved at that destination

#### Scenario: Download a dotfile

- **WHEN** a user chooses Download on `.env`
- **THEN** the save dialog suggests `.env` and the saved file has its bytes

#### Scenario: Cancel the save dialog

- **WHEN** a user chooses Download in Desktop and cancels the save dialog
- **THEN** nothing is read from the bot's home, nothing is written, and no error is shown

#### Scenario: Download fails part way

- **WHEN** a download's transfer fails after the user picked a destination
- **THEN** the view shows the error, no new file is left at or beside the destination, and a file the user chose to replace keeps its original contents

#### Scenario: Download in a browser

- **WHEN** a user chooses Download on a file or folder in a browser
- **THEN** the browser's own download flow receives the file, or `<name>.tar` for a folder

### Requirement: A token is copied only from a bot that has it saved

For each token option, **Copy from another bot** SHALL list only other bots that run the same agent and have that token saved in the server vault. When no such bot exists, the copy control SHALL NOT be shown. Determining the list SHALL NOT resolve a secret value. A copy whose source has no saved token SHALL be refused with a message that says so and SHALL leave the destination unchanged.

#### Scenario: A bot using device sign-in is not offered

- **WHEN** the only other bot of the same agent uses a device sign-in and has no saved token
- **THEN** the token option shows no copy control

#### Scenario: A bot with the token is offered

- **WHEN** another bot of the same agent has the token saved
- **THEN** the token's copy list includes that bot, and copying saves the value for this bot

#### Scenario: The source lost its token

- **WHEN** a copy is requested from a bot that no longer has the token saved
- **THEN** the server refuses it with a message naming the missing token, and the destination is unchanged

### Requirement: Machine not running

While a bot's container is not running, Environment › Shell and Environment › Desktop SHALL show the machine's state instead of the view, with one action that brings it up. A stopped or not-created machine SHALL NOT be shown as an error; a failure to start SHALL be shown with its cause. The view SHALL open whenever the container runs, whatever started it.

#### Scenario: Desktop on a stopped bot

- **WHEN** a user opens Desktop on a stopped bot
- **THEN** it shows "Machine not started." with **Start machine**, shows no error, and opens no desktop stream

#### Scenario: Start from the panel

- **WHEN** a user chooses **Start machine** in Shell on a stopped bot
- **THEN** the container starts, and the shell opens once it runs

#### Scenario: Bot not created

- **WHEN** a user opens Shell on a bot whose container has never been created
- **THEN** it shows that the machine is not created, with **Create machine**

#### Scenario: Machine failed

- **WHEN** a user opens Desktop on a bot whose container failed
- **THEN** it shows that the machine failed to start, with **Try again**

#### Scenario: Machine starting

- **WHEN** a user opens Shell while the bot's container is starting
- **THEN** it shows that the machine is starting, with no available action, and opens the shell once it runs

#### Scenario: Start fails

- **WHEN** a user chooses **Start machine** and the start is refused
- **THEN** the panel shows the refusal's cause

#### Scenario: Machine stops while a view is open

- **WHEN** a bot's container stops while its Desktop is open
- **THEN** the desktop gives way to "Machine not started." with **Start machine**
