# terminay-bots Specification

## Purpose

Define server-owned bots, their profiles, communication, execution lifecycle, memories, session records, and client authority.

## Requirements

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
- an approval mode;
- an **Investigate failures** setting, on unless the user turns it off (see bot-failure-follow-up);
- a **Terminay MCP access** setting, off unless the user turns it on;
- an **Inspect other bots** setting, off unless the user turns it on (see bot-inspection).

The agent SHALL be chosen only from the bot agents that installed extensions contribute. The model SHALL be chosen only from the models that agent lists, or **Default**, which leaves the choice to the agent. Terminay SHALL NOT keep a provider or model list of its own.

The agent picker SHALL group agents by the extension that contributes them. It SHALL show each agent's status — ready, not signed in, not installed in the bot image, or unavailable — and SHALL name the action that makes an agent ready.

The Profile SHALL say beside the Terminay MCP access switch that the bot can then see and control every project, terminal and app setting that Terminay MCP reaches, without asking. While Terminay MCP is disabled on the server, the switch SHALL stay editable and SHALL say that the access applies only once Terminay MCP is enabled.

The Profile SHALL say beside the Inspect other bots switch that the bot can then read the config, sessions, output, chats and triggers of every other bot on this server, including anything written in that content, and cannot change them.

Saving a profile SHALL apply to sessions that start after the save, except that turning Terminay MCP access off, or turning Inspect other bots on or off, SHALL also apply at once to sessions already running (see Bot authority and bot-inspection).

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

#### Scenario: Investigate failures defaults on

- **WHEN** a user creates a bot without touching Investigate failures, or opens a bot saved before the setting existed
- **THEN** the profile shows Investigate failures on

#### Scenario: Terminay MCP access defaults off

- **WHEN** a user creates a bot without touching Terminay MCP access, or opens a bot saved before the setting existed
- **THEN** the profile shows Terminay MCP access off, and the bot's sessions have no Terminay MCP tools

#### Scenario: Terminay MCP disabled on the server

- **WHEN** a user opens a bot's Profile while Enable Terminay MCP is off
- **THEN** the Terminay MCP access switch can still be changed, and says the access applies only once Terminay MCP is enabled

#### Scenario: Inspect other bots defaults off

- **WHEN** a user creates a bot without touching Inspect other bots, or opens a bot whose saved profile has no value for it
- **THEN** the profile shows Inspect other bots off, and the bot's inspection tools return forbidden

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
- **THEN** the correction starts another execution with bounded recent messages and active execution summaries, and its briefing states that one other execution is active, and it can stop, steer or supersede the first execution or leave it running

### Requirement: Bounded concurrent execution admission

The server SHALL admit four work executions and one reserved user-message coordination execution per bot, plus one check-in execution in a slot of its own that no other execution uses, with at most twenty waiting executions. Each trigger SHALL have at most one pending firing. Every admitted execution, including one in the reserved coordination slot, SHALL be able to use the bot's shell and desktop alongside the bot's other live executions, without acquiring ownership of either. When an ordinary work slot frees while an execution occupies the reserved coordination slot, the server SHALL move that execution into the ordinary slot so the reserved slot is available for the next user message. Instructions, pinned memories, agent, model, sign-in and approval mode SHALL be snapshotted per execution. Completed providers SHALL close rather than remaining idle for later messages.

#### Scenario: Coordination while work capacity is full

- **WHEN** four work executions run and a user posts a correction
- **THEN** a reserved coordination execution can inspect, message, stop or replace older work, and can run shell commands of its own

#### Scenario: Check-in while work capacity is full

- **WHEN** four work executions and a reserved-slot execution run, and one of them reaches a 15-minute mark
- **THEN** its check-in runs in the check-in slot

#### Scenario: Stuck check-in does not block a user message

- **WHEN** four work executions run, a check-in is stuck in the check-in slot, and a user posts a correction
- **THEN** the correction is admitted into the reserved coordination slot

#### Scenario: Profile edited during work

- **WHEN** a user edits the bot's instructions during an execution
- **THEN** that execution retains its snapshot and subsequent executions use the revised profile

#### Scenario: Reserved slot is returned

- **WHEN** four work executions and a reserved-slot execution run, and one work execution ends
- **THEN** the reserved-slot execution moves into the freed work slot, and a further user message is admitted into the reserved slot immediately

#### Scenario: Unrelated work overlaps

