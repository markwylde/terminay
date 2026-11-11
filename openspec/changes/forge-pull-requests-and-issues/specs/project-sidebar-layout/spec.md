## MODIFIED Requirements

### Requirement: Left column tabs

At or above the narrow layout breakpoint, a project's left column SHALL present one list at a time, selected from a tab bar of icon tabs, in order: **Tabs**, **Agents**, and **Git**. Tabs SHALL show the Folders tree with each folder's terminals. Agents SHALL show the project's Agents pane. Git SHALL show the project's Issues and Pull Requests panes as `pull-requests-and-issues` defines them, and SHALL be present only while an enabled forge source claims one of the project's remotes, serves issues or pull requests, and has its Project Git tab setting on. No tab SHALL carry a count. The selected list SHALL fill the column beneath the band and SHALL own any scrolling its content needs; the column itself SHALL NOT scroll. The Tabs and Agents lists SHALL carry no title row, collapse control, reorder grip, or resize separator; the Git tab's panes SHALL carry them as sidebar panes do. A tab icon SHALL match a sidebar group tab in size, spacing, and selected, hover, and focus presentation. A list that is not selected SHALL keep its scroll position and its expanded and collapsed rows for when it is selected again.

The tab bar SHALL be a tab list: each tab SHALL be named Tabs, Agents, or Git to assistive technology and by its tooltip, Arrow Left and Arrow Right SHALL move between tabs, and the selected list SHALL be the corresponding tab panel.

The Agents tab SHALL be omitted when agent integration is disabled. When only the Tabs tab remains, because agent integration is disabled and no Git tab is present, the column SHALL show the Tabs list with no tab bar. A stored selection of a tab that is omitted SHALL NOT be rewritten, and the Tabs list SHALL be shown in its place.

#### Scenario: Reading the left column

- **WHEN** a project renders at or above the narrow layout breakpoint with the left column visible, agent integration enabled, and no forge source claiming its remotes
- **THEN** the band shows a Tabs icon and an Agents icon, and the column shows exactly one of the two lists

#### Scenario: Switching tabs

- **WHEN** a user selects the Agents tab
- **THEN** the project's agents fill the column and the Folders tree is not visible
- **AND** selecting Tabs shows the Folders tree again and the agents are not visible

#### Scenario: No pane chrome

- **WHEN** the Tabs or Agents list is shown
- **THEN** it has no title row, no collapse control, no reorder grip, and no separator, and no tab icon shows a count

#### Scenario: Returning to a list

- **WHEN** a user scrolls the Folders tree, selects Agents, and selects Tabs again
- **THEN** the Folders tree is at the scroll position it was left at

#### Scenario: Overflowing list

- **WHEN** the Folders tree or the Agents list is taller than the column
- **THEN** that list scrolls and neither the band nor the column moves

#### Scenario: Keyboard navigation

- **WHEN** a keyboard user focuses the tab bar and presses Arrow Right
- **THEN** the next tab is selected and its list is exposed as the tab panel

#### Scenario: Agent integration disabled

- **WHEN** agent integration is disabled and Agents was the selected tab
- **THEN** the column shows the Tabs list with no tab bar
- **AND** the stored selection is not rewritten

#### Scenario: Git tab on a Gitea repository

- **WHEN** a project's `origin` is claimed by the Gitea forge source and agent
  integration is enabled
- **THEN** the band shows Tabs, Agents, and Git icons in that order

#### Scenario: Folder with no forge

- **WHEN** no forge source claims any of a project's remotes
- **THEN** the band shows no Git icon

#### Scenario: Git tab without agents

- **WHEN** agent integration is disabled and the Gitea forge source claims the project's `origin`
- **THEN** the band shows Tabs and Git icons in that order

#### Scenario: Git tab no longer offered

- **WHEN** Git was the selected tab and the extension that claimed the
  project's remote is disabled
- **THEN** the column shows the Tabs list and the stored selection is not
  rewritten
