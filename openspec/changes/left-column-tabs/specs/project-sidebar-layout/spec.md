## MODIFIED Requirements

### Requirement: Sidebar group tab bar

The sidebar tab bar SHALL sit above the pane stack and SHALL use the same project chrome as the active project tab and panel tab strip so the colour continues across that band. It SHALL have two tabs, in order: Explorer with a file/folder icon, and Documentation. The Explorer group SHALL contain Files and Changes; Documentation SHALL contain Documentation. Every pane of the sidebar SHALL be scoped to the folder in front; a list that belongs to the whole project SHALL be a tab of the left column rather than a sidebar group. Additional panes SHALL join one of these groups rather than becoming a further top-level tab.

#### Scenario: Switching groups

- **WHEN** a user selects Explorer or Documentation in the tab bar
- **THEN** Explorer shows Files and Changes, and Documentation shows Documentation
- **AND** panes from another group are not visible

#### Scenario: Two groups at every width

- **WHEN** the sidebar renders side by side with the content or as a narrow-layout drawer
- **THEN** the tab bar offers Explorer and Documentation and no other tab

#### Scenario: Tab bar chrome

- **WHEN** the sidebar renders
- **THEN** the tab bar sits above the pane stack and uses the same project chrome colour as the active project tab and panel tab strip

### Requirement: Reorder confined to the active group

Pane reorder SHALL be confined to the active group. Files SHALL NOT be dragged into Documentation, and no pane SHALL be dragged between the sidebar and the left column.

#### Scenario: Dragging across groups

- **WHEN** a user drags the Files pane toward Documentation
- **THEN** the reorder is not accepted and Files remains in Explorer

### Requirement: Sidebar stack occupies available height without outer scrolling

The sidebar stack SHALL occupy its available height below the group tab bar without an outer vertical scrollbar. Each expanded pane body SHALL own any scrolling required by its content. This SHALL hold in every layout that presents the sidebar, including a narrow-layout navigation drawer, whose available height is the drawer's height rather than a fixed fraction of the viewport.

#### Scenario: Overflowing pane content

- **WHEN** the Files, Changes, or Documentation body content overflows
- **THEN** that body scrolls and the sidebar element itself never scrolls vertically
- **AND** no pane title moves

#### Scenario: Overflowing pane content in a narrow drawer

- **WHEN** the sidebar is presented as a narrow-layout drawer and a pane body overflows
- **THEN** that body scrolls and neither the drawer nor the sidebar element scrolls vertically

#### Scenario: Stack fills the drawer

- **WHEN** the sidebar is presented as a narrow-layout drawer
- **THEN** the stack distributes the drawer's full height under the same rules used in a wide layout
- **AND** the sidebar is not capped to a fixed fraction of the viewport

### Requirement: Device-scoped visibility and group preferences

Sidebar open/closed visibility and the selected group SHALL belong to the current device and project. They SHALL be stored with device preferences under the selected server and opaque project id, so toggling a sidebar or switching between Explorer and Documentation affects neither another device nor another project. A device that has no preference for a project, or whose stored selection names no group the sidebar offers, SHALL present the Explorer group; a device that has no visibility preference SHALL present the sidebar closed.

#### Scenario: First visit to a project on a device

- **WHEN** a device has no stored preference for a project
- **THEN** the sidebar is presented closed with the Explorer group selected

#### Scenario: Toggling sidebar visibility

- **WHEN** a user toggles sidebar visibility or switches group on one device
- **THEN** no other device and no other project is affected

#### Scenario: Restart or reload

- **WHEN** the same device restarts or reloads
- **THEN** its sidebar visibility and selected group for each project are restored

#### Scenario: Stored selection names no offered group

- **WHEN** a device's stored selection for a project is not Explorer or Documentation
- **THEN** the Explorer group is presented

### Requirement: Left column chrome band

The left column SHALL draw a band of project chrome above its content, the same height and colour as the panel tab strip and the sidebar's group tab bar, so the colour continues across all three columns. The band SHALL carry no title. It SHALL hold the left column's tab bar at its leading end. While the Tabs tab is selected it SHALL hold the **Tabs actions** control at its trailing end; while another tab is selected that control SHALL be absent.