- **WHEN** a trigger execution is running shell commands and a user posts an unrelated request
- **THEN** the new execution runs its own shell commands while the trigger execution keeps running, and neither is refused for the other's activity

### Requirement: Stopping a turn and closing an agent

**Stop** SHALL ask the agent to cancel the running turn. It SHALL then end the session's process group, so that no session-owned command the turn started keeps running: once the agent acknowledges the cancel, or after 10 seconds if it does not, first with a termination signal and then, 5 seconds later, with a kill signal. The turn SHALL be marked stopped, and the agent closed.

Stop SHALL revoke the execution capability, close the execution and retain its diagnostics. The next user message SHALL start a fresh execution.

An agent SHALL be closed whenever its session ends or is suspended, and whenever its bot stops. Closing SHALL first close the agent's input, then end its process group after 5 seconds. An agent SHALL count as closed only once its process group is confirmed gone.

Each session SHALL run under a root supervisor that leads its process group for the whole session. That supervisor SHALL hold a root-only record of the group, the leader's start time, and a random session nonce, and SHALL retire the record once the group is empty. A signal SHALL be sent to a group only while its recorded leader is alive with a matching start time. Otherwise, it SHALL be sent only to processes that are in that group and carry the session's nonce, so that a reused group number never reaches unrelated work. The session view SHALL say that a process the agent moved into its own process group is not ended by Stop, but is ended by stopping the bot.

A turn SHALL have no maximum duration. The server SHALL run no timer that ends a turn, and SHALL launch each agent with its own background-work time limit turned off, so a session runs until its work ends, it fails, or it is stopped.

Each request to the container engine that ends a session's process group, or every process group in a bot container, SHALL be allowed 5 minutes to complete before the server treats that request as failed. The limit applies to each request, so closing an agent and its runtime relays can take longer in total.

An execution's cleanup has failed when ending its agent's process group is not confirmed. A failure to end one of its runtime relays SHALL be logged with its error but SHALL NOT count as a cleanup failure. After a cleanup failure, the server SHALL still revoke the execution's capability, release any shared shell or desktop ownership it held, and durably record the execution. Except at the blocking threshold below, a cleanup failure SHALL NOT change the outcome the turn already recorded: a turn whose agent answered stays completed, and a stopped, timed-out or failed turn keeps that outcome. The server SHALL durably append the cleanup failure to that execution's runner output and log it with its error to the server diagnostics, both redacted with the bot's secrets.

Cleanup failures SHALL be counted per bot in the order executions finish. A bot SHALL keep admitting executions until 3 consecutive finished executions of that bot have failed cleanup. An execution that finishes with confirmed cleanup SHALL reset that count while the bot is not blocked. On the third consecutive failure, the bot SHALL be blocked: that execution SHALL be marked failed with cause `engine` and a reason saying the bot is blocked after repeated cleanup failures, waiting work SHALL be cancelled, and new executions SHALL be refused. An execution that finishes after the bot is blocked SHALL NOT unblock it. The bot SHALL be unblocked when the server's startup reconciliation confirms it has ended every session process group in the bot's container, or when the retry below confirms every unconfirmed cleanup.

Before admitting a new execution for a blocked bot, the server SHALL retry ending the process group of each execution whose cleanup has been unconfirmed since the bot's last confirmed cleanup. It SHALL NOT end any other running execution. When every retry is confirmed, the bot SHALL be unblocked and the new execution admitted, without a server restart, and each retried execution's runner output SHALL record the confirmation. While a retry fails, the new execution SHALL be refused, and a user message SHALL be refused with a reason naming the unconfirmed cleanup and the container engine, not sign-in. Enabling a blocked bot or saving its profile SHALL NOT fail; the bot stays blocked until a retry or reconciliation confirms cleanup.

Any other failure while finishing an execution SHALL block the bot at once, with the same recovery.

Desktop-owned graphical applications SHALL remain outside execution process groups and SHALL survive execution closure and Stop. Stopping the bot container SHALL end them. The session view SHALL explain this lifetime distinction.

#### Scenario: Agent honours cancel, but its command keeps running

- **WHEN** a user chooses Stop while the agent runs `sleep 300`, and the agent acknowledges the cancel at once
- **THEN** the session's process group is ended, `sleep 300` no longer runs, the turn is marked stopped, and the user's next message starts a fresh execution

#### Scenario: Agent ignores cancel

