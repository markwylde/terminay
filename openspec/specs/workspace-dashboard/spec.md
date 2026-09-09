# workspace-dashboard Specification

## Purpose

The Home dashboard is a per-device view of every project and every panel in a workspace, so a user can see the whole workspace at a glance without selecting each project in turn.

## Requirements

### Requirement: Home is a selectable view, not a project

A workspace view SHALL have exactly one selected view at a time: either the Home dashboard or one project. Home SHALL NOT be a project: it has no environment, no root, no panels, no colour, and no layout, and it SHALL NEVER appear in the ordered project list, in project ordering, or in the overflow switcher. Selecting Home SHALL NOT close, suspend, unmount, or detach any project, panel, or terminal session, and every terminal SHALL continue to run and receive output exactly as it does while its project is in the background.

#### Scenario: Selecting Home

- **WHEN** a user selects Home
- **THEN** the dashboard replaces the project workspace area and no project tab is presented as active

#### Scenario: Terminals keep running

- **WHEN** Home is selected while terminals are running
- **THEN** every terminal keeps running and receiving output, and none is closed, suspended, or detached

#### Scenario: Home is not in the project list

- **WHEN** projects are ordered, overflowed, or listed in the switcher
- **THEN** Home is absent from that ordering and that list

### Requirement: Home selection is per-device and remembered

The selected view SHALL be per-device presentation state and SHALL NEVER be written to server-owned workspace state, so two devices attached to the same workspace view can show Home and a project independently. A device SHALL remember that it had Home selected and SHALL restore Home on reconnect. That memory SHALL be a hint: when it cannot be restored, or when device storage is unavailable, the device SHALL fall back to selecting a project without reporting an error.

#### Scenario: Two devices, different views

- **WHEN** one device selects Home while another shows a project in the same workspace view
- **THEN** each device keeps its own selected view and neither changes the other

#### Scenario: Reconnecting with Home remembered

- **WHEN** a device that had Home selected reconnects
- **THEN** Home is selected again

#### Scenario: Storage unavailable

- **WHEN** device storage is unavailable, full, or disabled
- **THEN** the device selects a project and reports no error

### Requirement: Command target while Home is selected

Selecting Home SHALL NOT change which project commands act on. The project that was selected before Home SHALL remain the command target for project-scoped and panel-scoped commands, and closing that project while Home is selected SHALL move the command target to a neighbouring project without leaving Home.

#### Scenario: Command invoked from Home

- **WHEN** a project-scoped command is invoked while Home is selected
- **THEN** it acts on the project that was selected before Home

#### Scenario: Retained project closes

- **WHEN** the retained command-target project is closed while Home is selected
- **THEN** the command target moves to a neighbouring project and Home stays selected

### Requirement: Workspace panel inventory

Each project SHALL publish an inventory of every panel it holds — terminal, file, and folder panels alike — carrying panel identity, project identity, title, panel kind, presentation colour and emoji, and status, whether or not that panel is currently notable. The inventory SHALL be republished when a panel is added, removed, renamed, or moved, and when a panel's status changes. Surfaces that show only notable panels SHALL derive their contents by filtering that inventory rather than by receiving a separate publication.

#### Scenario: Idle panel is inventoried

- **WHEN** a project holds an idle terminal and an open file panel
- **THEN** both appear in that project's inventory with their kind and status

#### Scenario: Panel added or renamed

- **WHEN** a panel is added, removed, renamed, or moved between projects
- **THEN** the affected projects republish their inventory

#### Scenario: Notable-only surfaces

- **WHEN** the activity menu and project tab badges render
- **THEN** their contents are a filter over the inventory and unchanged from what they would show for the same panels

### Requirement: Dashboard row model

The dashboard SHALL present every project in the workspace view in project order as a one-line header row carrying the project's colour, emoji, name, and a roll-up of its panels' statuses, immediately followed by one row per panel in that project, in panel order, carrying the panel's status, kind, title, and — for a terminal under agent authority — its agent state. A project with no panels SHALL still show its header row. The dashboard SHALL show every project and every panel, including idle ones, and SHALL NEVER omit a project because nothing is happening in it.

