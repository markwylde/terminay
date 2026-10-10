## ADDED Requirements

### Requirement: Compact switcher Tabs and Agents tabs

The compact switcher SHALL offer the same two tabs as a project's left column, in the same order: **Tabs** and **Agents**. Tabs SHALL present the switcher's grouped connections, projects, folders, and panels together with its filter and its create actions. Agents SHALL present the Agents pane of the project in front, and SHALL NOT present the filter or the create actions. The switcher SHALL open on Tabs every time it opens, from the breadcrumb and from the connection control alike. The tab bar SHALL be a tab list whose tabs are named Tabs and Agents, with Arrow Left and Arrow Right moving between them and the shown content exposed as the tab panel; selecting a tab SHALL NOT move focus into a text field.

Pressing an agent row SHALL act as it does in the left column's Agents tab and SHALL dismiss the switcher, so the terminal it leads to is on screen.

The Agents tab SHALL be omitted when agent integration is disabled or no project is in front. The switcher SHALL then show the Tabs content with no tab bar.

#### Scenario: Switcher opens on Tabs

- **WHEN** a user opens the compact switcher with a project in front and agent integration enabled
- **THEN** it shows a Tabs tab and an Agents tab with Tabs selected, and the grouped projects and panels beneath

#### Scenario: Selecting Agents

- **WHEN** a user selects the Agents tab
- **THEN** the switcher shows the agents of the project in front in place of the grouped list, the filter, and the create actions
- **AND** no software keyboard is raised

#### Scenario: Reopening the switcher

- **WHEN** a user selects Agents, dismisses the switcher, and opens it again
- **THEN** Tabs is selected

#### Scenario: Pressing an agent

- **WHEN** a user presses a bound agent's row in the switcher's Agents tab
- **THEN** that agent's terminal becomes the terminal on screen and the switcher is dismissed

#### Scenario: No project in front

- **WHEN** the switcher is open while the dashboard is selected
- **THEN** it shows the Tabs content with no tab bar

#### Scenario: Agent integration disabled

- **WHEN** agent integration is disabled
- **THEN** the switcher shows the Tabs content with no tab bar
