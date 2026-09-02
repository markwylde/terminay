## ADDED Requirements

### Requirement: Ambiguous or unsupported provider configuration

When a provider supports multiple user configuration filenames, Terminay SHALL use the existing supported file without creating a competing file. If more than one candidate exists and there is no unambiguous provider precedence contract, Terminay SHALL report the registration unavailable for review. Unsupported syntax, including a configuration dialect Terminay cannot safely round-trip, SHALL also be reported as unavailable without rewriting the file.

#### Scenario: Multiple candidate files

- **WHEN** more than one candidate user configuration file exists with no unambiguous provider precedence contract
- **THEN** the registration is reported unavailable for review and no competing file is created

#### Scenario: Unsupported dialect

- **WHEN** the configuration uses a dialect Terminay cannot safely round-trip
- **THEN** the registration is reported unavailable and the file is not rewritten

### Requirement: Independent per-provider status and action routing

Each supported client SHALL appear as its own row reporting its actual user-level configuration path and one of the exact, absent, changed, or unavailable states. An operation on one row SHALL NOT read, write, or otherwise mutate another provider's configuration file or state. Install and uninstall SHALL be idempotent, and SHALL refuse to overwrite or delete a `terminay` entry that differs from the one Terminay wrote. Every write SHALL be atomic, and malformed or unsupported configuration SHALL be rejected without partial mutation.

#### Scenario: One row's action is isolated

- **WHEN** the user installs or uninstalls the registration for one client
- **THEN** only that client's configuration file and status change

#### Scenario: Changed entry is protected

- **WHEN** an existing `terminay` entry differs from the entry Terminay wrote
- **THEN** install and uninstall refuse to replace or remove it and report the changed state

#### Scenario: Repeated install is idempotent

- **WHEN** install runs again against a configuration that already holds the exact entry
- **THEN** the file content is unchanged and the status stays exact

#### Scenario: Unrelated configuration survives

- **WHEN** Terminay writes a registration into a file holding unrelated settings
- **THEN** those settings are preserved and the write is atomic

### Requirement: Cursor CLI, Gemini CLI, and OpenCode registration contracts

Terminay SHALL register each additional client in its supported user-wide scope so the adapter is available to agents launched from any Terminay project, without changing the existing Claude Code and Codex registrations. Cursor CLI SHALL use the `terminay` entry in `mcpServers` in `~/.cursor/mcp.json`, shared with Cursor's user-level MCP configuration, carrying the packaged stdio command, its arguments, and any required launch environment. Gemini CLI SHALL use the `terminay` entry in `mcpServers` in the user settings file `~/.gemini/settings.json`, without setting `trust` and without altering its allow or exclude policy. OpenCode SHALL use the `terminay` local server in `mcp` in the active stable user configuration under `~/.config/opencode/`, using a command array and no trust or permission override.

#### Scenario: Existing clients are unchanged

- **WHEN** the additional adapters are added
- **THEN** the Claude Code and Codex registration contracts are unchanged

#### Scenario: Cursor CLI registration

- **WHEN** Terminay registers with Cursor CLI
- **THEN** it writes the `terminay` entry in `mcpServers` in `~/.cursor/mcp.json` with the packaged stdio command, arguments, and any required launch environment

#### Scenario: OpenCode registration

- **WHEN** Terminay registers with OpenCode
- **THEN** it writes the `terminay` local server in `mcp` under `~/.config/opencode/` using a command array and no trust or permission override

#### Scenario: Gemini confirmation policy

- **WHEN** Terminay registers with Gemini CLI
- **THEN** the entry retains Gemini's normal per-tool confirmation policy and neither sets `trust` nor changes the allow or exclude policy