- **WHEN** a user chooses Stop and the agent is still running after 10 seconds
- **THEN** the session's process group is ended, no process from that group remains, and the turn is marked stopped

#### Scenario: Agent crashes

- **WHEN** the agent process exits during a turn
- **THEN** the session is marked failed, the reason and runner output are kept, and the bot's card shows the failure

#### Scenario: Slow engine finishes cleanup within the deadline

- **WHEN** a turn completes and the container engine takes 45 seconds to run the request that ends its process group
- **THEN** the cleanup succeeds, the turn stays completed, and the bot's next trigger firing runs

#### Scenario: One cleanup failure after a completed turn

- **WHEN** a trigger turn's agent answers and ending its agent's process group then fails
- **THEN** the turn stays completed, its capability is revoked, its shared-work ownership is released, its stored runner output records the redacted cleanup failure, the failure is logged, and the trigger's next firing starts a new execution

#### Scenario: Cleanup failure keeps a stopped or timed-out outcome

- **WHEN** a turn is recorded as stopped or timed out and ending its agent's process group then fails
- **THEN** the turn stays stopped or timed out, and the cleanup failure is counted and recorded

#### Scenario: Relay cleanup failure

- **WHEN** a turn completes, its agent's process group is confirmed ended, and ending one of its runtime relays fails
- **THEN** the relay failure is logged, the turn stays completed, and the consecutive cleanup-failure count resets

#### Scenario: Successful cleanup resets the count

- **WHEN** two consecutive executions fail cleanup and the next execution to finish has confirmed cleanup
- **THEN** the bot is not blocked, and two further cleanup failures still do not block it

#### Scenario: Concurrent executions finish out of order

- **WHEN** executions A, B and C of one bot start in that order, B and C fail cleanup, and A then finishes with confirmed cleanup
- **THEN** the count is reset when A finishes, and the bot is not blocked

#### Scenario: Third consecutive cleanup failure blocks the bot

- **WHEN** three consecutive finished executions of a bot fail cleanup
- **THEN** the third execution is marked failed with cause `engine` and a reason saying the bot is blocked after repeated cleanup failures, no failure investigation is started for it, its waiting work is cancelled, and new messages and trigger firings are refused while the retried cleanup still fails

#### Scenario: A success after blocking does not unblock

- **WHEN** a bot is blocked by its third consecutive cleanup failure and another execution that was already running then finishes with confirmed cleanup
- **THEN** the bot stays blocked

#### Scenario: Reconciliation unblocks only after confirmed cleanup

- **WHEN** the server starts with a blocked bot and ending every session process group in its container fails
- **THEN** the bot stays blocked, and when a later reconciliation confirms those groups are gone, the bot admits new executions

#### Scenario: Blocked bot recovers on the next message

- **WHEN** a bot is blocked by three consecutive cleanup failures, the engine has recovered, and the user sends it a message
- **THEN** the server ends each of those three executions' process groups again, records the confirmation in their runner output, unblocks the bot, and runs the message without a server restart

#### Scenario: Retried cleanup still fails

- **WHEN** a blocked bot is sent a message and ending an unconfirmed execution's process group fails again
- **THEN** the message is refused with a reason naming the unconfirmed cleanup and the container engine, not sign-in, and the next message retries the cleanup again

#### Scenario: Re-enabling a blocked bot

- **WHEN** a user disables and re-enables a blocked bot
- **THEN** neither action fails, and the bot's next execution retries the unconfirmed cleanup before it runs

#### Scenario: Turn runs for hours

- **WHEN** a turn is still working after several hours
- **THEN** the server does not time it out and the session stays running

#### Scenario: Background monitor outlasts ten minutes

- **WHEN** a Claude Code bot ends its turn with a background monitor that finishes 40 minutes later
- **THEN** the agent is still running when the monitor finishes, and the monitor wakes it

#### Scenario: Stop preserves the desktop application

- **WHEN** a user stops an execution with a desktop-owned Gridcraft workbook and a session-owned `sleep 300` command
- **THEN** the command ends, Gridcraft stays open with its workbook, and the session view explains that stopping the bot container ends desktop apps

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

Each bot SHALL have an approval mode, **Autonomous** or **Ask me**. The approval mode SHALL govern only the agent's own permission requests. Terminay MCP calls from a bot with Terminay MCP access follow the mcp-permissions contract for bot execution callers, whatever the approval mode.

