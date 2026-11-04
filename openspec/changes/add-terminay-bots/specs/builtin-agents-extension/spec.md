## ADDED Requirements

### Requirement: Built-in bot agents

The extension SHALL contribute Claude Code (`claude-code`) and Codex (`codex`) bot agents, independent of session detection, harness switches and chat providers. They SHALL satisfy the native CLI runtime and built-in native CLI bot agent contracts, including pinned direct CLI installation, per-bot credentials, guided sign-in, model selection, approvals and executable conformance. The host SHALL own native command assembly and execution.

#### Scenario: Codex bot signs in with ChatGPT

- **WHEN** a user chooses Sign in with ChatGPT for a Codex bot and approves the code in their browser
- **THEN** the bot's sessions run signed in, and the login is saved only in that bot's `~/.codex`

#### Scenario: Claude Code sign-in

- **WHEN** a user opens Sign-in for a Claude Code bot, on any platform
- **THEN** it offers Sign in with Claude through its own sign-in terminal, a sign-in token from `claude setup-token`, and an API key

#### Scenario: Codex bot with an API key

- **WHEN** a Codex bot whose Sign-in is an API key runs a session that uses its shell tool
- **THEN** the agent is signed in, the key is in no file in the bot's home, and the tool's shell has no credential variable

#### Scenario: Model chosen

- **WHEN** a Codex bot's model is set to one of the listed models
- **THEN** its sessions run with that model selected

#### Scenario: Harness switched off

- **WHEN** the Codex harness switch for agent status is off
- **THEN** the Codex bot agent is still available
