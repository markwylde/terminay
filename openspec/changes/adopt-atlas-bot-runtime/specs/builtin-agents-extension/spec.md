## ADDED Requirements

### Requirement: Built-in native CLI bot agents

The extension SHALL contribute stable Claude Code and Codex bot ids using supported native drivers and exact public CLI pins, with valid models, credentials and bot config. The host SHALL own execution. Claude SHALL offer guided login, setup token, API key and both approval modes; Codex SHALL offer guided login/API key and Autonomous only. Selected credentials SHALL take precedence. Default SHALL defer model choice to the CLI. Detection/chat switches SHALL NOT govern bot availability.

#### Scenario: Chosen model

- **WHEN** a user selects a listed model and starts a bot execution
- **THEN** the pinned CLI runs with that model and diagnostics record it

#### Scenario: Detection disabled

- **WHEN** a Codex detection harness is switched off
- **THEN** its bot agent remains available

#### Scenario: Guided sign-in

- **WHEN** a user chooses either built-in agent's guided sign-in
- **THEN** its pinned CLI performs login inside that bot's persistent home and its next execution uses that login without host credential access

### Requirement: Native bot drivers have executable compatibility evidence

Each built-in driver SHALL prove streaming, model selection, MCP/tool use, explicit posting, authentication failure, cancellation/cleanup, token non-persistence and shell exclusion in the bot image. Claude SHALL prove approval/rejection and races. Guided login/logout SHALL be verified against the pinned CLI per supported architecture. Bot tasks SHALL NOT execute a native CLI on the host.

#### Scenario: CLI version changes

- **WHEN** a built-in CLI pin changes
- **THEN** its executable compatibility checks pass in the bot image before that version is declared available

#### Scenario: Saved bot agent ids

- **WHEN** a saved profile names `com.terminay.builtin-agents/claude-code` or `com.terminay.builtin-agents/codex`
- **THEN** it resolves to the corresponding native bot agent without rewriting its identity