- **Autonomous.** Terminay SHALL answer each of the agent's permission requests with the most permissive single-use option the agent offers, because the agent's own tools act only inside the bot's container.
- **Ask me.** Each request SHALL wait on the user. The session SHALL show as needing the user, both on the dashboard and in the bot's tab, with the agent's options.

A bot whose agent is Autonomous only SHALL always be Autonomous. Its Profile SHALL show the approval mode as fixed and say why: that agent cannot ask permission inside a container.

The first answer from any device SHALL decide a request. Later answers SHALL receive "already answered". A request SHALL stay open until it is answered or its turn ends. A request still unanswered when its turn ends SHALL be answered with the agent's reject option.

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

Every user-message execution, every trigger run, every failure investigation and every check-in SHALL be a session of exactly one bot. A session SHALL record:

- its origin: chat, trigger (naming the trigger), Run now (naming the trigger), failure (naming the failures it was started for), or check-in (naming the session it watches and how long that session had run);
- the agent and model it ran with;
- its start time, end time, and duration;
- its state: queued, running, suspended, needs you, completed, stopped, timed out, failed, or interrupted;
- its transcript of user messages, agent replies, tool activity, and plan updates.

The Sessions tab SHALL:

- list a bot's sessions, newest first;
- filter them by origin, including failure and check-in, and by outcome, and search them by text;
- filter them by the trigger that started them, covering both its firings and its Run now sessions;
- show the trigger filter as a removable control naming the trigger, with the name the trigger had when the filter was applied;
- show a selected session's transcript and its runner output;
- for a failure session, show the failures it was started for, each linking to the failed session or trigger;
- offer Stop on a running session;
- offer a return to the shared message log without resuming the selected execution.

The listed sessions SHALL be those that match every active filter. Removing the trigger filter, or choosing the Sessions tab itself, SHALL clear only the trigger filter and keep the origin, outcome and text filters. A request to open a specific session SHALL clear the trigger filter, so the requested session is shown. Applying a trigger filter SHALL select the newest matching session.

The trigger filter SHALL match a session by the trigger id recorded in its origin, so a deleted or renamed trigger still finds its retained sessions. The server SHALL apply the trigger filter only within the requested bot's sessions. A trigger id that no session of that bot records, including another bot's trigger id, SHALL return no sessions.

#### Scenario: Trigger run is a session

- **WHEN** a schedule trigger fires
- **THEN** a session with origin trigger, naming that trigger, appears in the bot's Sessions tab and recent sessions

#### Scenario: Reading an ended execution

- **WHEN** a user opens an ended execution
- **THEN** its diagnostics are shown independently of the shared chat, and sending another message creates a fresh execution

#### Scenario: Failure session

- **WHEN** a trigger run fails and the server starts a failure investigation
- **THEN** a session with origin failure appears, the Failure origin filter shows it, and opening it links to the failed trigger run

#### Scenario: Filtering by trigger

- **WHEN** a bot has sessions from chat, from trigger A firing, from Run now on trigger A, and from trigger B, and the Sessions tab is filtered to trigger A
- **THEN** only the two sessions started by trigger A are listed, newest first, and the newest is selected

#### Scenario: Trigger filter combines with other filters

- **WHEN** the Sessions tab is filtered to trigger A and the origin filter is set to Run now
- **THEN** only trigger A's Run now sessions are listed

#### Scenario: No session matches every filter

- **WHEN** the Sessions tab is filtered to a trigger that has never started a session
- **THEN** the list says no sessions match and still shows the trigger filter control

#### Scenario: Clearing the trigger filter

- **WHEN** a user removes the trigger filter control while the outcome filter is set to Failed
- **THEN** the list shows every failed session of the bot, and the outcome filter stays set

#### Scenario: Choosing the Sessions tab clears the trigger filter

- **WHEN** the Sessions tab is filtered to a trigger and the user chooses the Sessions tab
- **THEN** the trigger filter is removed and the other filters are kept

#### Scenario: Opening a specific session clears the trigger filter

- **WHEN** the Sessions tab is filtered to trigger A and the user opens a session of trigger B from Needs you or the recent sessions
- **THEN** the trigger filter is removed and trigger B's session is selected

#### Scenario: Deleted trigger keeps its history

- **WHEN** the Sessions tab is filtered to a trigger that is then deleted, and its sessions are retained
- **THEN** its sessions stay listed under the filter

