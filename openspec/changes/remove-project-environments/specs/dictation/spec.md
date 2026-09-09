## ADDED Requirements

### Requirement: Server binding for transcript insertion

The PTY input path SHALL resolve the terminal's canonical server binding. Dictation SHALL NOT connect to a project host itself, change server selection, or fall back to another PTY when the target terminal's session is unavailable.

#### Scenario: Transcript reaches the owning server

- **WHEN** a transcript is inserted into the target terminal
- **THEN** it is written through the input path of the server that owns that terminal

#### Scenario: Target session unavailable

- **WHEN** the target terminal's session is unavailable
- **THEN** the write fails and dictation does not fall back to another PTY

## REMOVED Requirements

### Requirement: Environment binding for transcript insertion

**Reason:** A terminal belongs to the server that owns its project, so transcript insertion resolves a server binding rather than an environment binding.

**Migration:** None. The surviving rule is stated by "Server binding for transcript insertion".
