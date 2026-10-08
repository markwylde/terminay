## MODIFIED Requirements

### Requirement: Sidebar group tab bar

The sidebar tab bar SHALL sit above the pane stack and SHALL use the same project chrome as the active project tab and panel tab strip so the colour continues across that band. At or above the narrow layout breakpoint it SHALL have two tabs, in order: Explorer with a file/folder icon, and Documentation. Below the narrow layout breakpoint it SHALL add Agents as a third tab. The Explorer group SHALL contain Files and Changes; Documentation SHALL contain Documentation; Agents SHALL contain Agents. Additional panes SHALL join one of these groups rather than becoming a further top-level tab.

#### Scenario: Switching groups

- **WHEN** a user selects Explorer or Documentation in the tab bar
- **THEN** Explorer shows Files and Changes, and Documentation shows Documentation
- **AND** panes from another group are not visible

#### Scenario: Wide layout offers no Agents group

- **WHEN** the sidebar renders at or above the narrow layout breakpoint
- **THEN** the tab bar offers Explorer and Documentation and no Agents tab

#### Scenario: Narrow layout offers the Agents group

- **WHEN** the sidebar is presented as a narrow-layout drawer and agent integration is enabled
- **THEN** the tab bar offers Explorer, Documentation, and Agents, and selecting Agents shows the Agents pane

#### Scenario: Tab bar chrome

- **WHEN** the sidebar renders
- **THEN** the tab bar sits above the pane stack and uses the same project chrome colour as the active project tab and panel tab strip

### Requirement: Agents tab availability

The Agents tab SHALL be omitted when agent integration is disabled, and at or above the narrow layout breakpoint. If that tab was selected, Explorer SHALL be shown instead without rewriting the stored selection.

#### Scenario: Agent integration disabled

- **WHEN** agent integration is disabled and Agents was the selected group
- **THEN** the Agents tab is omitted and Explorer is shown
- **AND** the stored group selection is not rewritten

#### Scenario: Widening past the breakpoint

- **WHEN** Agents is the selected group and the layout becomes wide
- **THEN** the Agents tab is omitted and Explorer is shown
- **AND** the stored group selection is not rewritten

## ADDED Requirements

### Requirement: Left column pane stack

At or above the narrow layout breakpoint, a project's left column SHALL be one vertically resizable pane stack holding two panes, Folders and Agents, in that order by default. Folders SHALL contain the Folders tree and Agents SHALL contain the project's Agents pane. The stack SHALL follow every pane-stack requirement of this capability that the sidebar's active group follows: title visibility, collapsed height, space distribution, separator presentation and semantics, continuous clamped preview, keyboard resizing, pointer gesture handling, exhausted movement feedback, independent size preferences, deterministic normalization, and reorder by a pane's grip. A pane SHALL NOT be dragged between the left column and the sidebar. The Agents pane SHALL be omitted when agent integration is disabled, and Folders SHALL then occupy the stack.

#### Scenario: Reading the left column

- **WHEN** a project renders at or above the narrow layout breakpoint with the left column visible and agent integration enabled
- **THEN** the column shows a Folders pane above an Agents pane, each with its own title row

#### Scenario: Collapsing a pane

- **WHEN** a user collapses Folders
- **THEN** it occupies exactly its title height and Agents takes the remaining height

#### Scenario: Resizing the boundary

- **WHEN** a user drags the separator between the two panes, or moves it with the arrow keys
- **THEN** both panes resize continuously, neither title leaves the column, and the result is committed once when the gesture completes

#### Scenario: Reordering

- **WHEN** a user drags the Agents pane's grip above Folders
- **THEN** Agents is shown above Folders and each pane keeps its own size preference

#### Scenario: Overflowing pane content

- **WHEN** the Folders tree or the Agents list is taller than its pane
- **THEN** that pane's content scrolls and the column itself does not

#### Scenario: Agent integration disabled

- **WHEN** agent integration is disabled
- **THEN** the left column shows the Folders pane alone, filling the stack

### Requirement: Left column chrome band

The left column SHALL draw a band of project chrome above its pane stack, the same height and colour as the panel tab strip and the sidebar's group tab bar, so the colour continues across all three columns. The band SHALL carry no title. It SHALL hold the Folders actions control at its trailing end.

#### Scenario: Band without a title

- **WHEN** the left column renders
- **THEN** the band above the stack shows the project chrome colour and no text
- **AND** each pane is named by its own title row

#### Scenario: Folders actions

- **WHEN** a user activates the control at the trailing end of the band
- **THEN** the Folders actions menu opens

### Requirement: Left column layout is a device preference

The left column's pane order, pane heights, and collapse choices SHALL belong to the current device and project, stored with device preferences under the selected server and opaque project id beside the column's width and visibility. They SHALL NOT sync to another device and SHALL NOT belong to canonical project layout. A completed resize, collapse, or reorder SHALL be stored once; pointer movement SHALL be presentation-local. A device with no preference for a project SHALL present Folders above Agents, both expanded. Stored values SHALL be treated as preferences: heights SHALL be bounded and the order SHALL always name every pane exactly once before rendering.

#### Scenario: First visit to a project on a device

- **WHEN** a device has no stored left column preference for a project
- **THEN** Folders is shown above Agents and both are expanded

#### Scenario: Arranging on one device

- **WHEN** a user collapses, resizes, or reorders the left column's panes on one device
- **THEN** no other device and no other project is affected

#### Scenario: Restart or reload

- **WHEN** the same device restarts or reloads
- **THEN** its left column order, heights, and collapse choices for each project are restored

#### Scenario: Malformed stored layout

- **WHEN** a stored layout names an unknown pane, omits a pane, or holds an out-of-range height
- **THEN** both panes are still presented, in a valid order, at bounded heights
