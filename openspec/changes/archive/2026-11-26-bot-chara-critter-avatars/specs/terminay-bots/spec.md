## MODIFIED Requirements

### Requirement: Bot profile

A bot SHALL have:

- a name, unique on its server, of at most 40 characters;
- an avatar style: **Critter** (a deterministic SVG character generated from the bot's name using Chara's `critter` theme, the default) or **Character** (an emoji or a single character on a chosen colour);
- a description of at most 200 characters;
- instructions of at most 32 KiB of UTF-8;
- one agent and one model;
- a sign-in (see bot-environment);
- an approval mode;
- an **Investigate failures** setting, on unless the user turns it off (see bot-failure-follow-up);
- a **Terminay MCP access** setting, off unless the user turns it on;
- an **Inspect other bots** setting, off unless the user turns it on (see bot-inspection).

When a bot's avatar style is Critter, every surface showing the bot's avatar SHALL render the Chara `critter` SVG for the bot's name, filling the avatar frame while keeping any activity dot intact. When a bot's avatar style is Character, every surface showing the bot's avatar SHALL render the saved emoji or single character (or the bot's initials when blank) on the bot's chosen colour.

The Profile SHALL let the user switch between Critter and Character and SHALL show a live avatar preview that reflects the current name and avatar settings. The character input and colour swatches SHALL be shown when Character is selected and hidden when Critter is selected. A bot whose saved profile has no explicit avatar style SHALL default to Critter.

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

#### Scenario: Avatar defaults to Critter

- **WHEN** a user creates a bot without choosing an avatar style, or opens a bot whose saved profile has no avatar style
- **THEN** the bot's avatar renders as a Chara Critter generated from its name, and the Profile shows Critter selected with no character input or colour swatches

#### Scenario: Switching to a character avatar

- **WHEN** a user switches a bot's avatar style from Critter to Character in Profile, enters an emoji or single character, picks a colour, and saves
- **THEN** the bot's avatar across the workspace renders that character on the chosen colour and persists across restarts

#### Scenario: Renaming a Critter bot updates its avatar

- **WHEN** a user edits the name of a Critter bot in Profile
- **THEN** the live avatar preview updates immediately to the Critter for the new name, and saving updates the bot's avatar everywhere

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
