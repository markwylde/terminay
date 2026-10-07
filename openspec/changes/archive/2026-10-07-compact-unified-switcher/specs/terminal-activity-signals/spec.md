## ADDED Requirements

### Requirement: Compact switcher activity presentation

Terminal rows in the unified compact switcher SHALL present activity using the same vocabulary and priority as the terminal tab, the header activity menu, the project tab badge, and the dashboard, so no surface reads a state differently. A row SHALL indicate `working`, `waiting`, `blocked`, and `done` under the same acknowledgement rules those surfaces use, and SHALL stay neutral for `idle`. A project group heading SHALL carry that project's activity count badge with the same count, colour, and zero-hiding behaviour as that project's tab.

#### Scenario: Row state matches the tab

- **WHEN** a terminal is `working` and its row and its tab are both visible
- **THEN** both indicate `working` with the same vocabulary

#### Scenario: Viewing clears the row indicator

- **WHEN** a terminal with an unacknowledged `done` entry is viewed
- **THEN** its switcher row indicator clears alongside its tab indicator

#### Scenario: Group heading carries the project badge

- **WHEN** a project has two working terminals
- **THEN** its switcher group heading shows the same amber badge reading `2` that its project tab shows

### Requirement: Compact switcher preview line

A terminal row SHALL show a preview line beneath its title when this window holds that terminal's rendered buffer, taken as the most recent non-empty line of that buffer and truncated to one line. The preview SHALL be a read of what this window already renders and SHALL NOT be requested from the server, SHALL NOT be persisted, and SHALL NOT be treated as activity authority. A row whose terminal has no rendered buffer in this window SHALL show no preview line rather than a placeholder, and SHALL remain fully operable.

#### Scenario: Preview from the rendered buffer

- **WHEN** a terminal rendered in this window has produced output
- **THEN** its row shows the most recent non-empty line of that output, truncated to one line

#### Scenario: No buffer, no preview

- **WHEN** a terminal has no rendered buffer in this window
- **THEN** its row shows no preview line and still activates that terminal when pressed

#### Scenario: Preview never becomes authority

- **WHEN** a preview line is shown for a terminal
- **THEN** the terminal's activity state still comes from the activity projection and the preview changes no state
