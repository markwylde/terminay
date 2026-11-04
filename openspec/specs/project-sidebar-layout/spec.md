# project-sidebar-layout Specification

## Purpose

Each project presents a sidebar with three groups — Explorer, Documentation, and Agents — selected from a tab bar, each group being a vertically resizable pane stack. The active stack keeps every visible pane title on-screen, gives scrolling to pane content rather than the whole sidebar, and restores that project's preferred dimensions through canonical server-owned workspace state.

## Requirements

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

### Requirement: Hidden group state retention

Selecting a tab SHALL show only that group's panes. Hidden groups SHALL retain their stored heights, collapse choices, and order.

#### Scenario: Returning to a group

- **WHEN** a user leaves a group and later returns to it
- **THEN** its stored pane heights, collapse choices, and order are presented unchanged

### Requirement: Selected group is a device preference

The selected group SHALL be a device-local preference keyed by the selected server and project, like sidebar open/closed visibility. It SHALL NOT sync to another device and SHALL NOT belong to canonical project layout.

#### Scenario: Second device connects

- **WHEN** another device opens the same project
- **THEN** it uses its own selected group rather than the first device's selection

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

### Requirement: Narrow-layout navigation drawer

Below the narrow layout breakpoint, visible workspace navigation SHALL be presented as a drawer occupying the full height available to the workspace, overlaying the workspace content rather than reducing the height allotted to it. Hidden navigation SHALL give the workspace content the full viewport. The drawer SHALL be dismissible by the navigation control, by the Escape key, and by activating the region over the content behind it.

#### Scenario: Opening navigation at a narrow width

- **WHEN** workspace navigation becomes visible below the narrow layout breakpoint
- **THEN** the navigation surface occupies the full height available to the workspace
- **AND** the workspace content keeps its own height rather than being compressed into a remaining row

#### Scenario: Closing the drawer restores the content

- **WHEN** the navigation drawer is dismissed
- **THEN** the workspace content occupies the full viewport
- **AND** its panels are not resized to a different geometry than before the drawer opened

#### Scenario: Dismissal routes

- **WHEN** the user activates the navigation control, presses Escape, or activates the region over the content behind the drawer
- **THEN** the drawer closes

#### Scenario: Wide layout is unaffected

- **WHEN** the workspace renders at or above the narrow layout breakpoint
- **THEN** navigation and content are presented side by side with the resize separator and the persisted navigation width

### Requirement: Navigation drawer focus and assistive-technology behaviour

An open narrow-layout navigation drawer SHALL move focus into itself, SHALL return focus to the control that opened it when it closes, and SHALL keep keyboard focus within itself while open. Workspace content behind an open drawer SHALL be exposed to assistive technology as unavailable for interaction.

#### Scenario: Focus enters and returns

- **WHEN** the navigation drawer opens and is later dismissed
- **THEN** focus moves into the drawer on open and returns to the control that opened it on close

#### Scenario: Focus stays within the drawer

- **WHEN** the drawer is open and the user cycles focus with the keyboard
- **THEN** focus remains within the drawer and does not reach the content behind it

#### Scenario: Content behind the drawer is inert

- **WHEN** assistive technology inspects the workspace while the drawer is open
- **THEN** the content behind the drawer is reported as unavailable for interaction

### Requirement: Pane titles always visible

Every visible pane title in the active group SHALL remain completely inside the sidebar viewport while panes are resized, collapsed, expanded, reordered, restored, or relaid out after a window-size change. An expanded body SHALL yield all of its usable height before a title can be clipped or pushed off-screen.

#### Scenario: Space is scarce

- **WHEN** available sidebar height shrinks
- **THEN** expanded bodies yield all usable height before any title is clipped or pushed off-screen

#### Scenario: Titles stay visible across interactions

- **WHEN** panes are resized, collapsed, expanded, reordered, restored, or relaid out after a window-size change
- **THEN** every visible title's bounding box stays within the sidebar

### Requirement: Collapsed pane height and title minimum

A collapsed pane SHALL occupy exactly its title height. The layout SHALL use the title's rendered height as its hard minimum rather than an approximate constant.

#### Scenario: Collapsing a pane

- **WHEN** a user collapses a pane
- **THEN** it occupies exactly its rendered title height

### Requirement: Space distribution among expanded panes

