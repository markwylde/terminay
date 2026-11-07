## ADDED Requirements

### Requirement: Output that follows a resize is not raw-output activity

In the raw-output tier, PTY output that arrives within one second of a PTY resize the server applied to that session SHALL NOT count as raw-output activity: it SHALL neither begin nor extend `working`, SHALL NOT clear acknowledgement, and SHALL NOT publish an activity event. A resize SHALL NOT itself be user input: it SHALL NOT settle a session, acknowledge it, or clear attention. Output that arrives one second or more after the most recent resize SHALL count as raw output otherwise does. `working` derived from active progress, an executing shell command, foreground-process evidence, or a provider-backed agent SHALL be unaffected by how recently the terminal was resized.

#### Scenario: Prompt redrawn after a resize

- **WHEN** a settled terminal idle at a shell prompt is resized and the shell redraws its prompt
- **THEN** the terminal stays idle and acknowledged
- **AND** no finished indicator or notification appears for it

#### Scenario: Output continues after the resize window

- **WHEN** a terminal in the raw-output tier is resized and output is still arriving one second after the resize
- **THEN** the terminal is working when that output arrives

#### Scenario: Resize does not acknowledge

- **WHEN** a terminal with a finished or attention indicator is resized
- **THEN** the indicator remains
