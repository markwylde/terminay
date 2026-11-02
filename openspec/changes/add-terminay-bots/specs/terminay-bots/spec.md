## ADDED Requirements

### Requirement: Bots are server-owned and workspace-wide

A bot SHALL be a named, long-lived agent owned by one Terminay Server. It SHALL have its own container environment, memories, triggers, and session history. A bot SHALL NEVER belong to a project. Opening, closing, renaming, or removing a project SHALL NOT create, change, or remove a bot. Bot records SHALL be stored with revisioned, server-owned persistence and SHALL survive server restarts. They SHALL NEVER be written to device storage or to hosted services. Every authorized client attached to the server SHALL see the same bots.

#### Scenario: Server restart

- **WHEN** the server restarts
- **THEN** every bot, with its profile, triggers, and session history, is restored

#### Scenario: Project closed

- **WHEN** every project in the workspace is closed
- **THEN** every bot is unchanged and its triggers still fire

#### Scenario: Two devices

- **WHEN** one device renames a bot
- **THEN** every other authorized device shows the new name without reloading

### Requirement: Bot profile

A bot SHALL have:

- a name, unique on its server, of at most 40 characters;
- an avatar, which is an emoji or a single character, and a colour;
- a description of at most 200 characters;
- instructions of at most 32 KiB of UTF-8;
- one agent and one model;
- a sign-in (see bot-environment);
- an approval mode.

The agent SHALL be chosen only from the bot agents that installed extensions contribute. The model SHALL be chosen only from the models that agent lists, or **Default**, which leaves the choice to the agent. Terminay SHALL NOT keep a provider or model list of its own.

The agent picker SHALL group agents by the extension that contributes them. It SHALL show each agent's status — ready, not signed in, not installed in the bot image, or unavailable — and SHALL name the action that makes an agent ready.

Saving a profile SHALL apply to sessions that start after the save.

#### Scenario: Agents come from extensions

- **WHEN** the built-in agents extension and one third-party extension each contribute bot agents
- **THEN** the agent picker lists exactly those agents, grouped under each extension's name

#### Scenario: Models follow the agent

- **WHEN** a user changes a bot's agent from Claude Code to Codex
- **THEN** the model picker lists Default plus the models Codex reports, and the model resets to Default

#### Scenario: Agent not signed in

- **WHEN** a user opens the agent picker and Claude Code has no sign-in on the server
- **THEN** Claude Code is shown as not signed in, with the action that signs it in

#### Scenario: Extension removed

- **WHEN** the extension that contributes a bot's agent is disabled or uninstalled
- **THEN** the bot keeps its saved agent and model, shows the agent as unavailable, and starts no session until a ready agent is chosen

#### Scenario: Duplicate name

- **WHEN** a user saves a bot with the name of another bot on the same server
- **THEN** the save is refused, naming the conflict

### Requirement: Creating bots

Creating a bot SHALL require a name and an agent. The model SHALL default to Default, and the approval mode to Autonomous. Creating a bot SHALL create only its record. It SHALL NOT require a container engine, and SHALL NOT create any container, volume, or network. Those SHALL be created when the bot first starts.

#### Scenario: New bot

- **WHEN** a user creates a bot named Bird with the Codex agent
- **THEN** Bird appears on the Bots dashboard as not created, with model Default, and its tab opens

#### Scenario: Engine unavailable

- **WHEN** a user creates a bot while the container engine is not running
- **THEN** the bot is created and listed, and nothing is created in the engine

### Requirement: Deleting bots

Deleting a bot SHALL require confirmation. It SHALL end the bot's running session, as Stop does. It SHALL then remove the bot's container and network, triggers, and session history. The user SHALL choose whether to keep or delete the home volume, and the default SHALL be to keep it.

Deleting a bot SHALL NOT stop or remove any container that the bot started through the shared engine socket. The confirmation SHALL say how many such containers exist.

#### Scenario: Delete and keep home

- **WHEN** a user deletes a bot and keeps its home
- **THEN** the bot, its container, network, triggers, and session history are removed, and its home volume still exists

#### Scenario: Sibling containers survive

- **WHEN** a user deletes a bot that started two containers through the engine socket
- **THEN** the confirmation names two containers, and both are still running after the delete

### Requirement: Bots section

The Bots section of Home SHALL present every bot on the attached servers as a fleet dashboard. Each bot SHALL appear as a card showing:

