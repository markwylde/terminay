# workspace-dashboard Specification

## Purpose

The Home dashboard is a per-device view of every project and every panel in a workspace, so a user can see the whole workspace at a glance without selecting each project in turn.

## Requirements

### Requirement: Home is a selectable view, not a project

A workspace view SHALL have exactly one selected view at a time: either Home or one project. Home SHALL NOT be a project: it has no environment, no root, no colour, and no server-owned panels or layout, and it SHALL NEVER appear in the ordered project list, in project ordering, or in the overflow switcher. The tabs Home holds SHALL be Home tabs, which are device presentation and never workspace panels. Selecting Home SHALL NOT close, suspend, unmount, or detach any project, panel, or terminal session, and every terminal SHALL continue to run and receive output exactly as it does while its project is in the background.

#### Scenario: Selecting Home

- **WHEN** a user selects Home
- **THEN** Home's tabs replace the project workspace area and no project tab is presented as active

#### Scenario: Terminals keep running

- **WHEN** Home is selected while terminals are running
- **THEN** every terminal keeps running and receiving output, and none is closed, suspended, or detached

#### Scenario: Home is not in the project list

- **WHEN** projects are ordered, overflowed, or listed in the switcher
- **THEN** Home is absent from that ordering and that list

#### Scenario: Home tabs are not workspace panels

- **WHEN** panels are counted, listed in the Tabs section, or shared with another device
- **THEN** Home tabs are absent from that count, that list, and that device

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

- **WHEN** the header Notifications list and project tab dots render
- **THEN** their contents are a filter over the inventory and unchanged from what they would show for the same panels

### Requirement: Dashboard row model

The dashboard SHALL present every project of every attached connection, in the window's tab order, carrying the project's colour, emoji, name, and a roll-up of its panels' statuses, together with every panel in that project, in panel order, carrying the panel's status, kind, title, and — for a terminal under agent authority — its agent state. Every project and every panel SHALL be keyed by the pair of its server and its own identity, and when more than one connection is attached each project SHALL name the server that owns it. A project with no panels SHALL still be presented. A connection that is unavailable or incompatible SHALL still contribute its projects, showing that connection's state in place of a panel roll-up. The dashboard SHALL show every project and every panel, including idle ones, and SHALL NEVER omit a project because nothing is happening in it.

#### Scenario: Projects and panels listed

- **WHEN** the dashboard renders
- **THEN** every project appears in project order with its panels in panel order

#### Scenario: Quiet workspace

- **WHEN** no project has any notable activity
- **THEN** every project and panel still appears, each showing an idle status

#### Scenario: Empty project

- **WHEN** a project holds no panels
- **THEN** it is still presented

#### Scenario: Projects from two attached servers

- **WHEN** two connections are attached and each owns projects
- **THEN** the dashboard lists the projects of both, each naming its own server, and no two servers' projects are merged

#### Scenario: Unavailable connection

- **WHEN** an attached connection is offline, reconnecting, or incompatible
- **THEN** its projects still appear and show that connection's state instead of a panel roll-up

### Requirement: Rows are single unwrapped lines

In the List view every row SHALL occupy exactly one line. Row text SHALL NEVER wrap, and content that does not fit the available width SHALL be truncated with a visible truncation indicator while the status affordance, project colour, and emoji stay visible. Narrowing the window SHALL truncate row text rather than reflow, re-order, or hide rows. The card views SHALL likewise truncate rather than wrap any single field, and SHALL NEVER hide a card because the window is narrow.

#### Scenario: Long title

- **WHEN** a panel title is wider than the available row width in the List view
- **THEN** the title is truncated with a visible truncation indicator and the row stays one line

#### Scenario: Narrow window

- **WHEN** the window is narrowed while the List view is shown
- **THEN** rows truncate their text and no row wraps, reorders, or disappears

#### Scenario: Narrow window in a card view

- **WHEN** the window is narrowed while a card view is shown
- **THEN** cards reflow into fewer columns, every field truncates rather than wrapping, and no card is hidden

### Requirement: Dashboard status vocabulary

