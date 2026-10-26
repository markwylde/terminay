## MODIFIED Requirements

### Requirement: Home sidebar sections

While Home is selected the workspace SHALL offer a Home sidebar that lists exactly four sections, in this order: **Home**, **Tabs**, **Automations**, and **Recordings**. Activating a section SHALL open it as a Home tab, or bring its tab to the front where one is already open, so that no section is ever open twice. The sidebar SHALL show as current the section that the Home tab in front belongs to, and SHALL show none as current when no Home tab is open. A tab opened from within a section, such as an automation or a recording's replay, SHALL count as belonging to that section. The Home sidebar SHALL NOT show any project's Explorer, Documentation, Agents, or Git panes, and a project's sidebar SHALL NOT show the Home sections. The sidebar items SHALL be reachable by keyboard and SHALL expose the current section to assistive technology.

#### Scenario: Choosing a section

- **WHEN** a user activates Tabs in the Home sidebar and no Tabs tab is open
- **THEN** a Tabs tab opens in front and Tabs is shown as current

#### Scenario: Section already open

- **WHEN** a user activates Automations in the Home sidebar while an Automations tab is open behind another tab
- **THEN** that tab comes to the front and no second Automations tab opens

#### Scenario: Current section follows the tab in front

- **WHEN** a user brings an automation's tab to the front
- **THEN** the sidebar shows Automations as current

#### Scenario: Section remembered

- **WHEN** a device that last had the Automations tab in front selects Home again, or reconnects with Home selected
- **THEN** the Automations tab is in front and the sidebar shows Automations as current

#### Scenario: Storage unavailable

- **WHEN** device storage is unavailable, full, or disabled
- **THEN** Home opens with the Home section's tab, the sidebar shows Home as current, and no error is reported

#### Scenario: Sidebars do not mix

- **WHEN** a user moves between Home and a project
- **THEN** Home shows only its four sections and the project shows only its own sidebar panes

#### Scenario: Replay belongs to Recordings

- **WHEN** a user brings a recording's replay tab to the front
- **THEN** the sidebar shows Recordings as current

### Requirement: Home with no tabs open

When every Home tab is closed, Home SHALL show an empty state that names the four sections and opens the one a user activates. Home SHALL remain the selected view, and the Home sidebar SHALL remain available.

#### Scenario: Closing the last tab

- **WHEN** a user closes the only Home tab
- **THEN** Home stays selected and shows an empty state offering Home, Tabs, Automations, and Recordings

#### Scenario: Opening from the empty state

- **WHEN** a user activates Automations in the empty state
- **THEN** the Automations tab opens in front

### Requirement: Home tabs

Home SHALL present its content as tabs in a tab strip of its own, drawn where a project draws its panel tab strip and managed the same way: a user SHALL be able to open several Home tabs, bring any to the front, close any, reorder them by dragging, and arrange them side by side or stacked by dragging a tab to an edge. Each Home tab SHALL carry a title naming what it shows and a close control. Closing a Home tab SHALL close only that tab and SHALL NEVER close, stop, or delete the project, automation, run, recording, or terminal it shows. Home tabs SHALL NOT be movable into a project, and project panels SHALL NOT be movable into Home.

#### Scenario: Two tabs side by side

- **WHEN** a user drags the Automations tab to the right edge of Home while the Tabs tab is open
- **THEN** both are shown side by side, each in its own tab strip

#### Scenario: Reordering

- **WHEN** a user drags a Home tab past its neighbour in the tab strip
- **THEN** the two tabs swap places and the tab in front does not change

#### Scenario: Closing a tab

- **WHEN** a user closes a Home tab showing an automation's run
- **THEN** the tab closes and the run is still in that automation's history

#### Scenario: Home and projects stay apart

- **WHEN** a user drags a Home tab over a project tab on the project bar
- **THEN** the tab stays in Home and the project is unchanged