Expanded panes in the active group SHALL share the pixels remaining after all visible titles in that group have been reserved. Preferred body minima MAY influence distribution when room exists, but SHALL NOT override title visibility. The layout SHALL resolve all visible panes in the active group together, and a resize boundary SHALL NOT use a local constraint that contradicts the space required by another pane in that group.

#### Scenario: Distribution after title reservation

- **WHEN** the layout runs
- **THEN** expanded panes share the pixels remaining once every visible title in the group is reserved

#### Scenario: Conflicting local constraint

- **WHEN** a resize boundary is evaluated
- **THEN** it uses the group-wide solution rather than a local constraint that contradicts another pane's required space

### Requirement: Resize separator presentation

A resize separator SHALL be centred on the top edge of the following pane's title, matching the VS Code interaction model. It SHALL overlay the boundary and SHALL NOT consume layout height. Hover SHALL show a 4px light rail centred on that boundary after 100ms; dragging and keyboard focus SHALL show it immediately. A filled sash SHALL NOT be used. The pointer hit target SHALL stay large enough to acquire reliably.

#### Scenario: Hovering a boundary

- **WHEN** the pointer rests on a pane boundary for 100ms
- **THEN** a 4px light rail appears centred on that boundary

#### Scenario: Dragging or focusing

- **WHEN** a separator is dragged or receives keyboard focus
- **THEN** the rail appears immediately

#### Scenario: Separator does not consume height

- **WHEN** the layout is measured
- **THEN** the separator overlays the boundary and adds no layout height

### Requirement: Continuous clamped drag preview

Dragging a separator SHALL continuously preview the resulting pane sizes. Movement SHALL be clamped using the available grow and shrink capacity of every affected pane on both sides of the boundary, so the pointer does not jump and no pane crosses its hard minimum.

#### Scenario: Dragging to a limit

- **WHEN** a user drags a separator beyond the available capacity of the affected panes
- **THEN** movement is clamped, the pointer does not jump, and no pane crosses its hard minimum

#### Scenario: Repeated drags

- **WHEN** a separator in a multi-pane group is dragged repeatedly in both directions
- **THEN** it resizes continuously across its full permitted range and remains usable

### Requirement: Independent size preferences per pane

All panes, including the final pane in a group, SHALL retain an independent size preference. Reordering a pane SHALL NOT transfer another pane's preference or make the moved pane's preference inapplicable merely because it is last.

#### Scenario: Reordering panes

- **WHEN** a user moves a pane to the end of the group
- **THEN** each pane keeps its own size preference and none is transferred or discarded

### Requirement: Deterministic normalization across layout events

Collapsing, expanding, reordering, adding or removing a registered pane, switching groups, and resizing the window SHALL run through the same deterministic normalization rules. If a temporarily smaller viewport clamps a preferred size, growing the viewport SHALL restore that preference unless the user committed a new resize.

#### Scenario: Shrinking and regrowing the window

- **WHEN** the window shrinks so a preferred size is clamped and is then grown again
- **THEN** the original preference is restored, unless the user committed a new resize while clamped
- **AND** title visibility is maintained throughout

#### Scenario: Pane set changes

- **WHEN** a registered pane is added or removed, or groups are switched
- **THEN** the same normalization rules produce the layout

### Requirement: Minimum host height for the sidebar

Terminay's supported window and embedded-client layouts SHALL provide at least the combined title height of the active group's panes plus the group tab bar. If that invariant cannot be met, the host SHALL constrain or adapt the presentation explicitly and SHALL NOT silently hide titles or introduce an outer sidebar scroll position. Normal Electron project windows SHALL enforce a 260px native minimum height, leaving room for the project tab bar, sidebar group tabs, the active group's pane titles, and a usable workspace body; auxiliary windows SHALL NOT inherit this project-layout constraint. A web or embedded host below the measured title budget SHALL present a non-scrolling status that states the required sidebar height and asks the user to increase the window height, rather than rendering a clipped partial stack.

#### Scenario: Electron project window minimum

- **WHEN** a normal Electron project window is resized
- **THEN** it cannot go below a 260px native minimum height

#### Scenario: Auxiliary window

- **WHEN** an auxiliary Desktop window is sized
- **THEN** it does not inherit the project-layout minimum height constraint

#### Scenario: Web host below the title budget