- its avatar, name, description, agent, and model;
- its environment state;
- its activity: working, needs you, queued, idle, or stopped;
- its latest session;
- its next trigger.

The dashboard SHALL offer filters for all bots, working, needs you, and stopped. It SHALL show a summary of the container engine: which engine is in use (Docker or Podman), whether it is available, how many bot containers are running, and whether the image is built and current. A **Needs you** list SHALL show every session, from any bot, that waits on the user.

Activating a card SHALL open that bot's tab, or bring it to the front if it is already open. Activating a Needs you entry SHALL open that session in its bot's tab. The section SHALL offer to create a bot. Cards SHALL update live while the section is shown.

#### Scenario: Opening a bot

- **WHEN** a user activates the Bird card and no Bird tab is open
- **THEN** a Home tab titled Bird opens in front

#### Scenario: Bot tab already open

- **WHEN** a user activates the Bird card while a Bird tab is open behind another tab
- **THEN** that tab comes to the front and no second Bird tab opens

#### Scenario: Live state

- **WHEN** a bot's session starts while the Bots section is shown
- **THEN** that bot's card shows working without the user leaving the section

#### Scenario: Needs you

- **WHEN** a bot's session waits on a permission decision
- **THEN** the session appears in the Needs you list, and activating it opens the bot's tab on that session

### Requirement: Bot tabs

A bot tab SHALL be a Home tab that belongs to the Bots section. Its title SHALL be the bot's name, shown with its avatar. It SHALL offer two modes:

- **Chat**: the bot's conversation, with a context rail. The rail shows a live view-only thumbnail of the bot's desktop, the bot's recent sessions, its upcoming trigger firings, and shortcuts to Files, Shell, and Desktop.
- **Configure**: the tabs Profile, Environment, Memories, Triggers, and Sessions.

The context rail SHALL be shown only in Chat mode. A bot tab SHALL keep its mode, its chosen configure tab, unsent text, and scroll position, as Home tabs keep their state. Renaming a bot SHALL retitle its tab. Deleting a bot SHALL close its tab on every device.

#### Scenario: Switching modes

- **WHEN** a user switches a bot tab from Chat to Configure
- **THEN** the configure tabs are shown with Profile in front, and the context rail is hidden

#### Scenario: Unsent message kept

- **WHEN** a user types a message into a bot's chat without sending it, opens another Home tab, and returns
- **THEN** the message is still in the composer as typed

#### Scenario: Bot deleted elsewhere

- **WHEN** a bot is deleted from another device while its tab is open
- **THEN** the tab closes and the device shows that the bot was deleted

### Requirement: Chatting with a bot

Each bot SHALL have one durable shared message log independent of executions. Every user post SHALL start a fresh provider execution, including when another execution is active. Only explicit bot-runtime chat posts SHALL appear as replies; provider output, thoughts, tools and plans SHALL remain execution diagnostics. The bot SHALL start its container on demand. The complete bounded communication and coordination contract is specified by `bot-message-log`.

#### Scenario: A correction arrives during work

- **WHEN** a user asks for BBC News and then corrects that request to BBC Sport while the first execution runs
- **THEN** the correction starts another execution with bounded recent messages and active execution summaries, and it can supersede the first execution before taking ownership of shared work

### Requirement: Bounded concurrent execution admission

The server SHALL admit four work executions and one reserved user-message coordination execution per bot, with at most twenty waiting executions. Each trigger SHALL have at most one pending firing. Shared shell and desktop work SHALL require exclusive bot-scoped ownership independently of admission. Instructions, pinned memories, agent, model, sign-in and approval mode SHALL be snapshotted per execution. Completed providers SHALL close rather than remaining idle for later messages.

#### Scenario: Coordination while work capacity is full

- **WHEN** four work executions run and a user posts a correction
- **THEN** a reserved coordination execution can inspect, message or replace older work without first acquiring shared desktop ownership

#### Scenario: Profile edited during work

- **WHEN** a user edits the bot's instructions during an execution
- **THEN** that execution retains its snapshot and subsequent executions use the revised profile

### Requirement: Stopping a turn and closing an agent

**Stop** SHALL ask the agent to cancel the running turn. It SHALL then end the session's process group, so that no command the turn started keeps running: once the agent acknowledges the cancel, or after 10 seconds if it does not, first with a termination signal and then, 5 seconds later, with a kill signal. The turn SHALL be marked stopped, and the agent closed.

Stop SHALL revoke the execution capability, close the execution and retain its diagnostics. The next user message SHALL start a fresh execution.