#### Scenario: Trigger filter is scoped to the bot

- **WHEN** a client asks for a bot's sessions filtered by the id of another bot's trigger
- **THEN** no sessions are returned

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
- **Workspace MCP callers.** No terminal, agent-chat or bot-execution MCP capability SHALL create, read, change, or prompt a bot. A bot execution’s own authenticated runtime tools SHALL be restricted to that bot under the bot-message-log contract, except for the read-only inspection tools that a bot with Inspect other bots on can use under the bot-inspection contract.
- **Inspect other bots.** Only a user with bot authority SHALL be able to change this setting, through a bot save. No MCP capability SHALL change it.
- **Terminay MCP access.** Only a bot whose Terminay MCP access is on SHALL receive a Terminay MCP capability, and only for its live executions, under the mcp-server bot execution capability contracts. Turning the setting off SHALL revoke the capability of every live execution of that bot before the save completes, and those executions SHALL keep running with their runtime tools only. Deleting the bot SHALL revoke them before anything else the delete does.

#### Scenario: Client without terminal authority

- **WHEN** a client without authority to create terminals on a server asks to list its bots or subscribe to them
- **THEN** both requests are refused and no bot data is sent

#### Scenario: Authority revoked mid-stream

- **WHEN** a paired device's authority is revoked while it views a bot's desktop and shell
- **THEN** both streams close at once and no further frame or output reaches that device

#### Scenario: MCP caller

- **WHEN** a process presents an MCP capability to a bot operation
- **THEN** the request is refused

#### Scenario: Access turned off mid-execution

- **WHEN** a bot with Terminay MCP access is running an execution that is listing terminals, and a user turns the setting off
- **THEN** the execution's next Terminay MCP call fails as revoked, and it can still post to the bot's message log

#### Scenario: Bot cannot grant itself inspection

- **WHEN** a bot execution uses any runtime or Terminay MCP tool to try to turn on Inspect other bots
- **THEN** the setting is unchanged

### Requirement: Resizable Bots rail

The rail on the right of the Bots section, and the context rail on the right of
a bot tab in Chat mode, SHALL offer a resize separator on its left edge that
looks and behaves like the Pull Requests and Issues preview separator.
Dragging it SHALL resize the rail as the pointer moves, and releasing SHALL set
the chosen width. A drag SHALL start from the width the rail is drawn at; a
cancelled drag, or a press that does not move, SHALL leave the chosen width
unchanged.

#### Scenario: Dragging the rail wider

- **WHEN** the rail is 300 pixels wide and the user drags its separator 100
  pixels to the left
- **THEN** the rail grows with the pointer and after release it is 400 pixels
  wide

#### Scenario: A cancelled drag changes nothing

- **WHEN** the user drags the separator and the drag is cancelled before release
- **THEN** the rail returns to its width from before the drag and the chosen
  width is unchanged

#### Scenario: A press without a move changes nothing

- **WHEN** the user presses and releases the separator without moving
- **THEN** the chosen width is unchanged

### Requirement: Bots rail width from the keyboard

The rail's resize separator SHALL be reachable with Tab. With it focused,
Arrow Left SHALL widen and Arrow Right SHALL narrow the rail by 16 pixels from
the width it is drawn at, within the same bounds as a drag, and SHALL set the
chosen width.

#### Scenario: Resizing with the keyboard

- **WHEN** the user focuses the separator and presses Arrow Left twice, then
  Arrow Right once
- **THEN** the rail is 16 pixels wider than before

### Requirement: Bots rail width bounds

A width the user sets SHALL be between 240 and 560 pixels, and the chosen width
SHALL be 300 pixels until the user sets one. The rail SHALL be drawn at the
chosen width reduced so that the column beside it keeps at least 420 pixels,
and never narrower than 240 pixels; a remembered width outside 240 to 560
pixels SHALL be drawn within them. Drawing narrower SHALL NOT change the chosen
width.

#### Scenario: The width is bounded

- **WHEN** the user drags the separator past 560 pixels, or to less than 240
- **THEN** the rail stops at 560 or 240 pixels

#### Scenario: The main column keeps its room

- **WHEN** the chosen width is 560 pixels and the Bots area is 900 pixels wide
- **THEN** the rail is drawn 480 pixels wide and the column beside it keeps 420
  pixels

#### Scenario: The chosen width returns when there is room