- **WHEN** a web or embedded host viewport falls below the measured title budget
- **THEN** a non-scrolling status states the required sidebar height and asks the user to increase the window height
- **AND** no clipped partial stack is rendered

### Requirement: Project-scoped layout persistence

Pane dimensions, order, and collapse state SHALL belong to the project. Switching projects SHALL immediately present the selected project's own sidebar layout and that device's selected group for the project.

#### Scenario: Switching projects

- **WHEN** a user switches to another project
- **THEN** that project's own pane dimensions, order, and collapse state are presented together with this device's selected group for it

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

### Requirement: Preview and commit boundary for resizing

Pointer movement SHALL be presentation-local preview state. It SHALL NOT submit workspace commands, publish workspace revisions, or allow an incoming canonical snapshot to fight the in-progress drag. Completing a pointer or keyboard resize SHALL commit the final normalized preference vector for every visible expanded pane in the active group once, through one project-scoped sidebar update, preserving the rendered boundary when the local preview yields to controlled state; collapsed panes SHALL retain their stored body preference. Cancelling a resize SHALL restore the pre-drag presentation and SHALL NOT commit it. Sidebar width SHALL follow the same preview and commit boundary, with live pointer movement local and one final width committed when resizing finishes.

#### Scenario: Resize in progress

- **WHEN** a user is dragging a separator or the sidebar width handle
- **THEN** no canonical sidebar commands are produced and no workspace revision is published

#### Scenario: Resize completed

- **WHEN** a pointer or keyboard resize completes
- **THEN** exactly one project-scoped command commits the final normalized preference vector for every visible expanded pane
- **AND** collapsed panes retain their stored body preference

#### Scenario: Resize cancelled

- **WHEN** a resize is cancelled
- **THEN** the pre-drag presentation is restored and no command is produced

### Requirement: Snapshot reconciliation and validation

Canonical snapshots received during a drag SHALL be reconciled after the local interaction finishes. An older snapshot SHALL NOT overwrite a newer completed resize. Restored dimensions SHALL be treated as preferences rather than trusted layout instructions, and SHALL be validated and normalized against the current pane set and container geometry before rendering.

#### Scenario: Snapshot arrives mid-drag

- **WHEN** a canonical snapshot arrives while a drag is in progress
- **THEN** it is reconciled after the interaction finishes and does not fight the drag

#### Scenario: Stale snapshot

- **WHEN** an older snapshot arrives after a newer completed resize
- **THEN** it does not overwrite the newer resize

#### Scenario: Restoring stored dimensions

- **WHEN** stored dimensions are restored
- **THEN** they are validated and normalized against the current pane set and container geometry before rendering

### Requirement: Tab list and separator semantics

The group tab bar SHALL be a tab list. Each tab SHALL name its group, keyboard users SHALL be able to move between tabs, and the active tab's pane stack SHALL be the corresponding tab panel. Every separator SHALL expose horizontal orientation, its current value, and its effective minimum and maximum through separator semantics.

#### Scenario: Keyboard navigation of groups

- **WHEN** a keyboard user focuses the group tab bar
- **THEN** they can move between named tabs and the active tab's pane stack is exposed as its tab panel

#### Scenario: Separator exposed to assistive technology

- **WHEN** assistive technology inspects a separator
- **THEN** it reports horizontal orientation, current value, and effective minimum and maximum

### Requirement: Keyboard resizing

A focused separator SHALL support incremental resizing with Arrow Up and Arrow Down and boundary resizing with Home and End. Keyboard resizing SHALL use the same solver and single-commit behaviour as pointer resizing.

#### Scenario: Arrow key resize

- **WHEN** a focused separator receives Arrow Up or Arrow Down
- **THEN** the boundary moves incrementally using the same solver as pointer resizing

#### Scenario: Home and End

- **WHEN** a focused separator receives Home or End
- **THEN** the boundary moves to its limit and commits once on completion

### Requirement: Pointer gesture handling

Resize handling SHALL support pointer capture, SHALL prevent text selection and native dragging, and SHALL keep window-level listeners for the gesture. This SHALL apply to every resize separator in the sidebar, including the sidebar width separator, whose handle also moves with its preview. Losing capture because the separator moved with the preview SHALL NOT cancel the resize, and pointer-up SHALL still commit it. `pointercancel`, window blur, hidden visibility, and unmount SHALL cancel it.