Dashboard statuses SHALL use the same canonical status vocabulary and the same visual language as the terminal tab and activity surfaces, so one state never reads two ways. A terminal under agent authority SHALL show its agent state and SHALL NEVER show a competing raw-output activity state. A panel with nothing notable SHALL read as idle.

#### Scenario: Agent-owned terminal

- **WHEN** a terminal is under agent authority
- **THEN** the dashboard shows its agent state and shows no raw-output activity state for it

#### Scenario: Consistent presentation

- **WHEN** the same panel is shown on its terminal tab, in the activity menu, and on the dashboard
- **THEN** all three present the same canonical status

### Requirement: Row activation

Activating a project SHALL select that project and leave Home. Activating a panel SHALL select that panel's project, leave Home, and focus that panel. Activating an agent SHALL activate the panel that agent was started in. Activation SHALL behave identically in every view mode, and rows and cards SHALL carry no other action in the dashboard: they SHALL NOT close, rename, reorder, or create anything. Activating a project, panel, or agent that no longer exists SHALL leave the dashboard selected and refresh the view rather than failing.

#### Scenario: Activating a project row

- **WHEN** a user activates a project header row or a project card
- **THEN** that project becomes the selected view and Home is deselected

#### Scenario: Activating a panel row

- **WHEN** a user activates a panel row or a panel card
- **THEN** that panel's project becomes the selected view and that panel is focused

#### Scenario: Activating an agent

- **WHEN** a user activates an agent card
- **THEN** the project and panel that agent was started in are selected and focused

#### Scenario: Stale row

- **WHEN** a user activates a row or card whose project or panel has since been removed
- **THEN** the dashboard stays selected and refreshes its contents

### Requirement: Home control presentation

The Home control SHALL be an icon-only control on the project bar, and in the compact chrome row, showing a house glyph and distinguished from project tabs so that it never reads as a project. It SHALL show a selected state while Home is the selected view, SHALL be reachable by keyboard, and SHALL carry an accessible name naming Home. While Home is selected, the chrome band SHALL use a neutral Home colour rather than any project's colour. On the project bar, the selected Home control SHALL be drawn as a tab that opens into Home's tab strip in that colour, as the active project tab opens into its project's tab strip.

#### Scenario: Selected state

- **WHEN** Home is the selected view
- **THEN** the Home control shows its selected state, no project tab shows an active state, and the chrome band uses the neutral Home colour

#### Scenario: Selected Home control opens into the band

- **WHEN** Home is selected on the project bar
- **THEN** the Home control is drawn as a tab joined to Home's tab strip, both in the neutral Home colour

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

While Home is selected the workspace SHALL offer a Home sidebar that lists exactly three sections, in this order: **Home**, **Tabs**, and **Automations**. Activating a section SHALL open it as a Home tab, or bring its tab to the front where one is already open, so that no section is ever open twice. The sidebar SHALL show as current the section that the Home tab in front belongs to, and SHALL show none as current when no Home tab is open. A tab opened from within a section, such as an automation, SHALL count as belonging to that section. The Home sidebar SHALL NOT show any project's Explorer, Documentation, Agents, or Git panes, and a project's sidebar SHALL NOT show the Home sections. The sidebar items SHALL be reachable by keyboard and SHALL expose the current section to assistive technology.

#### Scenario: Choosing a section

- **WHEN** a user activates Tabs in the Home sidebar and no Tabs tab is open
- **THEN** a Tabs tab opens in front and Tabs is shown as current

#### Scenario: Section already open

- **WHEN** a user activates Automations in the Home sidebar while an Automations tab is open behind another tab
- **THEN** that tab comes to the front and no second Automations tab opens

#### Scenario: Current section follows the tab in front

- **WHEN** a user brings an automation's tab to the front
- **THEN** the sidebar shows Automations as current

#### Scenario: Section remembered

- **WHEN** a device that last had the Automations tab in front selects Home again, or reconnects with Home selected
- **THEN** the Automations tab is in front and the sidebar shows Automations as current

#### Scenario: Storage unavailable

- **WHEN** device storage is unavailable, full, or disabled
- **THEN** Home opens with the Home section's tab, the sidebar shows Home as current, and no error is reported

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

