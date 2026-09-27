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

The dashboard SHALL present every project of every attached connection, in the window's tab order, as a one-line header row carrying the project's colour, emoji, name, and a roll-up of its panels' statuses, immediately followed by one row per panel in that project, in panel order, carrying the panel's status, kind, title, and — for a terminal under agent authority — its agent state. Every row SHALL be keyed by the pair of its server and its project, and when more than one connection is attached each project header row SHALL name the server that owns it. A project with no panels SHALL still show its header row. A connection that is unavailable or incompatible SHALL still contribute its project header rows, showing that connection's state in place of a panel roll-up. The dashboard SHALL show every project and every panel, including idle ones, and SHALL NEVER omit a project because nothing is happening in it.

#### Scenario: Projects and panels listed

- **WHEN** the dashboard renders
- **THEN** every project appears in project order as a header row followed by its panels in panel order

#### Scenario: Quiet workspace

- **WHEN** no project has any notable activity
- **THEN** every project and panel still appears, each showing an idle status

#### Scenario: Empty project

- **WHEN** a project holds no panels
- **THEN** its header row is still shown

#### Scenario: Projects from two attached servers

- **WHEN** two connections are attached and each owns projects
- **THEN** the dashboard lists the projects of both, each header row naming its own server, and no two servers' projects are merged into one row

#### Scenario: Unavailable connection

- **WHEN** an attached connection is offline, reconnecting, or incompatible
- **THEN** its project header rows still appear and show that connection's state instead of a panel roll-up

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

The Home control SHALL be an icon-only control on the project bar, and in the compact chrome row, showing a house glyph and distinguished from project tabs so that it never reads as a project. It SHALL show a selected state while Home is the selected view, SHALL be reachable by keyboard, and SHALL carry an accessible name naming Home. While Home is selected, the chrome band SHALL use a neutral Home colour rather than any project's colour. On the project bar, the selected Home control SHALL be drawn as a tab that opens into Home's band in that colour, as the active project tab opens into its project's tab strip.

#### Scenario: Selected state

- **WHEN** Home is the selected view
- **THEN** the Home control shows its selected state, no project tab shows an active state, and the chrome band uses the neutral Home colour

#### Scenario: Selected Home control opens into the band

- **WHEN** Home is selected on the project bar
- **THEN** the Home control is drawn as a tab joined to Home's band, both in the neutral Home colour

#### Scenario: House glyph

- **WHEN** the project bar or the compact chrome row renders the Home control
- **THEN** the control shows a house glyph

#### Scenario: Accessible name

- **WHEN** assistive technology reads the Home control
- **THEN** it announces a name identifying Home

### Requirement: Dashboard reflects the workspace live

The dashboard SHALL reflect workspace changes while it is shown. Creating, closing, renaming, or reordering a project or a panel, and any panel status change, SHALL appear on the dashboard without the user leaving and re-entering Home.

#### Scenario: Status changes while shown

- **WHEN** a panel's status changes while the dashboard is shown
- **THEN** its row updates in place

#### Scenario: Structure changes while shown

- **WHEN** a project or panel is created, closed, renamed, or reordered while the dashboard is shown
- **THEN** the list reflects that change without the user leaving Home

### Requirement: Home sidebar sections

While Home is selected the workspace SHALL offer a Home sidebar that works as a menu of exactly three sections, in this order: **Home**, **Tabs**, and **Automations**. Exactly one section SHALL be selected at a time, and the selected section SHALL fill the Home content area. The Home sidebar SHALL NOT show any project's Explorer, Documentation, Agents, or Git panes, and a project's sidebar SHALL NOT show the Home sections. The sidebar items SHALL be reachable by keyboard and SHALL expose the selected section to assistive technology.

The selected section SHALL be per-device presentation state, SHALL NEVER be written to server-owned workspace state, and SHALL be remembered across reconnects. That memory SHALL be a hint: when it cannot be read, or when device storage is unavailable, the Home section SHALL be selected and no error SHALL be reported.

#### Scenario: Choosing a section

- **WHEN** a user activates Tabs in the Home sidebar
- **THEN** the Tabs section fills the Home content area and Tabs is shown as selected

#### Scenario: Section remembered

- **WHEN** a device that last showed the Automations section selects Home again, or reconnects with Home selected
- **THEN** the Automations section is shown

#### Scenario: Storage unavailable

- **WHEN** device storage is unavailable, full, or disabled
- **THEN** the Home section is selected and no error is reported

#### Scenario: Sidebars do not mix

- **WHEN** a user moves between Home and a project
- **THEN** Home shows only its three sections and the project shows only its own sidebar panes

### Requirement: Home sidebar visibility

The project bar's sidebar toggle, its keyboard shortcut, and its command SHALL remain available while Home is selected, and SHALL show and hide the Home sidebar. Home sidebar visibility SHALL be device presentation state, kept apart from every project's sidebar visibility: toggling one SHALL NEVER change the other. A device that has no stored Home sidebar visibility SHALL show the Home sidebar open. After that, the device SHALL remember the visibility the user last chose. Below the narrow layout breakpoint, the Home sidebar SHALL follow the same navigation-drawer presentation and dismissal routes as a project sidebar.

#### Scenario: First visit to Home on a device

- **WHEN** a device with no stored Home sidebar visibility selects Home
- **THEN** the Home sidebar is shown open

