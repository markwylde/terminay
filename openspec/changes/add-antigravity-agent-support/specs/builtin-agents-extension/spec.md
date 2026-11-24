## MODIFIED Requirements

### Requirement: Supported harnesses

The extension SHALL declare one session source with five harnesses. Each harness SHALL map to exactly one library provider:

| Harness | Library provider |
|---|---|
| Claude Code | `claude-code` |
| Codex | `codex-cli` |
| Grok | `grok-build` |
| oh-my-pi | `oh-my-pi` |
| Antigravity | `antigravity-cli` |

The library SHALL be started with only the providers whose harness is switched on. A change to the enabled set SHALL stop the library, restart it with the new provider set, and publish a reset of the live sessions. A session for a provider the extension does not map SHALL NOT be published.

#### Scenario: Only enabled harnesses run

- **WHEN** Grok is switched off
- **THEN** the library runs without the Grok provider and no Grok session is published

#### Scenario: Harness switched back on

- **WHEN** Grok is switched back on
- **THEN** the library restarts with the Grok provider and live Grok sessions are published in a reset

#### Scenario: Antigravity session observed

- **WHEN** the Antigravity harness is switched on and `agy` runs in a Terminay terminal
- **THEN** the library reports the session through its `antigravity-cli` provider and the extension publishes it under the Antigravity harness

### Requirement: Built-in MCP install targets

The extension SHALL contribute MCP install targets for Claude Code, Codex, Cursor CLI, Antigravity CLI, Grok, and OpenCode. Each target SHALL implement that client's user-wide registration contract, installation safety, and ambiguous-configuration rules exactly as the MCP server capability specifies, using the MCP server command the host supplies. The targets SHALL write configuration atomically. They SHALL NOT depend on the session source or on any harness switch.

#### Scenario: Harness switched off

- **WHEN** the Codex harness is switched off
- **THEN** the Codex MCP install target still reports status and can install and uninstall

#### Scenario: Install uses the host command

- **WHEN** a target installs the registration
- **THEN** the `terminay` entry it writes carries the executable, arguments, and environment the host supplied and nothing else

#### Scenario: Antigravity target independent of its harness

- **WHEN** the Antigravity harness is switched off
- **THEN** the Antigravity CLI MCP install target still reports status and can install and uninstall

### Requirement: Library sessions map to bounded snapshots

The extension SHALL publish only live library sessions: those with a `pid`. Each snapshot SHALL carry:

- the library session id and the mapped harness
- `pid` and `cwd`
- the effective title and `model`
- `status` and `waitingFor`, except that a library `waiting` whose `waitingFor` is `shell`, `monitor`, `task`, or `subagent` — a turn that ended while background work it started is still running — SHALL be `running` with no `waitingFor`, because no user input is requested
- the current tool name, the last-turn outcome and end time, and the bounded `activity.error`
- the session's subagents, each with its id, parent id, type, title, and status

`session:create`, `session:open`, `session:status`, `session:update`, `session:activity`, `subagent:start`, and `subagent:end` SHALL publish an upsert. `session:close` SHALL publish a removal. Catch-up events SHALL be collected and published as one reset when `ready` fires. Transcript, event-stream, and raw record content SHALL never be published. A library `error` event SHALL be reported as a typed extension diagnostic without paths or conversation content, and SHALL NOT stop the source.

#### Scenario: Catch-up at start

- **WHEN** the library starts with three live sessions and then emits `ready`
- **THEN** the extension publishes one reset containing those three sessions

#### Scenario: Session waits on a background shell

- **WHEN** the library reports a session `waiting` with `waitingFor` `shell`
- **THEN** the extension publishes it as `running` with no `waitingFor`

#### Scenario: Antigravity session waits on background work

- **WHEN** the library reports an Antigravity session `waiting` with `waitingFor` `task` or `subagent`
- **THEN** the extension publishes it as `running` with no `waitingFor`

#### Scenario: Antigravity session asks for approval

- **WHEN** the library reports an Antigravity session `waiting` with `waitingFor` `approval`
- **THEN** the extension publishes it as `waiting` with `waitingFor` `approval`

#### Scenario: Session closes

- **WHEN** the library emits `session:close`
- **THEN** the extension publishes a removal for that session id

#### Scenario: Historical session

- **WHEN** the library knows a session with no `pid`
- **THEN** it is not published

#### Scenario: Provider error

- **WHEN** the library emits a provider error
- **THEN** a typed diagnostic is recorded and other sessions continue to be published
