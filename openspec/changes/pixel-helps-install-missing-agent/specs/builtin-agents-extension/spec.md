## MODIFIED Requirements

### Requirement: Locating the agent CLIs

Each provider SHALL locate its agent executable on the server account in this order:

1. an absolute path set in `TERMINAY_CLAUDE_CODE_COMMAND` or `TERMINAY_CODEX_COMMAND`;
2. the server environment's `PATH`;
3. the PATH that the account's login shell reports, read once per extension activation with a bounded timeout;
4. the agent's documented per-user install locations, including Node version manager directories, newest first.

A located executable SHALL be remembered for the extension activation. An executable that is not found SHALL NOT be remembered: the next request SHALL search again, so an agent installed while Terminay runs is found without a restart.

A provider whose executable is not found SHALL report `not_installed`, with a detail that names the agent's official install guide and its override variable. A provider whose agent reports that it is not signed in SHALL report `not_signed_in`, and the agent's error SHALL name the sign-in command (`claude` or `codex login`). A located executable SHALL be invoked directly, never through a shell.

#### Scenario: Desktop launched from the Dock

- **WHEN** Terminay Desktop is launched from the Dock, `claude` is installed only in `~/.local/bin`, and the server environment's PATH lacks that directory
- **THEN** the Claude Code provider finds `claude` through the login shell PATH or the per-user install location, and reports available

#### Scenario: Codex not installed

- **WHEN** no `codex` executable can be found
- **THEN** the Codex provider reports `not_installed`

#### Scenario: Installed while running

- **WHEN** the Claude Code provider reported `not_installed` and the user then installs `claude` into a searched location
- **THEN** the next availability request finds it and reports available
