## ADDED Requirements

### Requirement: Claude Code runs without agent view in Terminay terminals

The built-in agents extension SHALL declare a terminal command default for the command `claude`, belonging to the Claude Code harness. Its resolution SHALL report that it applies, with the environment `CLAUDE_CODE_DISABLE_AGENT_VIEW=1` and no arguments, only when Claude Code is installed on the server account and the installed Claude Code, run as `claude agents --json` with that variable set, reports that it is disabled by `CLAUDE_CODE_DISABLE_AGENT_VIEW`. Otherwise it SHALL report that it does not apply. The extension SHALL learn whether Claude Code honours the variable only by running the installed executable that way, bounded in time and output, and SHALL NOT read or write Claude Code's settings or files to decide. It SHALL run that check again when the executable it resolves changes path, size, or modification time, and otherwise reuse its last result.

#### Scenario: Supporting Claude Code installed

- **WHEN** the Claude Code harness is on and the installed Claude Code refuses `claude agents --json` naming `CLAUDE_CODE_DISABLE_AGENT_VIEW`
- **THEN** the command default applies, and a new integrated terminal has `CLAUDE_CODE_DISABLE_AGENT_VIEW=1`, so a Claude Code conversation started there runs in that terminal's own process and controlling terminal

#### Scenario: Claude Code that ignores the variable

- **WHEN** the installed Claude Code answers `claude agents --json` without naming the variable
- **THEN** the command default does not apply and the terminal's environment is unchanged

#### Scenario: Claude Code not installed

- **WHEN** no Claude Code executable is found on the server account
- **THEN** the command default does not apply

#### Scenario: Claude Code harness switched off

- **WHEN** the user switches Claude Code off under Built-in Agents
- **THEN** the command default leaves the registry and new terminals do not receive the variable

#### Scenario: Claude Code updated

- **WHEN** the Claude Code executable is replaced with a different build
- **THEN** the next resolution runs the check again before reporting whether the default applies
