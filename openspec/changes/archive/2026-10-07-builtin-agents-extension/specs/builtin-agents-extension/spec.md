## ADDED Requirements

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
