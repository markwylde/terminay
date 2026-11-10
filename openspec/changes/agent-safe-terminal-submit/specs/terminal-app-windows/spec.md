## ADDED Requirements

### Requirement: A window message is submitted with a separate Enter

The Enter that submits a window message SHALL be written to the owning terminal on its own, after a short pause following the message's paste, and never in the same write as the paste, so an agent CLI reading its own keyboard submits the message instead of adding a newline to it.

#### Scenario: Message to an agent

- **WHEN** a view sends "Deploy api to eu-west-1" to a terminal running an agent CLI
- **THEN** the terminal receives the text in one write and a carriage return in a later write, and the agent submits the message