Activating a widget SHALL take the user to the place that holds its detail: the project and agent widgets SHALL open the Tabs section, an automation SHALL open that automation's tab, a run SHALL open that run's tab, and the offer to create an automation SHALL open a new automation tab. Each SHALL bring an already open tab to the front rather than opening a second.

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
- **THEN** that run's tab opens in front, and the Home section's tab stays open behind it

#### Scenario: Empty workspace

- **WHEN** the workspace holds one empty project and no automations
- **THEN** the overview shows one project, zero tabs, zero agents, and an empty automations widget that offers to create an automation

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

### Requirement: Dashboard view modes

The dashboard SHALL offer exactly three view modes over one model — List, Board, and Projects — selectable from a control in the dashboard header that names the current mode and is reachable by keyboard. Every mode SHALL present the same facts, differing only in arrangement: a status, count, or name SHALL NEVER read one way in one mode and another way in another.

- **List** SHALL present every project as a header row followed by its panels, one unwrapped line each.
- **Board** SHALL present one column per canonical status group, in the reading order Idle, Working, Needs you, Done, each holding one card per agent, or per panel where no agent owns it, named with the project it belongs to. Board is a triage view and MAY omit a project that has nothing in a column.
- **Projects** SHALL present one card per project holding that project's panels and agents.

The selected mode SHALL be per-device presentation state, SHALL NEVER be written to server-owned workspace state, and SHALL be remembered across reconnects. That memory SHALL be a hint: when it cannot be read, or when device storage is unavailable, the dashboard SHALL show the List view and SHALL report no error.

#### Scenario: Switching mode

- **WHEN** a user selects a different view mode
- **THEN** the dashboard re-arranges into that mode over the same projects, panels, and agents

#### Scenario: Board column order

- **WHEN** the Board view is shown
- **THEN** its status columns read, from the start of the reading direction, Idle, Working, Needs you, Done

#### Scenario: Mode is remembered

- **WHEN** a device that last used the Board view reopens the dashboard
- **THEN** the Board view is shown

#### Scenario: Storage unavailable

- **WHEN** device storage is unavailable, full, or disabled
- **THEN** the dashboard shows the List view and reports no error

#### Scenario: Two devices, different modes

- **WHEN** one device selects the Board view while another shows the List view of the same workspace
- **THEN** each device keeps its own mode and neither changes the other

#### Scenario: Board column with nothing in it

- **WHEN** no agent or panel in the workspace is in a status group
- **THEN** that Board column is shown as empty rather than removed, and no project is claimed to be missing

### Requirement: Dashboard agent detail

A terminal under agent authority SHALL carry, on every view mode, the detail its project's agent sidebar carries for the same agent: the agent's resolved display name, its provider and model, the prompt it is working on, its canonical state, whether its result is unread, and how many subagents it has. That detail SHALL be resolved by the same rules the agent sidebar resolves it by, so one agent SHALL NEVER be named one thing in a project and another thing on the dashboard. A subagent SHALL NEVER be presented as a top-level agent; it SHALL be counted on, and reachable through, its root agent.

The dashboard SHALL read the agent projection of every attached connection, not only the one being worked in. For a connection whose panels this window does not hold, its agents SHALL still be presented under the project its workspace projection assigns them, identified as agents without a panel.

#### Scenario: Agent-owned terminal

- **WHEN** a terminal is under agent authority
- **THEN** the dashboard shows that agent's name, provider, model, prompt, state, unread flag, and subagent count

#### Scenario: Same agent, two surfaces

- **WHEN** the same agent is shown in its project's agent sidebar and on the dashboard
- **THEN** both present the same resolved name and the same state

#### Scenario: Subagents

- **WHEN** a root agent has running subagents
- **THEN** the root is presented once carrying its subagent count and no subagent is presented as a top-level agent

#### Scenario: Agent on another attached server

- **WHEN** an attached connection this window is not working in reports a running agent
- **THEN** that agent appears on the dashboard under its own server's project

#### Scenario: Panel with no agent

