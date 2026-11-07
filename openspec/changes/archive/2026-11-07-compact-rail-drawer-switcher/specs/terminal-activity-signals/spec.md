## MODIFIED Requirements

### Requirement: Compact switcher activity presentation

Terminal rows in the unified compact switcher SHALL present activity using the same vocabulary and priority as the terminal tab, the header activity menu, the project tab badge, and the dashboard, so no surface reads a state differently. A row SHALL indicate `working`, `waiting`, `blocked`, and `done` under the same acknowledgement rules those surfaces use, and SHALL stay neutral for `idle`. A row's activity indicator SHALL be drawn distinct from the workflow dial, so a working terminal is never mistaken for workflow progress.

The panel header of a presented project SHALL carry a status summary counted from the states that project's own terminal rows present, so a header and the rows beneath it never disagree. The summary SHALL group terminals as needing the user (`waiting` or `blocked`), `working`, `done`, and `idle`, and SHALL state each non-empty group as a count followed by its word: `needs you` or `need you`, `working`, `done`, `idle`. Groups SHALL be ordered most urgent first, in that order, and the summary SHALL show at most the two most urgent non-empty groups. The most urgent group shown SHALL be drawn in the same colour its rows use for that state, and an `idle` group SHALL be drawn neutral. The project's rail item SHALL carry a badge counted from the same states: the count needing the user when non-zero, otherwise the working count when non-zero, otherwise no badge. The summary and the badge SHALL count only terminals of that project on its own server and SHALL NOT count file or folder panels. The summary's accessible text SHALL state every non-empty group, including any not shown.

#### Scenario: Row state matches the tab

- **WHEN** a terminal is `working` and its row and its tab are both visible
- **THEN** both indicate `working` with the same vocabulary

#### Scenario: Viewing clears the row indicator

- **WHEN** a terminal with an unacknowledged `done` entry is viewed
- **THEN** its switcher row indicator clears alongside its tab indicator

#### Scenario: Group heading carries the project badge

- **WHEN** a project has two working terminals
- **THEN** its panel header reads `2 working` in the colour its working rows use, and its rail item shows a badge of 2 in the working colour

#### Scenario: Header summarises its rows

- **WHEN** a project has two working terminals and one idle terminal
- **THEN** its panel header reads `2 working · 1 idle`

#### Scenario: Attention comes first

- **WHEN** a project has one terminal that is `waiting`, one that is `working`, and three that are `idle`
- **THEN** its panel header reads `1 needs you · 1 working`, its accessible text also states the three idle terminals, and its rail item shows a badge of 1 in the attention colour

#### Scenario: Summary follows acknowledgement

- **WHEN** a project's only non-idle terminal has an unacknowledged `done` entry and that terminal is viewed
- **THEN** the header stops counting it as `done` and counts it as `idle`, as its row does

#### Scenario: Same project id on two servers

- **WHEN** two attached servers each hold a project with the same id and only one of them has a working terminal
- **THEN** only that server's rail item and panel header count a working terminal

### Requirement: Compact switcher preview line

A terminal row with no attached workflow SHALL show a preview line beneath its title when this window holds that terminal's rendered buffer, taken as the most recent non-empty line of that buffer and truncated to one line. A terminal row with an attached workflow SHALL show the workflow's current step there instead. The preview SHALL be a read of what this window already renders and SHALL NOT be requested from the server, SHALL NOT be persisted, and SHALL NOT be treated as activity authority. A row whose terminal has no rendered buffer in this window and no workflow SHALL show no second line rather than a placeholder, and SHALL remain fully operable.

#### Scenario: Preview from the rendered buffer

- **WHEN** a terminal with no workflow, rendered in this window, has produced output
- **THEN** its row shows the most recent non-empty line of that output, truncated to one line

#### Scenario: No buffer, no preview

- **WHEN** a terminal with no workflow has no rendered buffer in this window
- **THEN** its row shows no second line and still activates that terminal when pressed

#### Scenario: Preview never becomes authority

- **WHEN** a preview line is shown for a terminal
- **THEN** the terminal's activity state still comes from the activity projection and the preview changes no state