#### Scenario: Hiding the Home sidebar

- **WHEN** a user hides the Home sidebar, leaves Home, and later selects Home again
- **THEN** the Home sidebar is hidden, and the selected section's content fills the area

#### Scenario: Independent from project sidebars

- **WHEN** a user toggles the sidebar while Home is selected
- **THEN** no project's sidebar visibility changes, and toggling a project's sidebar does not change the Home sidebar

#### Scenario: Narrow layout

- **WHEN** the Home sidebar is visible below the narrow layout breakpoint
- **THEN** it is presented as a navigation drawer over the content and closes on the navigation control, Escape, or activating the region behind it

### Requirement: Tabs section is the workspace dashboard

The Tabs section SHALL present the workspace dashboard — its rows, view modes, and activation behaviour — exactly as the dashboard requirements define them. Activating a project or panel from the Tabs section SHALL leave Home as those requirements define.

#### Scenario: Tabs shows the dashboard

- **WHEN** a user selects the Tabs section
- **THEN** every project and panel is shown in the dashboard's remembered view mode

#### Scenario: Activating a row from Tabs

- **WHEN** a user activates a panel row in the Tabs section
- **THEN** that panel's project is selected, Home is left, and the panel is focused

### Requirement: Home overview section

The Home section SHALL present a set of overview widgets derived from the same workspace inventory, agent state, connection state, and automation state that the rest of the workspace uses, so that no count ever reads differently here than elsewhere. It SHALL present: the number of open projects; the number of open tabs, with how many are terminals; agents counted by canonical state group (Needs you, Working, Done, Idle); remote connections and connected devices; active automations with the next scheduled run; and the most recent automation runs with their outcome. With more than one connection attached, each count SHALL cover every attached connection, and every automation widget SHALL name the server that owns each automation it lists. A connection that is unavailable SHALL be shown as unavailable rather than counted as zero. Widgets SHALL update live while shown.

Activating a widget SHALL take the user to the place that holds its detail: the project and agent widgets to the Tabs section, and the automation widgets to the Automations section, with the activated automation or run selected.

#### Scenario: Counts reflect the workspace

- **WHEN** a workspace holds three projects, seven tabs of which five are terminals, and two agents that need the user
- **THEN** the overview shows three projects, seven tabs with five terminals, and two agents in Needs you

#### Scenario: Live update

- **WHEN** an agent moves from Working to Done while the Home section is shown
- **THEN** the agent counts update without the user leaving the section

#### Scenario: Unavailable connection

- **WHEN** one attached connection is offline
- **THEN** its share of the counts is shown as unavailable rather than zero

#### Scenario: Activating an automation run

- **WHEN** a user activates a run in the recent-runs widget
- **THEN** the Automations section is shown with that run selected

#### Scenario: Empty workspace

- **WHEN** the workspace holds one empty project and no automations
- **THEN** the overview shows one project, zero tabs, zero agents, and an empty automations widget that offers to create an automation

### Requirement: Home search

While Home is selected, a band across the top of Home SHALL hold a search box that finds Home's sections and every project, tab, and agent of every attached connection, and every automation of every connection that serves automations. Matching SHALL be case-insensitive substring matching over names, as the dashboard filter's is, and SHALL rank a match at the start of a name or word above one elsewhere. Results SHALL be grouped by kind — sections, projects, tabs, agents, automations — and bounded per group. Choosing a result SHALL go to it exactly as activating it elsewhere in Home would: a section is selected, a project or tab is activated as a dashboard row is, an agent as a dashboard agent is, and an automation is opened in the Automations section. The search SHALL be reachable by keyboard, SHALL take focus on `/` while Home is shown and nothing is being typed into, SHALL say when nothing matches, and SHALL clear on Escape.

#### Scenario: Finding a tab

- **WHEN** a user types part of a tab's title into Home's search and chooses the result
- **THEN** Home is left, that tab's project is selected, and the tab is focused

#### Scenario: Finding a section

- **WHEN** a user types "autom" and presses Enter
- **THEN** the Automations section is selected and the search is cleared

#### Scenario: Keyboard focus

- **WHEN** Home is shown, nothing is being typed into, and the user presses `/`
- **THEN** the search box takes focus

#### Scenario: Nothing matches

- **WHEN** the search text matches nothing
- **THEN** the results say that nothing matches

### Requirement: The main window outlives its last project

Closing the last project in the window that presents a workspace's first view SHALL NOT close that window. The window SHALL stay open with no project and SHALL show Home, and the workspace view SHALL remain, holding no project. While a window holds no project it SHALL show Home whatever Home selection it remembers, and project-scoped commands SHALL act on nothing. Creating a project from such a window SHALL create it in the server's default project folder, SHALL leave Home, and SHALL show that project. Closing the last project in a window presenting any other view SHALL close that window as before.

#### Scenario: Closing the only project

- **WHEN** a user closes the only project in the main window
- **THEN** the window stays open, no project tab is shown, and Home is selected

#### Scenario: A project from an empty window

- **WHEN** a user creates a project in a window that holds none
- **THEN** it is created in the server's default project folder, Home is left, and the new project is shown with its terminal focused

#### Scenario: A popped-out window

- **WHEN** a user closes the last project in a popped-out window
- **THEN** that window closes