- **WHEN** a terminal, file, or folder panel is under no agent authority
- **THEN** it is presented with its own title and status and no agent detail

### Requirement: Dashboard summary and filter

The dashboard SHALL present a summary of the whole workspace — the number of panels and agents needing a person, working, done, and idle — computed over every attached connection, with each contribution still belonging to exactly one server. The dashboard SHALL also offer a filter input that narrows every view mode to the projects, panels, and agents whose project name, panel title, agent name, provider, model, or prompt text matches the entered text, case-insensitively. A project SHALL be kept when it matches or when anything it holds matches. While a filter is active the dashboard SHALL say so and SHALL offer to clear it, so an empty result is never mistaken for an empty workspace. The filter SHALL be transient: it SHALL NOT be remembered across reconnects and SHALL NOT be written to server-owned workspace state.

#### Scenario: Summary counts

- **WHEN** the dashboard renders
- **THEN** it states how many panels and agents need a person, are working, are done, and are idle across every attached connection

#### Scenario: Filtering

- **WHEN** a user enters filter text
- **THEN** every view mode shows only the projects, panels, and agents matching it by name, title, provider, model, or prompt

#### Scenario: Filter matches nothing

- **WHEN** the filter text matches nothing
- **THEN** the dashboard says the filter is active, offers to clear it, and does not present the workspace as empty

#### Scenario: Filter is not remembered

- **WHEN** a device with an active filter reopens the dashboard
- **THEN** no filter is applied

### Requirement: Board grouping by project

While the Board view is selected the dashboard SHALL offer a "Group by project" control in the dashboard header, reachable by keyboard and stating whether grouping is on. The control SHALL NOT be offered in the List or Projects view. With grouping on, the Board SHALL keep its four status columns in the same order as the ungrouped Board — Idle, Working, Needs you, and Done — and SHALL band them into one lane per project, in the window's tab order, each lane naming its project and, when more than one connection is attached, the server that owns it. A lane SHALL hold exactly the cards the ungrouped Board presents for that project, each under the column the ungrouped Board places it in: grouping SHALL NEVER add, remove, or re-classify a card. Two projects on different servers SHALL NEVER share a lane. A project with nothing in any column MAY be given no lane. Activating a lane's heading SHALL activate that project.

Whether the Board is grouped SHALL be per-device presentation state, SHALL NEVER be written to server-owned workspace state, and SHALL be remembered across reconnects. That memory SHALL be a hint: when it cannot be read, or when device storage is unavailable, the Board SHALL be ungrouped and SHALL report no error.

#### Scenario: Grouping the Board
- **WHEN** a user on the Board view turns on "Group by project" in a workspace with agents in two projects
- **THEN** the Board shows one lane per project, each holding that project's cards under the Idle, Working, Needs you, and Done columns, in that order

#### Scenario: Grouping changes no card
- **WHEN** the Board is switched between grouped and ungrouped
- **THEN** the same cards are presented in both, each under the same status column, and the columns keep the same order

#### Scenario: Control is absent off the Board
- **WHEN** the List or Projects view is selected
- **THEN** no "Group by project" control is offered

#### Scenario: Activating a lane heading
- **WHEN** a user activates a lane's project heading
- **THEN** that project is selected and Home is left

#### Scenario: Grouping is remembered on this device
- **WHEN** a device that last grouped the Board reopens the dashboard on the Board view
- **THEN** the Board is grouped by project

#### Scenario: Unreadable grouping preference
- **WHEN** the remembered grouping cannot be read
- **THEN** the Board is ungrouped and no error is reported

### Requirement: Home tabs

Home SHALL present its content as tabs in a tab strip of its own, drawn where a project draws its panel tab strip and managed the same way: a user SHALL be able to open several Home tabs, bring any to the front, close any, reorder them by dragging, and arrange them side by side or stacked by dragging a tab to an edge. Each Home tab SHALL carry a title naming what it shows and a close control. Closing a Home tab SHALL close only that tab and SHALL NEVER close, stop, or delete the project, automation, run, or terminal it shows. Home tabs SHALL NOT be movable into a project, and project panels SHALL NOT be movable into Home.

