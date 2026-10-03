## MODIFIED Requirements

### Requirement: Initial terminal in every project

A successful user-created project SHALL receive one terminal through the server's normal terminal-launch resolver as an explicit creation flow, never a renderer repair for an empty workspace. After a Local Desktop restart, each restored project SHALL keep its terminal panels, and a restored project that has no terminal panel SHALL receive one fresh terminal so a project is never shown empty. The project tab SHALL show a spinner while a user-created project is still loading.

#### Scenario: Restart restores projects
- **WHEN** Local Desktop restarts with saved projects that have terminal panels
- **THEN** each restored project shows its own terminal panels and receives no additional terminal

#### Scenario: Restart with a project that has no terminal
- **WHEN** Local Desktop restarts with a saved project that has no terminal panel
- **THEN** that project receives one fresh terminal

#### Scenario: Loading indication
- **WHEN** a project's creation is still loading
- **THEN** its tab shows a spinner
