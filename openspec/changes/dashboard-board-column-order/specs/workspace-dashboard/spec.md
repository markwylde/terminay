## MODIFIED Requirements

### Requirement: Dashboard view modes

The dashboard SHALL offer exactly three view modes over one model — List, Board, and Projects — selectable from a control in the dashboard header that names the current mode and is reachable by keyboard. Every mode SHALL present the same facts, differing only in arrangement: a status, count, or name SHALL NEVER read one way in one mode and another way in another.

- **List** SHALL present every project as a header row followed by its panels, one unwrapped line each.
- **Board** SHALL present one column per canonical status group, in the reading order Idle, Working, Needs you, Done, each holding one card per agent, or per panel where no agent owns it, named with the project it belongs to. Board is a triage view and MAY omit a project that has nothing in a column.
- **Projects** SHALL present one card per project holding that project's panels and agents.

The selected mode SHALL be per-device presentation state, SHALL NEVER be written to server-owned workspace state, and SHALL be remembered across reconnects. That memory SHALL be a hint: when it cannot be read, or when device storage is unavailable, the dashboard SHALL show the List view and SHALL report no error.

#### Scenario: Switching mode

- **WHEN** a user selects a different view mode
- **THEN** the dashboard re-arranges into that mode over the same projects, panels, and agents

#### Scenario: Board column order

- **WHEN** the Board view is shown
- **THEN** its status columns read, from the start of the reading direction, Idle, Working, Needs you, Done

#### Scenario: Mode is remembered

- **WHEN** a device that last used the Board view reopens the dashboard
- **THEN** the Board view is shown

#### Scenario: Storage unavailable

- **WHEN** device storage is unavailable, full, or disabled
- **THEN** the dashboard shows the List view and reports no error

#### Scenario: Two devices, different modes

- **WHEN** one device selects the Board view while another shows the List view of the same workspace
- **THEN** each device keeps its own mode and neither changes the other

#### Scenario: Board column with nothing in it

- **WHEN** no agent or panel in the workspace is in a status group
- **THEN** that Board column is shown as empty rather than removed, and no project is claimed to be missing

### Requirement: Board grouping by project

While the Board view is selected the dashboard SHALL offer a "Group by project" control in the dashboard header, reachable by keyboard and stating whether grouping is on. The control SHALL NOT be offered in the List or Projects view. With grouping on, the Board SHALL keep its four status columns in the same order as the ungrouped Board — Idle, Working, Needs you, and Done — and SHALL band them into one lane per project, in the window's tab order, each lane naming its project and, when more than one connection is attached, the server that owns it. A lane SHALL hold exactly the cards the ungrouped Board presents for that project, each under the column the ungrouped Board places it in: grouping SHALL NEVER add, remove, or re-classify a card. Two projects on different servers SHALL NEVER share a lane. A project with nothing in any column MAY be given no lane. Activating a lane's heading SHALL activate that project.

Whether the Board is grouped SHALL be per-device presentation state, SHALL NEVER be written to server-owned workspace state, and SHALL be remembered across reconnects. That memory SHALL be a hint: when it cannot be read, or when device storage is unavailable, the Board SHALL be ungrouped and SHALL report no error.

#### Scenario: Grouping the Board
- **WHEN** a user on the Board view turns on "Group by project" in a workspace with agents in two projects
- **THEN** the Board shows one lane per project, each holding that project's cards under the Idle, Working, Needs you, and Done columns, in that order

#### Scenario: Grouping changes no card
- **WHEN** the Board is switched between grouped and ungrouped
- **THEN** the same cards are presented in both, each under the same status column, and the columns keep the same order

#### Scenario: Control is absent off the Board
- **WHEN** the List or Projects view is selected
- **THEN** no "Group by project" control is offered

#### Scenario: Activating a lane heading
- **WHEN** a user activates a lane's project heading
- **THEN** that project is selected and Home is left

#### Scenario: Grouping is remembered on this device
- **WHEN** a device that last grouped the Board reopens the dashboard on the Board view
- **THEN** the Board is grouped by project

#### Scenario: Unreadable grouping preference
- **WHEN** the remembered grouping cannot be read
- **THEN** the Board is ungrouped and no error is reported