#### Scenario: Two tabs side by side

- **WHEN** a user drags the Automations tab to the right edge of Home while the Tabs tab is open
- **THEN** both are shown side by side, each in its own tab strip

#### Scenario: Reordering

- **WHEN** a user drags a Home tab past its neighbour in the tab strip
- **THEN** the two tabs swap places and the tab in front does not change

#### Scenario: Closing a tab

- **WHEN** a user closes a Home tab showing an automation's run
- **THEN** the tab closes and the run is still in that automation's history

#### Scenario: Home and projects stay apart

- **WHEN** a user drags a Home tab over a project tab on the project bar
- **THEN** the tab stays in Home and the project is unchanged

### Requirement: Home tabs keep their state

A Home tab SHALL keep everything a user has put into it — text typed into fields, chosen options, filters, scroll position, and expanded items — while another Home tab is in front, while a project is the selected view, and while the Home sidebar is shown or hidden. Returning to the tab SHALL show it as it was left.

#### Scenario: Leaving for a project and coming back

- **WHEN** a user types a name and a command into a new automation tab without saving, selects a project, and then selects Home again
- **THEN** the new automation tab is still open in front with the name and command as typed

#### Scenario: Switching between Home tabs

- **WHEN** a user filters the Tabs section, brings the Automations tab to the front, and returns to the Tabs tab
- **THEN** the filter text and its results are as the user left them

### Requirement: Home tab arrangement is per-device and remembered

The Home tabs open on a device, their order, their arrangement, and which is in front SHALL be per-device presentation state and SHALL NEVER be written to server-owned workspace state. A device SHALL remember them and SHALL restore them when the workspace is next opened. That memory SHALL be a hint: a remembered tab whose automation, run, terminal, or connection no longer exists SHALL be left out; unsaved edits SHALL NOT be remembered, so a remembered new automation tab is left out and a remembered editor reopens showing the saved automation; and when the memory cannot be read, or device storage is unavailable, Home SHALL open with the Home section's tab alone and SHALL report no error. A device with nothing remembered SHALL open Home with the Home section's tab alone.

#### Scenario: Restored on relaunch

- **WHEN** a device that had the Tabs tab and an automation's tab open side by side is relaunched
- **THEN** both tabs are open side by side again

#### Scenario: Two devices

- **WHEN** one device opens an automation's tab in Home
- **THEN** no other device's Home tabs change

#### Scenario: Remembered tab no longer exists

- **WHEN** a device remembers a tab for an automation that was deleted while the device was closed
- **THEN** that tab is left out, the remaining tabs are restored, and no error is reported

#### Scenario: Storage unavailable

- **WHEN** device storage is unavailable, full, or disabled
- **THEN** Home opens with the Home section's tab alone and no error is reported

### Requirement: Home with no tabs open

When every Home tab is closed, Home SHALL show an empty state that names the three sections and opens the one a user activates. Home SHALL remain the selected view, and the Home sidebar SHALL remain available.

#### Scenario: Closing the last tab

- **WHEN** a user closes the only Home tab
- **THEN** Home stays selected and shows an empty state offering Home, Tabs, and Automations

#### Scenario: Opening from the empty state

- **WHEN** a user activates Automations in the empty state
- **THEN** the Automations tab opens in front

### Requirement: Home tabs on a compact workspace

On a compact workspace, where no panel tab strip is drawn, Home SHALL show only the Home tab in front, filling the content area whatever arrangement the device remembers. The Home sidebar, presented as a navigation drawer, SHALL remain the way to open a section, and a tab opened from within a section SHALL come to the front. Each Home tab that is not a section SHALL offer a control that closes it and returns to the tab that opened it, so that no tab is reachable only through a tab strip.

#### Scenario: Compact Home shows one tab

- **WHEN** a device that remembers two Home tabs side by side shows Home on a compact workspace
- **THEN** only the tab in front is shown, filling the content area

#### Scenario: Leaving an automation's tab without a tab strip

- **WHEN** a user on a compact workspace opens an automation from the Automations tab and then activates that tab's close control
- **THEN** the automation's tab closes and the Automations tab is in front
