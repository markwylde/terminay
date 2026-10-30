## ADDED Requirements

### Requirement: Codex runs without the shared background server in Terminay terminals

The built-in agents extension SHALL declare a terminal command default for the command `codex`, belonging to the Codex harness, and SHALL request the `terminal-command-defaults` permission. Its resolution SHALL report that it applies, with the single argument `--no-daemon`, only when Codex is installed on the server account and the installed Codex's help output lists the `--no-daemon` option. Otherwise it SHALL report that it does not apply. The extension SHALL learn whether Codex supports the option only by running the installed executable with `--help`, bounded in time and output, and SHALL NOT read or write Codex's configuration or files to decide. It SHALL re-run that check when the executable it resolves changes path, size, or modification time, and otherwise reuse its last result.

#### Scenario: Supported Codex installed

- **WHEN** the Codex harness is on and the installed Codex's `--help` lists `--no-daemon`
- **THEN** the command default applies with `--no-daemon`, and a new integrated terminal running `codex` starts Codex with its conversation in that terminal's own Codex process

#### Scenario: Codex without the option

- **WHEN** the installed Codex's `--help` does not list `--no-daemon`
- **THEN** the command default does not apply and `codex` runs unchanged

#### Scenario: Codex not installed

- **WHEN** no Codex executable is found on the server account
- **THEN** the command default does not apply

#### Scenario: Codex harness switched off

- **WHEN** the user switches Codex off under Built-in Agents
- **THEN** the command default leaves the registry and new terminals run `codex` unchanged

#### Scenario: Codex updated

- **WHEN** the Codex executable is replaced with a different build
- **THEN** the next resolution runs `--help` again before reporting whether the default applies

#### Scenario: Help check fails

- **WHEN** `codex --help` exits with an error, times out, or exceeds the output bound
- **THEN** the command default does not apply