- **WHEN** the chosen width is 560 pixels, the Bots area narrows to 900 pixels,
  and then widens to 1,400 pixels
- **THEN** the rail is drawn 480 pixels wide and then 560 pixels wide, and the
  chosen width stays 560 pixels throughout

#### Scenario: A Bots area too narrow to resize

- **WHEN** a bot tab in Chat mode is 600 pixels wide beside another Home tab in
  a 1,600-pixel window
- **THEN** the context rail is drawn 240 pixels wide and there is no resize
  separator

### Requirement: Bots rail in a narrow window

When the window is 860 pixels wide or narrower, the Bots section's rail SHALL
be stacked under the bot cards at full width, and a bot tab's context rail
SHALL be hidden. Neither SHALL have a resize separator or anything to reach
with Tab for resizing. The chosen width SHALL be unchanged.

#### Scenario: A narrow window on the Bots section

- **WHEN** the window is 800 pixels wide and the user opens the Bots section
- **THEN** the rail is under the bot cards and there is no resize separator

#### Scenario: A narrow window on a bot tab

- **WHEN** the window is 800 pixels wide and the user opens a bot tab in Chat
  mode
- **THEN** the context rail is not shown and there is no resize separator

### Requirement: Bots rail width is remembered on the device

The Bots section and every bot tab SHALL share one chosen rail width,
remembered on the device and never stored on the server.

#### Scenario: One chosen width everywhere

- **WHEN** the user widens the rail in the Bots section to 400 pixels and then
  opens a bot tab in Chat mode whose area has room for it
- **THEN** the bot tab's context rail is drawn 400 pixels wide

#### Scenario: The width survives a relaunch

- **WHEN** the user sets the rail to 400 pixels and relaunches Terminay on that
  device
- **THEN** the chosen width is 400 pixels

### Requirement: Active sessions pinned in recent sessions

The context rail's recent sessions SHALL list a bot's active sessions (queued, running, or needs you) before its inactive ones, each group newest first. The rail SHALL show at most six sessions, chosen after this ordering, so no newer inactive session displaces an active one; with more than six active, it shows the six newest active sessions.

#### Scenario: Older active session pinned above newer finished sessions

- **WHEN** a bot has a running session and, started after it, two sessions that have completed
- **THEN** the rail lists the running session first, followed by the two completed sessions newest first

#### Scenario: Active sessions keep recency order

- **WHEN** a bot has a session that needs you and a newer queued session
- **THEN** the rail lists the queued session first and the session that needs you second, both above any inactive session

#### Scenario: Active session not pushed out of the rail

- **WHEN** a bot has a running session and more than six newer sessions that have ended
- **THEN** the running session is the first row of the rail and the rail still shows six rows

#### Scenario: Session leaves the pinned group when it ends

- **WHEN** a pinned running session completes
- **THEN** the rail moves it into the inactive group at its newest-first position without the user reloading

#### Scenario: Suspended session is not pinned

- **WHEN** a bot has a suspended session and a newer completed session
- **THEN** the rail lists the completed session first

#### Scenario: More active sessions than rows

- **WHEN** a bot has eight active sessions and some ended sessions
- **THEN** the rail shows the six newest active sessions and no ended session

#### Scenario: Active session older than twenty newer sessions

- **WHEN** a bot has a session that needs you and more than twenty newer sessions that have ended
- **THEN** the rail's first row is the session that needs you

### Requirement: Active recent sessions marked as live

Each active row in the context rail's recent sessions SHALL show its state label, offer Stop, and show a pulsing state dot. Inactive rows SHALL NOT pulse, and no row SHALL pulse when the user prefers reduced motion.

#### Scenario: Active row marked as live

- **WHEN** the rail shows a queued, running, or needs-you session
- **THEN** its row shows a pulsing state dot, its state label, and a Stop button, an ended session's dot does not pulse, and no dot pulses when the user prefers reduced motion

### Requirement: Bot instructions describe desktop application launch

Bot instructions SHALL direct agents to the desktop-owned application launcher for graphical applications and the browser helper for websites. They SHALL require a fresh screenshot to verify visible results, distinguish launch acceptance from success, and explain that desktop applications outlive individual executions.

#### Scenario: Agent opens a graphical application
- **WHEN** an execution receives its bot instructions
- **THEN** they describe the supported desktop launch command, diagnostic location, screenshot verification, and desktop application lifetime
