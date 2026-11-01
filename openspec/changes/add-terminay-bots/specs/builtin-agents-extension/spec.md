## ADDED Requirements

### Requirement: Built-in bot agents

The extension SHALL contribute two bot agents:

- **Claude Code** (`claude-code`):
  - its image install step SHALL pin `@agentclientprotocol/claude-agent-acp` to an exact version;
  - its ACP command SHALL be that adapter;
  - its credential secrets SHALL be a sign-in token, `CLAUDE_CODE_OAUTH_TOKEN`, whose help text names `claude setup-token`, and an API key, `ANTHROPIC_API_KEY`;
  - it SHALL be able to ask permission;
  - its launch environment SHALL set `CLAUDE_CODE_MAX_RETRIES` low enough that a rejected credential is reported within seconds, and SHALL set `CLAUDE_CODE_SHELL_PREFIX` to the image's `terminay-tool-shell`, so that tool commands run without the bot's credential variables.
- **Codex** (`codex`):
  - its image install step SHALL pin `@agentclientprotocol/codex-acp`, which brings its own compatible Codex, to an exact version, and SHALL put that Codex on the `PATH` as `codex`;
  - its ACP command SHALL be that adapter;
  - its device sign-in SHALL be labelled **Sign in with ChatGPT**, with the sign-in command `codex login --device-auth`, the sign-out command `codex logout`, and its own `.codex/config.toml` that keeps the login in the bot's `~/.codex` (`cli_auth_credentials_store = "file"`) and keeps credential variables out of tool shells;
  - its credential secret SHALL be an API key, `CODEX_API_KEY`, which needs ACP `authenticate` with the method id `api-key`;
  - it SHALL be Autonomous only, because its own sandbox cannot run inside a bot container;
  - its bot config file `.codex/config.toml` SHALL keep credentials in memory only (`cli_auth_credentials_store = "ephemeral"`), so that an API key never reaches the bot's disk, and SHALL keep credential variables out of tool shells (`shell_environment_policy.exclude`).

The extension SHALL NOT install agent CLIs separately from their adapters. Each agent's `models` SHALL return the models that its pinned adapter accepts. Each agent's `launch` SHALL return the adapter's model setting only when the adapter does not offer model selection through ACP session configuration, and SHALL return nothing for Default.

The bot agents SHALL NOT depend on the session source, on any harness switch, or on the chat providers. Each SHALL carry a conformance test that runs its pinned adapter in the bot image against a fake model endpoint. That test SHALL cover:

- initialization;
- a new session;
- a streamed prompt;
- tool use;
- a permission request, for an agent that can ask permission;
- model selection;
- cancellation;
- loading a session after the process restarts, where the adapter supports it;
- that the declared device sign-in command prints a URL and a code, and that the bot config file still behaves as declared;
- that a credential secret reaches neither the bot's disk nor a tool shell's environment.

#### Scenario: Codex bot signs in with ChatGPT

- **WHEN** a user chooses Sign in with ChatGPT for a Codex bot and approves the code in their browser
- **THEN** the bot's sessions run signed in, and the login is saved only in that bot's `~/.codex`

#### Scenario: Claude Code sign-in

- **WHEN** a user opens Sign-in for a Claude Code bot, on any platform
- **THEN** it offers a sign-in token from `claude setup-token` and an API key, and nothing else

#### Scenario: Codex bot with an API key

- **WHEN** a Codex bot whose Sign-in is an API key runs a session that uses its shell tool
- **THEN** the agent is signed in, the key is in no file in the bot's home, and the tool's shell has no credential variable

#### Scenario: Model chosen

- **WHEN** a Codex bot's model is set to one of the listed models
- **THEN** its sessions run with that model selected

#### Scenario: Harness switched off

- **WHEN** the Codex harness switch for agent status is off
- **THEN** the Codex bot agent is still available