#### Scenario: Band without a title

- **WHEN** the left column renders
- **THEN** the band shows the project chrome colour, the tab icons, and no text

#### Scenario: Tabs actions

- **WHEN** the Tabs tab is selected and a user activates the control at the trailing end of the band
- **THEN** the Tabs actions menu opens

#### Scenario: Actions control follows the Tabs tab

- **WHEN** the Agents tab is selected
- **THEN** the band shows no Tabs actions control

## ADDED Requirements

### Requirement: Left column tabs

At or above the narrow layout breakpoint, a project's left column SHALL present one list at a time, selected from a tab bar of two icon tabs, in order: **Tabs** and **Agents**. Tabs SHALL show the Folders tree with each folder's terminals. Agents SHALL show the project's Agents pane. The selected list SHALL fill the column beneath the band and SHALL own any scrolling its content needs; the column itself SHALL NOT scroll. A list SHALL carry no title row, collapse control, reorder grip, or resize separator, and the Agents tab SHALL carry no count. A tab icon SHALL match a sidebar group tab in size, spacing, and selected, hover, and focus presentation. A list that is not selected SHALL keep its scroll position and its expanded and collapsed rows for when it is selected again.

The tab bar SHALL be a tab list: each tab SHALL be named Tabs or Agents to assistive technology and by its tooltip, Arrow Left and Arrow Right SHALL move between tabs, and the selected list SHALL be the corresponding tab panel.

The Agents tab SHALL be omitted when agent integration is disabled. The column SHALL then show the Tabs list with no tab bar, and a stored selection of Agents SHALL NOT be rewritten.

#### Scenario: Reading the left column

- **WHEN** a project renders at or above the narrow layout breakpoint with the left column visible and agent integration enabled
- **THEN** the band shows a Tabs icon and an Agents icon, and the column shows exactly one of the two lists

#### Scenario: Switching tabs

- **WHEN** a user selects the Agents tab
- **THEN** the project's agents fill the column and the Folders tree is not visible
- **AND** selecting Tabs shows the Folders tree again and the agents are not visible

#### Scenario: No pane chrome

- **WHEN** either list is shown
- **THEN** it has no title row, no collapse control, no reorder grip, and no separator, and the Agents tab icon shows no count

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

### Requirement: Left column selected tab is a device preference

The left column's selected tab SHALL belong to the current device and project, stored with device preferences under the selected server and opaque project id beside the column's width and visibility. It SHALL NOT sync to another device and SHALL NOT belong to canonical project layout. A device with no preference for a project, or whose stored value names neither tab, SHALL present Tabs.

#### Scenario: First visit to a project on a device

- **WHEN** a device has no stored left column tab for a project
- **THEN** the Tabs tab is selected

#### Scenario: Selecting on one device

- **WHEN** a user selects Agents in one project on one device
- **THEN** no other device and no other project is affected

#### Scenario: Restart or reload

- **WHEN** the same device restarts or reloads
- **THEN** each project's left column shows the tab that was selected for it

#### Scenario: Switching projects

- **WHEN** a user switches to another project
- **THEN** the left column shows that project's own selected tab

#### Scenario: Malformed stored value

- **WHEN** the stored value for a project names neither Tabs nor Agents
- **THEN** the Tabs tab is selected

## REMOVED Requirements

### Requirement: Agents tab availability

**Reason**: The sidebar has no Agents group. Agents are a tab of the left column and of the compact switcher.
**Migration**: A stored sidebar selection of Agents presents Explorer, under "Device-scoped visibility and group preferences". Disabling agent integration is covered by "Left column tabs".

### Requirement: Left column pane stack

**Reason**: The left column shows one list at a time behind tab icons, so it has no stack, titles, separator, or reorder.
**Migration**: Replaced by "Left column tabs".

### Requirement: Left column layout is a device preference

**Reason**: With no stack there is no pane order, height, or collapse choice to keep.
**Migration**: Replaced by "Left column selected tab is a device preference". A stored left column layout is ignored; every project starts on the Tabs tab.
