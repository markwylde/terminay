## ADDED Requirements

### Requirement: Launch and resume text is submitted with a separate Enter

The Enter that submits a workflow's launch or resume text SHALL be written to the terminal on its own, after a short pause following the paste, and never in the same write as the paste, so the agent in the terminal submits the text instead of adding a newline to it.

#### Scenario: Launching into an agent

- **WHEN** a workflow is launched into a terminal running Claude Code
- **THEN** the launch text is written as one paste, a carriage return follows in a later write, and Claude Code starts working on it
