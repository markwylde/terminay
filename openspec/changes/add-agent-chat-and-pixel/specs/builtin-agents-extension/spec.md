## ADDED Requirements

### Requirement: Built-in chat providers

The extension SHALL contribute two chat providers:

- **Claude Code** (`claude-code`) SHALL run each session as one long-lived `claude` process in print mode, with streaming-JSON input and output. It SHALL be started with built-in tools disabled, only the host-supplied MCP server loaded under strict MCP configuration, the Terminay MCP tools allowed, every other permission prompt denied, session persistence off, the host's working directory, and the host's instruction appended to the system prompt.
- **Codex** (`codex`) SHALL run each session as one `codex app-server` process speaking its JSON-RPC protocol over stdio. It SHALL hold one ephemeral thread started in the host's working directory, with a read-only sandbox, the approval policy that asks before running anything that is not trusted, the host-supplied MCP server as the only MCP server with its tools pre-approved so that Terminay's own permission policy decides them, its browser, computer-use and app features off, and the host's instruction as developer instructions. It SHALL decline every command-execution, file-change and permission approval request the app server sends.

Each provider SHALL map its agent's streamed output to the platform's chat events: reply text deltas, tool activity with MCP server and tool names, turn completion, and failures. Each SHALL cancel a turn through its protocol's own interrupt, and SHALL end the process when the session closes. The providers SHALL NOT depend on the session source or on any harness switch.

#### Scenario: Claude Code session

- **WHEN** the host opens a Claude Code session with a Terminay MCP entry and the user asks to read a terminal
- **THEN** the provider's `claude` process calls the Terminay `read_terminal` tool, the chat shows the activity, and the reply streams back

#### Scenario: Codex declines a shell command

- **WHEN** a Codex session's app server asks for approval to run a command
- **THEN** the provider declines it and the command does not run

#### Scenario: Harness switched off

- **WHEN** the Claude Code harness switch for agent status is off
- **THEN** the Claude Code chat provider is still available

### Requirement: Locating the agent CLIs

Each provider SHALL locate its agent executable on the server account in this order:

1. an absolute path set in `TERMINAY_CLAUDE_CODE_COMMAND` or `TERMINAY_CODEX_COMMAND`;
2. the server environment's `PATH`;
3. the PATH that the account's login shell reports, read once per extension activation with a bounded timeout;
4. the agent's documented per-user install locations, including Node version manager directories, newest first.

A provider whose executable is not found SHALL report `not_installed`. A provider whose agent reports that it is not signed in SHALL report `not_signed_in`, and the agent's error SHALL name the sign-in command (`claude` or `codex login`). A located executable SHALL be invoked directly, never through a shell.

#### Scenario: Desktop launched from the Dock

- **WHEN** Terminay Desktop is launched from the Dock, `claude` is installed only in `~/.local/bin`, and the server environment's PATH lacks that directory
- **THEN** the Claude Code provider finds `claude` through the login shell PATH or the per-user install location, and reports available

#### Scenario: Codex not installed

- **WHEN** no `codex` executable can be found
- **THEN** the Codex provider reports `not_installed`
