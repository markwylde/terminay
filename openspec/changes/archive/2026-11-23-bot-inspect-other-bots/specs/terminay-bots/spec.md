## MODIFIED Requirements

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
