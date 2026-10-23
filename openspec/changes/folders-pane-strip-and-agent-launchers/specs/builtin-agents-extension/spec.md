## ADDED Requirements

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
