## ADDED Requirements

### Requirement: Sessions settle before fallback finished activity

A terminal session SHALL be considered settled once it has received user input or a structured command-executing or progress-busy marker. Until a session is settled, raw output, foreground busy-to-idle transitions, and a command-finished marker without a preceding command-executing marker SHALL NOT clear acknowledgement and therefore SHALL NOT produce the finished indicator. Working status SHALL still be derived from that evidence so the active indicator stays accurate during shell start-up. Bell and notification attention SHALL be unaffected by settlement. Provider-backed agent state SHALL be unaffected by settlement.

#### Scenario: Shell start-up noise on an unviewed terminal

- **WHEN** a new terminal prints its prompt and its start-up child processes exit without any user input
- **THEN** the session remains acknowledged and no finished indicator appears

#### Scenario: First command after typing

- **WHEN** a user types a command into a new terminal and output later stops
- **THEN** the session is settled and the finished indicator appears as usual

#### Scenario: Lone finished marker at the first prompt

- **WHEN** a shell integration emits a command-finished marker at its first prompt with no prior command-executing marker and no user input
- **THEN** the session remains acknowledged

#### Scenario: Structured marker settles without typing

- **WHEN** a session receives a command-executing or progress-busy marker before any user input
- **THEN** the session is settled and the following completion produces the finished indicator

#### Scenario: Bell before settlement

- **WHEN** an unfocused, unsettled terminal rings a bell
- **THEN** fallback attention is still set
