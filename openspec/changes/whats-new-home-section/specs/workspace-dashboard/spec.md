## MODIFIED Requirements

### Requirement: Home sidebar sections

While Home is selected, the workspace SHALL offer a Home sidebar that lists its sections in this order: **Home**, **What's New**, **Tabs**, **Bots**, **Automations**, **Workflows**, **Recordings**, **Pull Requests**, and **Issues**. Pull Requests and Issues SHALL be listed only where a forge source serves them; every other section SHALL always be listed.

Activating a section SHALL open it as a Home tab, or bring its tab to the front where one is already open, so that no section is ever open twice. The sidebar SHALL show as current the section that owns the Home tab in front, and SHALL show none as current when no Home tab is open. A tab opened from within a section SHALL count as belonging to that section; for example, a bot's tab belongs to Bots, an automation's tab to Automations, and a recording's replay to Recordings.

The Home sidebar SHALL NOT show any project's Explorer, Documentation, Agents, or Git panes, and a project's sidebar SHALL NOT show the Home sections. The sidebar items SHALL be reachable by keyboard, and SHALL expose the current section to assistive technology.

#### Scenario: Choosing a section

- **WHEN** a user activates Tabs in the Home sidebar and no Tabs tab is open
- **THEN** a Tabs tab opens in front and Tabs is shown as current

#### Scenario: Section already open

- **WHEN** a user activates Automations in the Home sidebar while an Automations tab is open behind another tab
- **THEN** that tab comes to the front and no second Automations tab opens

#### Scenario: Current section follows the tab in front

- **WHEN** a user brings an automation's tab to the front
- **THEN** the sidebar shows Automations as current

#### Scenario: Bot tab belongs to Bots

- **WHEN** a user brings a bot's tab to the front
- **THEN** the sidebar shows Bots as current

#### Scenario: Section remembered

- **WHEN** a device that last had the Automations tab in front selects Home again, or reconnects with Home selected
- **THEN** the Automations tab is in front and the sidebar shows Automations as current

#### Scenario: Storage unavailable

- **WHEN** device storage is unavailable, full, or disabled
- **THEN** Home opens with the Home section's tab, the sidebar shows Home as current, and no error is reported

#### Scenario: Sidebars do not mix

- **WHEN** a user moves between Home and a project
- **THEN** Home shows only its own sections and the project shows only its own sidebar panes

#### Scenario: Replay belongs to Recordings

- **WHEN** a user brings a recording's replay tab to the front
- **THEN** the sidebar shows Recordings as current

#### Scenario: Workflows sits between Automations and Recordings

- **WHEN** a user selects Home
- **THEN** the sidebar lists Workflows directly after Automations and directly before Recordings

#### Scenario: Section order without a forge source

- **WHEN** a user selects Home in a window that no forge source serves
- **THEN** the sidebar lists Home, What's New, Tabs, Bots, Automations, Workflows, and Recordings in that order

#### Scenario: Section order with a forge source

- **WHEN** a user selects Home in a window that a forge source serves
- **THEN** the sidebar lists Home, What's New, Tabs, Bots, Automations, Workflows, Recordings, Pull Requests, and Issues in that order
