## ADDED Requirements

### Requirement: Sidebar panes of a project with no root folder

For a project with no root folder, the Explorer, Git, and Documentation panes SHALL each show a "No root folder" state that offers to open a folder, and SHALL issue no filesystem, watch, Git, or Documentation query for that project. Opening a folder from that state SHALL open the server-side folder browser and, once a folder is chosen, the project SHALL take it as its root. The Agents pane and terminal-scoped features SHALL work as for any project. A project awaiting a start choice SHALL show no sidebar content.

#### Scenario: Explorer of a no-root project

- **WHEN** a project with no root folder is shown
- **THEN** the Explorer shows "No root folder" with an action to open a folder, and no directory listing or watch is requested

#### Scenario: Git and Documentation of a no-root project

- **WHEN** the Git or Documentation pane of a project with no root folder is shown
- **THEN** it shows "No root folder" rather than "Not a git repository" or an error, and issues no query

#### Scenario: Opening a folder from the empty state

- **WHEN** the user chooses to open a folder from a no-root pane and picks a folder
- **THEN** the project's root becomes that folder and the Explorer, Git, and Documentation panes present it

#### Scenario: Sidebar while awaiting a start choice

- **WHEN** a project awaits a start choice
- **THEN** its sidebar shows no Explorer, Git, Documentation, or Agents content
