## MODIFIED Requirements



### Requirement: Initial terminal in every project

A started user-created project SHALL receive one terminal through the server's normal terminal-launch resolver as an explicit creation flow, never a renderer repair for an empty workspace. A project awaiting a start choice SHALL have no terminal, and its first terminal SHALL be launched by its start choice. After a Local Desktop restart, each restored started project SHALL keep its terminal panels and SHALL receive no additional terminal when it already has one. A restored started project without a terminal panel SHALL receive one fresh terminal. Each restored project awaiting a start choice SHALL show its chooser and receive no terminal. The project tab SHALL show a spinner while a user-created project is still loading.

#### Scenario: Restart restores projects
- **WHEN** Local Desktop restarts with saved started projects
- **THEN** each restored started project keeps its terminal panels and receives no additional terminal when it already has one

#### Scenario: Restart restores a project awaiting a choice
- **WHEN** Local Desktop restarts with a saved project that awaits a start choice
- **THEN** the project shows its start chooser and no terminal is launched for it

#### Scenario: Loading indication
- **WHEN** a project's creation is still loading
- **THEN** its tab shows a spinner
