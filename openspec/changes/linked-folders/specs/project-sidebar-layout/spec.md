## MODIFIED Requirements

### Requirement: Sidebar group tab bar

The sidebar tab bar SHALL sit above the pane stack and SHALL use the same project chrome as the active project tab and panel tab strip so the colour continues across that band. It SHALL have three tabs, in order: Explorer with a file/folder icon, Documentation, and Agents. The Explorer group SHALL contain Files and Changes; Documentation SHALL contain Documentation; Agents SHALL contain Agents. Additional panes SHALL join one of these groups rather than becoming a fourth top-level tab.

#### Scenario: Switching groups

- **WHEN** a user selects Explorer, Documentation, or Agents in the tab bar
- **THEN** Explorer shows Files and Changes, Documentation shows Documentation, and Agents shows Agents
- **AND** panes from another group are not visible

#### Scenario: Tab bar chrome

- **WHEN** the sidebar renders
- **THEN** the tab bar sits above the pane stack and uses the same project chrome colour as the active project tab and panel tab strip

## ADDED Requirements

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

### Requirement: Sidebar follows the selected folder

The Files and Changes panes SHALL present the root of the project's selected folder. Selecting another folder SHALL immediately present that folder's root in both panes. The Files pane title SHALL name the folder when its root is not the project root. Pane dimensions, order, and collapse state SHALL stay per project and SHALL NOT change when the selected folder changes. Documentation and Agents SHALL stay scoped to the project.

#### Scenario: Selecting a linked folder

- **WHEN** a user selects a linked folder
- **THEN** Files lists that folder's worktree, Changes lists that worktree's working-tree changes, and the pane heights are unchanged

#### Scenario: Selecting General or a plain folder

- **WHEN** a user selects General or a plain folder
- **THEN** Files and Changes present the project root

### Requirement: Folders tree visibility and width

Folders tree open/closed visibility and width SHALL belong to the current device and project, stored with device preferences under the selected server and opaque project id, independently of the sidebar's visibility. A device that has no preference for a project SHALL present the Folders tree open.

#### Scenario: First visit to a project on a device

- **WHEN** a device has no stored preference for a project
- **THEN** the Folders tree is presented open

#### Scenario: Toggling on one device

- **WHEN** a user hides the Folders tree on one device
- **THEN** no other device and no other project is affected, and the sidebar's visibility is unchanged