An agent SHALL be closed whenever its session ends, is suspended, or times out, and whenever its bot stops. Closing SHALL first close the agent's input, then end its process group after 5 seconds. An agent SHALL count as closed only once its process group is confirmed gone.

Each session SHALL run under a root supervisor that leads its process group for the whole session. That supervisor SHALL hold a root-only record of the group, the leader's start time, and a random session nonce, and SHALL retire the record once the group is empty. A signal SHALL be sent to a group only while its recorded leader is alive with a matching start time. Otherwise, it SHALL be sent only to processes that are in that group and carry the session's nonce, so that a reused group number never reaches unrelated work. The session view SHALL say that a process the agent moved into its own process group is not ended by Stop, but is ended by stopping the bot.

Each turn SHALL have a maximum duration, settable per bot and 30 minutes by default. A turn that exceeds it SHALL be stopped as above, and the session SHALL be marked timed out.

#### Scenario: Agent honours cancel, but its command keeps running

- **WHEN** a user chooses Stop while the agent runs `sleep 300`, and the agent acknowledges the cancel at once
- **THEN** the session's process group is ended, `sleep 300` no longer runs, the turn is marked stopped, and the user's next message starts a fresh execution

#### Scenario: Agent ignores cancel

- **WHEN** a user chooses Stop and the agent is still running after 10 seconds
- **THEN** the session's process group is ended, no process from that group remains, and the turn is marked stopped

#### Scenario: Agent crashes

- **WHEN** the agent process exits during a turn
- **THEN** the session is marked failed, the reason and runner output are kept, and the bot's card shows the failure

### Requirement: Sessions survive a server restart as records

When the server starts, it SHALL:

- end every session process group left in each running bot container;
- mark every session that was running, suspended, or waiting on the user as **interrupted**;
- cancel its pending permission requests;
- mark its queued messages as not sent;
- record pending trigger firings as skipped, with the reason that the server restarted.

Interrupted executions SHALL remain available as diagnostics. They SHALL NOT be resumed automatically or offer conversation continuation.

#### Scenario: Server crashes mid-turn

- **WHEN** the server stops during a bot's turn and starts again
- **THEN** no process remains in that session's process group, the session is shown as interrupted, and its transcript up to its last committed update is kept

### Requirement: Permission requests from a bot

Each bot SHALL have an approval mode, **Autonomous** or **Ask me**.

- **Autonomous.** Terminay SHALL answer each of the agent's permission requests with the most permissive single-use option the agent offers, because the agent acts only inside the bot's container.
- **Ask me.** Each request SHALL wait on the user. The session SHALL show as needing the user, both on the dashboard and in the bot's tab, with the agent's options.

A bot whose agent is Autonomous only SHALL always be Autonomous. Its Profile SHALL show the approval mode as fixed and say why: that agent cannot ask permission inside a container.

The first answer from any device SHALL decide a request. Later answers SHALL receive "already answered". A request that is still unanswered when its turn's maximum duration ends SHALL be answered with the agent's reject option.

#### Scenario: Agent that cannot ask

- **WHEN** a user edits the Profile of a Codex bot
- **THEN** the approval mode shows Autonomous, fixed, with the reason, and Ask me cannot be chosen

#### Scenario: Autonomous bot runs a command

- **WHEN** an Autonomous bot's agent asks permission to run a shell command
- **THEN** Terminay allows it once and the command runs inside the bot's container

#### Scenario: Ask me

- **WHEN** an Ask me bot's agent asks permission to edit a file
- **THEN** the bot's card shows needs you, and the execution details show the request with the agent's options until a user chooses one

#### Scenario: Two devices answer

- **WHEN** two devices answer the same permission request
- **THEN** the first answer is sent to the agent and the second device is told it was already answered

### Requirement: Sessions

Every user-message execution and every trigger run SHALL be a session of exactly one bot. A session SHALL record:

- its origin: chat, trigger (naming the trigger), or Run now;
- the agent and model it ran with;
- its start time, end time, and duration;
- its state: queued, running, suspended, needs you, completed, stopped, timed out, failed, or interrupted;
- its transcript of user messages, agent replies, tool activity, and plan updates.

The Sessions tab SHALL:

- list a bot's sessions, newest first;
- filter them by origin and by outcome, and search them by text;
- show a selected session's transcript and its runner output;
- offer Stop on a running session;
- offer a return to the shared message log without resuming the selected execution.

#### Scenario: Trigger run is a session

