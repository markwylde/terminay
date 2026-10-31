## ADDED Requirements

### Requirement: Terminal rows take their tab's colour

A terminal's row in the Folders tree SHALL be drawn in that terminal's tab colour. The active terminal's row SHALL be filled as that terminal's tab is filled when active, so the two highlights match. A terminal row whose tab colour differs from its project's colour SHALL carry that colour as an edge on its leading side while it is not the active row. A terminal row in its project's colour SHALL carry no edge.

#### Scenario: Active row matches its tab

- **WHEN** a terminal coloured green in a purple project is the focused terminal
- **THEN** its row is filled with the same green fill as its active tab, not the project's purple

#### Scenario: Inactive row coloured apart from its project

- **WHEN** a terminal coloured green in a purple project is not the focused terminal
- **THEN** its row carries a green edge on its leading side and no fill

#### Scenario: Inactive row in the project's colour

- **WHEN** a terminal in the project's colour is not the focused terminal
- **THEN** its row carries no edge and no fill
