## ADDED Requirements

### Requirement: Compact switcher panel rows

The compact switcher SHALL list every terminal, file, and folder panel of every project of every attached connection, grouped by connection and then by project. Each panel row SHALL name that panel and SHALL activate it on its own server when pressed, selecting that panel's project first when it is not the active one. A terminal row SHALL present that terminal's activity state and, where the window holds its live buffer, its most recent non-empty output line. A long press on a panel row SHALL open that panel's editor.

#### Scenario: File and folder panels appear as rows
- **WHEN** a project holds a terminal, a file panel, and a folder panel
- **THEN** the switcher lists a row for each under that project

#### Scenario: Activating a file in a background project
- **WHEN** a user presses a file row belonging to a project that is not active
- **THEN** that project becomes active on its own server and that file panel becomes the active panel

### Requirement: Compact switcher closing

Each panel row in the compact switcher SHALL carry a close control that closes that panel through the same path and close-protection as a panel tab. Each project group heading SHALL carry a close control that closes that project through the same path and close-protection as a project tab. Closing a panel or a project SHALL leave the switcher open. Closing the last panel in a project SHALL close the project. Close protection SHALL still ask whether to **Close Terminal** or **Keep Running** when that terminal's PTY has a non-shell foreground process, and SHALL still ask whether to **Close Project** or **Keep Running** when a project has such a terminal.

#### Scenario: Closing a terminal from the switcher
- **WHEN** a user presses the close control on a terminal row
- **THEN** that terminal closes and the switcher stays open

#### Scenario: Closing a file from the switcher
- **WHEN** a user presses the close control on a file row
- **THEN** that file panel closes and the switcher stays open

#### Scenario: Closing a busy terminal from the switcher
- **WHEN** a user presses the close control on a terminal whose PTY has a non-shell foreground process
- **THEN** Terminay asks whether to Close Terminal or Keep Running before terminating it

#### Scenario: Closing a project from the switcher
- **WHEN** a user presses the close control on a project group heading whose terminals are all at their shell prompts
- **THEN** that project closes and the switcher stays open

#### Scenario: Closing the last panel closes the project
- **WHEN** a user closes the last remaining panel of a project from the switcher
- **THEN** the project closes