#### Scenario: Projects and panels listed

- **WHEN** the dashboard renders
- **THEN** every project appears in project order as a header row followed by its panels in panel order

#### Scenario: Quiet workspace

- **WHEN** no project has any notable activity
- **THEN** every project and panel still appears, each showing an idle status

#### Scenario: Empty project

- **WHEN** a project holds no panels
- **THEN** its header row is still shown

### Requirement: Rows are single unwrapped lines

Every dashboard row SHALL occupy exactly one line. Row text SHALL NEVER wrap, and content that does not fit the available width SHALL be truncated with a visible truncation indicator while the status affordance, project colour, and emoji stay visible. Narrowing the window SHALL truncate row text rather than reflow, re-order, or hide rows.

#### Scenario: Long title

- **WHEN** a panel title is wider than the available row width
- **THEN** the title is truncated with a visible truncation indicator and the row stays one line

#### Scenario: Narrow window

- **WHEN** the window is narrowed
- **THEN** rows truncate their text and no row wraps, reorders, or disappears

### Requirement: Dashboard status vocabulary

Dashboard statuses SHALL use the same canonical status vocabulary and the same visual language as the terminal tab and activity surfaces, so one state never reads two ways. A terminal under agent authority SHALL show its agent state and SHALL NEVER show a competing raw-output activity state. A panel with nothing notable SHALL read as idle.

#### Scenario: Agent-owned terminal

- **WHEN** a terminal is under agent authority
- **THEN** the dashboard shows its agent state and shows no raw-output activity state for it

#### Scenario: Consistent presentation

- **WHEN** the same panel is shown on its terminal tab, in the activity menu, and on the dashboard
- **THEN** all three present the same canonical status

### Requirement: Row activation

Activating a project header row SHALL select that project and leave Home. Activating a panel row SHALL select that panel's project, leave Home, and focus that panel. Rows SHALL carry no other action in the dashboard: they SHALL NOT close, rename, reorder, or create anything. Activating a row whose project or panel no longer exists SHALL leave the dashboard selected and refresh the list rather than failing.

#### Scenario: Activating a project row

- **WHEN** a user activates a project header row
- **THEN** that project becomes the selected view and Home is deselected

#### Scenario: Activating a panel row

- **WHEN** a user activates a panel row
- **THEN** that panel's project becomes the selected view and that panel is focused

#### Scenario: Stale row

- **WHEN** a user activates a row whose project or panel has since been removed
- **THEN** the dashboard stays selected and refreshes its list

### Requirement: Home control presentation

The Home control SHALL be an icon-only control on the project bar, distinguished from project tabs so that it never reads as a project. It SHALL show a selected state while Home is the selected view, SHALL be reachable by keyboard, and SHALL carry an accessible name naming the dashboard. While Home is selected, the chrome band SHALL use a neutral dashboard colour rather than any project's colour.

#### Scenario: Selected state

- **WHEN** Home is the selected view
- **THEN** the Home control shows its selected state, no project tab shows an active state, and the chrome band uses the neutral dashboard colour

#### Scenario: Accessible name

- **WHEN** assistive technology reads the Home control
- **THEN** it announces a name identifying the dashboard

### Requirement: Dashboard reflects the workspace live

The dashboard SHALL reflect workspace changes while it is shown. Creating, closing, renaming, or reordering a project or a panel, and any panel status change, SHALL appear on the dashboard without the user leaving and re-entering Home.

#### Scenario: Status changes while shown

- **WHEN** a panel's status changes while the dashboard is shown
- **THEN** its row updates in place

#### Scenario: Structure changes while shown

- **WHEN** a project or panel is created, closed, renamed, or reordered while the dashboard is shown
- **THEN** the list reflects that change without the user leaving Home