- **WHEN** a schedule trigger fires
- **THEN** a session with origin trigger, naming that trigger, appears in the bot's Sessions tab and recent sessions

#### Scenario: Reading an ended execution

- **WHEN** a user opens an ended execution
- **THEN** its diagnostics are shown independently of the shared chat, and sending another message creates a fresh execution

### Requirement: Session storage bounds and redaction

A session's transcript SHALL be stored as durably replaced files. Updates SHALL be committed at these points:

- the end of each turn;
- each permission request;
- each status change;
- every 256 updates;
- no later than 2 seconds after the first uncommitted update.

After a crash, the transcript SHALL end at its last committed update, and the session view SHALL say that later updates may be lost. A transcript file that the session's metadata does not count SHALL be set aside as corrupt, never deleted.

Storage SHALL be bounded:

- a session's transcript SHALL be capped at 8 MiB, after which further updates are recorded as truncated;
- runner output SHALL be capped at its last 256 KiB;
- a bot SHALL keep its newest 200 sessions or all sessions from the last 30 days, whichever is more.

**Redaction.** Before anything is stored or sent to a client, every exact occurrence of a token value that Terminay injected into the bot SHALL be replaced with `[redacted]`. That covers transcripts, runner output, container logs, and errors, and includes a value split across stream chunks. Token values SHALL be held in server memory only while a session that uses them, or a log view of that bot, is open.

Settings SHALL say what redaction cannot catch:

- a login that a device sign-in saved in the bot's home;
- a rotated token;
- a credential that the agent reads, transforms, or writes into its home.

#### Scenario: Agent prints its token

- **WHEN** a bot whose Sign-in is an API key runs `env` and the output arrives in two chunks that split the key
- **THEN** the stored and displayed transcript shows `[redacted]` where the key was

#### Scenario: Crash mid-turn

- **WHEN** the server stops during a turn
- **THEN** after restart the transcript ends at its last committed update and the session view says later updates may be lost

### Requirement: Memories

A bot's memories SHALL be the Markdown files in the `memories` directory of its home. The Memories tab SHALL list them, showing each memory's title, when it last changed, and whether it is pinned. It SHALL let the user search, read, create, edit, pin, unpin, and delete memories, whether the bot's container is running or stopped.

At the start of each session, Terminay SHALL give the agent a context block containing:

- the bot's instructions;
- where its memories are kept;
- its pinned memories, newest first, up to 16 KiB in total.

Terminay SHALL NOT write any agent instruction file. A memory the bot writes SHALL appear in the Memories tab without the user reloading.

#### Scenario: Bot writes a memory

- **WHEN** a bot's agent creates `memories/deploy-notes.md` during a session
- **THEN** the Memories tab lists Deploy notes

#### Scenario: Pinned memory reaches the agent

- **WHEN** a user pins a memory and then starts a new chat
- **THEN** that memory's text is part of the new session's context block

#### Scenario: Container stopped

- **WHEN** a user edits a memory while the bot's container is stopped
- **THEN** the edit is saved and the container is still stopped

### Requirement: Bot authority

Terminal-create authority on the owning server SHALL be required for every bot operation, read or write. That includes:

- listing bots and reading their records, sessions, transcripts, runner output, container and build logs, memories, and files;
- every subscription and stream;
- creating, editing, starting, stopping, chatting with, and deleting bots;
- using a bot's Shell, Files, and Desktop.

Further rules:

- **Invalidations only.** Bot subscriptions SHALL carry only invalidations, never content.
- **Capability-bound callers refused.** A caller bound by capability, such as an MCP token or a caller bound to a project or a session, SHALL be refused for every bot operation.
- **Revocation is immediate.** When a client loses authority, the server SHALL immediately close every bot subscription, shell, and desktop stream that client holds.
- **No inference.** The server SHALL revalidate authority on every request, and SHALL NEVER infer it from UI focus or renderer state.
- **No MCP route.** No MCP tool SHALL create, read, change, or prompt a bot.

#### Scenario: Client without terminal authority

- **WHEN** a client without authority to create terminals on a server asks to list its bots or subscribe to them
- **THEN** both requests are refused and no bot data is sent

#### Scenario: Authority revoked mid-stream

- **WHEN** a paired device's authority is revoked while it views a bot's desktop and shell
- **THEN** both streams close at once and no further frame or output reaches that device

#### Scenario: MCP caller

- **WHEN** a process presents an MCP capability to a bot operation
- **THEN** the request is refused
