## ADDED Requirements

### Requirement: A terminal's activity follows the agent running in it

A terminal SHALL carry the activity of one agent at a time. While the agent that holds a terminal is working, waiting, or blocked, an update that names a different agent or a different provider SHALL be ignored. Once the holding agent has finished or is idle, an update from a different agent or provider SHALL be accepted and that agent SHALL hold the terminal from then on, so that its working, finished, waiting, and blocked states drive the terminal's indicator and notifications exactly as the first agent's did.

#### Scenario: A new chat after a finished one

- **WHEN** an agent chat has finished in a terminal and a new chat is started in the same terminal
- **THEN** the terminal shows the new chat as working, and its finish raises a finished indicator and a notification

#### Scenario: Another agent while the first is working

- **WHEN** an agent is working in a terminal and an update arrives that names a different agent
- **THEN** the update is ignored and the terminal keeps the working agent's state

#### Scenario: A different harness in an idle terminal

- **WHEN** one harness's agent is idle in a terminal and another harness's agent starts working there
- **THEN** the terminal shows the second agent as working
