## MODIFIED Requirements

### Requirement: Home sidebar sections

While Home is selected, the workspace SHALL offer a Home sidebar that lists these sections, in this order: **Home**, **Tabs**, **Bots**, **Automations**, **Workflows**, **Recordings**, **Pull Requests**, and **Issues**. **Pull Requests** SHALL be listed only while at least one enabled forge source serves pull requests with its Pull requests on Home setting on, and **Issues** only while one serves issues with its Issues on Home setting on. Both SHALL be hidden from a client whose authorization is bound to a project. **Pull Requests** SHALL carry a count of open pull requests that request the user's review, and **Issues** a count of open issues assigned to the user, each drawn in the neutral badge tone and omitted when zero or unknown.

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
- **THEN** the sidebar lists Home, Tabs, Bots, Automations, Workflows, and Recordings in that order

#### Scenario: Forge sections follow forge sources

- **WHEN** the Gitea extension is enabled with a forge source serving pull
  requests and issues
- **THEN** the sidebar lists Pull Requests and Issues after Recordings

#### Scenario: No forge source

- **WHEN** no enabled extension contributes a forge source
- **THEN** the sidebar lists Home, Tabs, Bots, Automations, Workflows, and
  Recordings and nothing after them

#### Scenario: Review count

- **WHEN** two open pull requests request the user's review
- **THEN** Pull Requests carries the count 2
