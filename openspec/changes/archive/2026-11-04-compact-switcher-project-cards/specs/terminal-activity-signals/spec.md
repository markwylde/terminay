## MODIFIED Requirements

### Requirement: Compact switcher activity presentation

Terminal rows in the unified compact switcher SHALL present activity using the same vocabulary and priority as the terminal tab, the header activity menu, the project tab badge, and the dashboard, so no surface reads a state differently. A row SHALL indicate `working`, `waiting`, `blocked`, and `done` under the same acknowledgement rules those surfaces use, and SHALL stay neutral for `idle`.

A project header SHALL carry a status summary counted from the states that project's own terminal rows present, so a header and the rows beneath it never disagree. The summary SHALL group terminals as needing the user (`waiting` or `blocked`), `working`, `done`, and `idle`, and SHALL state each non-empty group as a count followed by its word: `needs you` or `need you`, `working`, `done`, `idle`. Groups SHALL be ordered most urgent first, in that order, and the summary SHALL show at most the two most urgent non-empty groups. The most urgent group shown SHALL be drawn in the same colour its rows use for that state, and an `idle` group SHALL be drawn neutral. The summary SHALL count only terminals of that header's own project on its own server and SHALL NOT count file or folder panels. Its accessible text SHALL state every non-empty group, including any not shown.

#### Scenario: Row state matches the tab

- **WHEN** a terminal is `working` and its row and its tab are both visible
- **THEN** both indicate `working` with the same vocabulary

#### Scenario: Viewing clears the row indicator

- **WHEN** a terminal with an unacknowledged `done` entry is viewed
- **THEN** its switcher row indicator clears alongside its tab indicator

#### Scenario: Group heading carries the project badge

- **WHEN** a project has two working terminals
- **THEN** its switcher header reads `2 working` in the colour its working rows use, and shows no separate numeric badge

#### Scenario: Header summarises its rows

- **WHEN** a project has two working terminals and one idle terminal
- **THEN** its switcher header reads `2 working · 1 idle`

#### Scenario: Attention comes first

- **WHEN** a project has one terminal that is `waiting`, one that is `working`, and three that are `idle`
- **THEN** its header reads `1 needs you · 1 working`, and its accessible text also states the three idle terminals

#### Scenario: Summary follows acknowledgement

- **WHEN** a project's only non-idle terminal has an unacknowledged `done` entry and that terminal is viewed
- **THEN** the header stops counting it as `done` and counts it as `idle`, as its row does

#### Scenario: Same project id on two servers

- **WHEN** two attached servers each hold a project with the same id and only one of them has a working terminal
- **THEN** only that server's project header counts a working terminal
