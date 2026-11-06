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
- an **Investigate failures** setting, on unless the user turns it off (see bot-failure-follow-up).

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

#### Scenario: Investigate failures defaults on

- **WHEN** a user creates a bot without touching Investigate failures, or opens a bot saved before the setting existed
- **THEN** the profile shows Investigate failures on

### Requirement: Sessions

Every user-message execution, every trigger run and every failure investigation SHALL be a session of exactly one bot. A session SHALL record:

- its origin: chat, trigger (naming the trigger), Run now, or failure (naming the failures it was started for);
- the agent and model it ran with;
- its start time, end time, and duration;
- its state: queued, running, suspended, needs you, completed, stopped, timed out, failed, or interrupted;
- its transcript of user messages, agent replies, tool activity, and plan updates.

The Sessions tab SHALL:

- list a bot's sessions, newest first;
- filter them by origin, including failure, and by outcome, and search them by text;
- show a selected session's transcript and its runner output;
- for a failure session, show the failures it was started for, each linking to the failed session or trigger;
- offer Stop on a running session;
- offer a return to the shared message log without resuming the selected execution.

#### Scenario: Trigger run is a session

- **WHEN** a schedule trigger fires
- **THEN** a session with origin trigger, naming that trigger, appears in the bot's Sessions tab and recent sessions

#### Scenario: Reading an ended execution

- **WHEN** a user opens an ended execution
- **THEN** its diagnostics are shown independently of the shared chat, and sending another message creates a fresh execution

#### Scenario: Failure session

- **WHEN** a trigger run fails and the server starts a failure investigation
- **THEN** a session with origin failure appears, the Failure origin filter shows it, and opening it links to the failed trigger run
