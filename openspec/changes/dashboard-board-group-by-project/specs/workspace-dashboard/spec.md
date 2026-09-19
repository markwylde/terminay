## ADDED Requirements

### Requirement: Board grouping by project

While the Board view is selected the dashboard SHALL offer a "Group by project" control in the dashboard header, reachable by keyboard and stating whether grouping is on. The control SHALL NOT be offered in the List or Projects view. With grouping on, the Board SHALL keep its four status columns — Needs you, Working, Done, and Idle — and SHALL band them into one lane per project, in the window's tab order, each lane naming its project and, when more than one connection is attached, the server that owns it. A lane SHALL hold exactly the cards the ungrouped Board presents for that project, each under the column the ungrouped Board places it in: grouping SHALL NEVER add, remove, or re-classify a card. Two projects on different servers SHALL NEVER share a lane. A project with nothing in any column MAY be given no lane. Activating a lane's heading SHALL activate that project.

Whether the Board is grouped SHALL be per-device presentation state, SHALL NEVER be written to server-owned workspace state, and SHALL be remembered across reconnects. That memory SHALL be a hint: when it cannot be read, or when device storage is unavailable, the Board SHALL be ungrouped and SHALL report no error.

#### Scenario: Grouping the Board
- **WHEN** a user on the Board view turns on "Group by project" in a workspace with agents in two projects
- **THEN** the Board shows one lane per project, each holding that project's cards under the Needs you, Working, Done, and Idle columns

#### Scenario: Grouping changes no card
- **WHEN** the Board is switched between grouped and ungrouped
- **THEN** the same cards are presented in both, each under the same status column

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
