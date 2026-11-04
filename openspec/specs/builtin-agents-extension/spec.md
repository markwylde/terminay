# builtin-agents-extension Specification

## Purpose
TBD - created by archiving change builtin-agents-extension. Update Purpose after archive.

## Requirements

### Requirement: Detection is delegated to all-your-agents

The built-in agents extension (`com.terminay.builtin-agents`, package `terminay-builtin-agents`) SHALL detect sessions only through `@markwylde/all-your-agents`. It SHALL pin an exact library version and run one library instance built from the library's built-in providers. It SHALL contain no journal parser, process matcher, status inference, or timer-driven check of its own. The extension SHALL start the library when its session source starts, SHALL stop it when the source is cancelled, and SHALL NOT poll.

#### Scenario: Status comes from the library

- **WHEN** the library reports a session status change
- **THEN** the extension publishes that status and derives none of its own

#### Scenario: Source cancelled

- **WHEN** agent status is switched off or the extension is disabled
- **THEN** the library instance is stopped and every file and process watch it held is released

### Requirement: Supported harnesses

The extension SHALL declare one session source with four harnesses. Each harness SHALL map to exactly one library provider:

| Harness | Library provider |
|---|---|
| Claude Code | `claude-code` |
| Codex | `codex-cli` |
| Grok | `grok-build` |
| oh-my-pi | `oh-my-pi` |

The library SHALL be started with only the providers whose harness is switched on. A change to the enabled set SHALL stop the library, restart it with the new provider set, and publish a reset of the live sessions. A session for a provider the extension does not map SHALL NOT be published.

#### Scenario: Only enabled harnesses run

- **WHEN** Grok is switched off
- **THEN** the library runs without the Grok provider and no Grok session is published

#### Scenario: Harness switched back on

- **WHEN** Grok is switched back on
- **THEN** the library restarts with the Grok provider and live Grok sessions are published in a reset

### Requirement: Library sessions map to bounded snapshots

The extension SHALL publish only live library sessions: those with a `pid`. Each snapshot SHALL carry:

- the library session id and the mapped harness
- `pid` and `cwd`
- the effective title and `model`
- `status` and `waitingFor`, except that a library `waiting` whose `waitingFor` is `shell` or `monitor` — a turn that ended while background work it started will wake the session — SHALL be `running` with no `waitingFor`, because no user input is requested
- the current tool name, the last-turn outcome and end time, and the bounded `activity.error`
- the session's subagents, each with its id, parent id, type, title, and status

`session:create`, `session:open`, `session:status`, `session:update`, `session:activity`, `subagent:start`, and `subagent:end` SHALL publish an upsert. `session:close` SHALL publish a removal. Catch-up events SHALL be collected and published as one reset when `ready` fires. Transcript, event-stream, and raw record content SHALL never be published. A library `error` event SHALL be reported as a typed extension diagnostic without paths or conversation content, and SHALL NOT stop the source.

#### Scenario: Catch-up at start

- **WHEN** the library starts with three live sessions and then emits `ready`
- **THEN** the extension publishes one reset containing those three sessions

#### Scenario: Session waits on a background shell

- **WHEN** the library reports a session `waiting` with `waitingFor` `shell`
- **THEN** the extension publishes it as `running` with no `waitingFor`

#### Scenario: Session closes

- **WHEN** the library emits `session:close`
- **THEN** the extension publishes a removal for that session id

#### Scenario: Historical session

- **WHEN** the library knows a session with no `pid`
- **THEN** it is not published

#### Scenario: Provider error

- **WHEN** the library emits a provider error
- **THEN** a typed diagnostic is recorded and other sessions continue to be published

### Requirement: Process-exit detection

The extension SHALL ship the library's optional native process-watch dependency so a session is closed as soon as its process exits on platforms where that dependency loads. Where it cannot load, the extension SHALL keep running on the library's file-change re-validation, and SHALL report the degraded mode once as a diagnostic.

#### Scenario: Agent process killed

- **WHEN** an agent process is killed and the native process watch is available
- **THEN** its session is removed without waiting for another file change

#### Scenario: Native watch unavailable

- **WHEN** the native dependency cannot load
- **THEN** the source still runs, and one diagnostic records the degraded exit detection

### Requirement: Built-in MCP install targets

The extension SHALL contribute MCP install targets for Claude Code, Codex, Cursor CLI, Gemini CLI, Grok, and OpenCode. Each target SHALL implement that client's user-wide registration contract, installation safety, and ambiguous-configuration rules exactly as the MCP server capability specifies, using the MCP server command the host supplies. The targets SHALL write configuration atomically. They SHALL NOT depend on the session source or on any harness switch.

#### Scenario: Harness switched off

- **WHEN** the Codex harness is switched off
- **THEN** the Codex MCP install target still reports status and can install and uninstall

#### Scenario: Install uses the host command

- **WHEN** a target installs the registration
- **THEN** the `terminay` entry it writes carries the executable, arguments, and environment the host supplied and nothing else

### Requirement: Built-in chat providers

The extension SHALL contribute two chat providers:

- **Claude Code** (`claude-code`) SHALL run each session as one long-lived `claude` process in print mode, with streaming-JSON input and output. It SHALL be started with built-in tools disabled, only the host-supplied MCP server loaded under strict MCP configuration, the Terminay MCP tools allowed, every other permission prompt denied, session persistence off, the host's working directory, and the host's instruction appended to the system prompt.
- **Codex** (`codex`) SHALL run each session as one `codex app-server` process speaking its JSON-RPC protocol over stdio. It SHALL hold one ephemeral thread started in the host's working directory, with a read-only sandbox, the approval policy that asks before running anything that is not trusted, the host-supplied MCP server as the only MCP server with its tools pre-approved so that Terminay's own permission policy decides them, its browser, computer-use and app features off, and the host's instruction as developer instructions. It SHALL decline every command-execution, file-change and permission approval request the app server sends.

Each provider SHALL map its agent's streamed output to the platform's chat events: reply text deltas, tool activity with MCP server and tool names, and failures, and SHALL resolve each turn's prompt when the agent finishes it. Each SHALL cancel a turn through its protocol's own interrupt, and SHALL end the process when the session closes. The providers SHALL NOT depend on the session source or on any harness switch.

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

### Requirement: Built-in terminal launchers

The extension SHALL declare the `agent-launch` permission and two terminal launchers:

| Launcher | Display name | Harness |
|---|---|---|
| `com.terminay.builtin-agents/launch-claude-code` | Claude Code | `claude-code` |
| `com.terminay.builtin-agents/launch-codex` | Codex | `codex` |

Each launcher's `resolve` SHALL locate its agent executable the way its chat provider does, under "Locating the agent CLIs", and SHALL report available with that executable's absolute path, or `not_installed` when it is not found. The extension SHALL list Claude Code before Codex. It SHALL NOT pass the agent arguments, environment, or input, and SHALL NOT write to the agent's configuration.

#### Scenario: Claude Code installed

- **WHEN** the Claude Code harness is switched on and `claude` is installed in `~/.local/bin`
- **THEN** the Claude Code launcher is available and resolves to that executable's absolute path

#### Scenario: Codex not installed

- **WHEN** no `codex` executable can be found
- **THEN** the Codex launcher reports `not_installed` and is not offered

#### Scenario: Harness switched off

- **WHEN** the Claude Code harness is switched off
- **THEN** the Claude Code launcher is not offered, whether or not `claude` is installed

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
