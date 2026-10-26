## RENAMED Requirements

- FROM: `### Requirement: Recordings timeline entry point`
- TO: `### Requirement: Recordings section of Home`

## MODIFIED Requirements

### Requirement: Recordings section of Home

The recordings timeline SHALL be the **Recordings** section of Home, presented as a Home tab on every host. The Recordings command and its configurable accelerator SHALL select Home in the focused workspace and bring the Recordings tab to the front, opening it if needed. The section SHALL stay a list: replaying a recording SHALL open that replay in its own Home tab, titled with the recording's title, and SHALL leave the timeline as it was. Opening the same recording again SHALL bring its existing replay tab to the front. Closing a replay tab SHALL NOT delete the recording.

#### Scenario: Opening recordings

- **WHEN** a user invokes the Recordings command
- **THEN** Home is selected and the Recordings tab is in front, showing the timeline

#### Scenario: Replaying from the timeline

- **WHEN** a user replays a recording from the Recordings tab
- **THEN** the replay opens in a new Home tab in front and the Recordings tab is still open behind it, showing the timeline

#### Scenario: Replaying the same recording twice

- **WHEN** a user replays a recording whose replay tab is already open
- **THEN** that tab comes to the front and no second replay tab opens

#### Scenario: Closing a replay

- **WHEN** a user closes a replay tab
- **THEN** the recording is still listed in the timeline