#### Scenario: Capture lost by preview movement

- **WHEN** the separator moves with the preview and pointer capture is lost
- **THEN** the resize continues and pointer-up still commits it

#### Scenario: Sidebar width capture lost mid-drag

- **WHEN** pointer capture is lost during a sidebar width drag while the pointer is still held
- **THEN** the sidebar keeps following the pointer, and releasing it commits the dragged width through one project-scoped sidebar update

#### Scenario: Gesture aborted

- **WHEN** `pointercancel`, window blur, hidden visibility, or unmount occurs during a resize
- **THEN** the resize is cancelled

#### Scenario: Text selection suppressed

- **WHEN** a resize gesture is in progress
- **THEN** text selection and native dragging are prevented

### Requirement: Exhausted movement feedback

A separator SHALL communicate when movement in one or both directions is exhausted through its cursor and accessible values. An enabled-looking handle SHALL NOT silently ignore movement.

#### Scenario: Boundary at its limit

- **WHEN** a separator can no longer move in one or both directions
- **THEN** its cursor and accessible values communicate that exhaustion

### Requirement: Layout controller boundaries

Pane content SHALL remain owned by its feature and project. The layout controller SHALL know pane identity, title geometry, expansion state, preferred size, and resize constraints, and SHALL NOT read files, Git state, agent state, or Documentation content. This capability SHALL NOT make sidebar preferences global, SHALL NOT write them into project files, and SHALL NOT introduce renderer filesystem authority. The stack SHALL provide only Terminay's vertical project-sidebar behaviour and SHALL NOT reproduce a general-purpose SplitView API, snapping modes, or an unrelated workbench layout system.

#### Scenario: Controller inputs

- **WHEN** the layout controller resolves a layout
- **THEN** it uses only pane identity, title geometry, expansion state, preferred size, and resize constraints

#### Scenario: No filesystem authority

- **WHEN** sidebar preferences are stored
- **THEN** they are not written into project files, are not global, and introduce no renderer filesystem authority

### Requirement: Cross-client layout restoration

Reconnecting or opening another client SHALL restore the committed project layout without replaying transient drag states, while that client's sidebar visibility and selected group remain its own device preferences. Pointer and keyboard resizing SHALL satisfy the same geometry, persistence, and accessibility expectations in the shared desktop and web renderer.

#### Scenario: Another client opens the project

- **WHEN** a client reconnects or another client opens the project
- **THEN** it restores the committed project layout without replaying transient drag states
- **AND** its sidebar visibility and selected group remain its own device preferences

#### Scenario: Desktop and web parity

- **WHEN** pointer or keyboard resizing runs in the desktop or web renderer
- **THEN** the same geometry, persistence, and accessibility behaviour applies

### Requirement: Sidebar placement

At or above the narrow layout breakpoint, the project sidebar SHALL sit to the right of the project's panel area, and the Folders tree SHALL sit to its left. Each SHALL have its own resize separator on the edge that faces the panel area and its own visibility toggle in the project bar: the Folders tree toggle at the leading end and the sidebar toggle at the trailing end. Hiding either SHALL give its width to the panel area. The sidebar SHALL NOT offer a choice of side.

#### Scenario: Wide layout

- **WHEN** a project renders at or above the narrow layout breakpoint with both columns visible
- **THEN** the Folders tree is on the left, the panel area is in the middle, and the sidebar is on the right

#### Scenario: Hiding one column

- **WHEN** a user hides the Folders tree
- **THEN** the panel area extends to the left edge and the sidebar is unchanged

#### Scenario: Resizing

- **WHEN** a user drags the sidebar's separator
- **THEN** the sidebar and the panel area resize and the Folders tree keeps its width

### Requirement: Folders tree visibility

Folders tree open/closed visibility SHALL belong to the current device and project, stored with device preferences under the selected server and opaque project id, independently of the sidebar's visibility. A device that has no preference for a project SHALL present the Folders tree open.

#### Scenario: First visit to a project on a device

- **WHEN** a device has no stored preference for a project
- **THEN** the Folders tree is presented open

#### Scenario: Toggling on one device

- **WHEN** a user hides the Folders tree on one device
- **THEN** no other device and no other project is affected, and the sidebar's visibility is unchanged

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
