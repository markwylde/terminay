# workspace-dashboard Specification

## Purpose

The Home dashboard is a per-device view of every project and every panel in a workspace, so a user can see the whole workspace at a glance without selecting each project in turn.

## Requirements

### Requirement: Home is a selectable view, not a project

A workspace view SHALL have exactly one selected view at a time: either Home or one project. Home SHALL NOT be a project: it has no environment, no root, no colour, and no server-owned panels or tab layout, and it SHALL NEVER appear in the ordered project list, in project ordering, or in the overflow switcher. The tabs Home holds SHALL be Home tabs, which are device presentation and never workspace panels. The only server-owned Home state SHALL be the overview layout, a server setting. Selecting Home SHALL NOT close, suspend, unmount, or detach any project, panel, or terminal session, and every terminal SHALL continue to run and receive output exactly as it does while its project is in the background.

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

While Home is selected, the workspace SHALL offer a Home sidebar that lists exactly six sections, in this order: **Home**, **Tabs**, **Bots**, **Automations**, **Workflows**, and **Recordings**.

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
- **THEN** Home shows only its six sections and the project shows only its own sidebar panes

#### Scenario: Replay belongs to Recordings

- **WHEN** a user brings a recording's replay tab to the front
- **THEN** the sidebar shows Recordings as current

#### Scenario: Workflows sits between Automations and Recordings

- **WHEN** a user selects Home
- **THEN** the sidebar lists Home, Tabs, Bots, Automations, Workflows, and Recordings in that order

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

The Home section SHALL present a set of overview widgets derived from the same workspace inventory, agent state, connection state, automation state, bot state, workflow state, and notifications that the rest of the workspace uses, so that no count ever reads differently here than elsewhere. The widget catalogue SHALL be:

- **Quick actions**: New project, New bot, New automation, Open Command Bar, and Settings. Each SHALL do exactly what the command of the same name in Home's Command Bar does.
- **Needs you**: every agent in Needs you, every bot session waiting on the user, and every workflow that has a step needing input or failed.
- **Agents**: agents counted by canonical state group (Needs you, Working, Done, Idle) as a ring with a labelled legend.
- **Workflows**: the workflows attached to running terminals.
- **Bots**: each bot's activity and environment, and the next trigger firing.
- **Run history**: the most recent automation runs, with their success rate.
- **Pull requests**: the pull requests of the folders that hold panels.
- **Notifications**: the notifications the Notifications control lists, each of which can be opened or dismissed.
- **Projects**: each open project with its colour, emoji, and per-status counts.
- **Bot sessions**: the most recent bot sessions across bots, with their state.
- **Automations**: active automations with the next scheduled run.
- **Recordings**: the most recent recordings of the server the window is working in.
- **Tabs**: the number of open tabs, with how many are terminals.
- **Connections**: remote connections and connected devices.

With more than one connection attached, each count SHALL cover every attached connection, and every automation and bot widget SHALL name the server that owns each item it lists. The Workflows and Pull requests widgets and the workflow part of Needs you SHALL cover only the server whose panels the window holds, and SHALL name each other attached server as not counted. A connection that is unavailable SHALL be shown as unavailable rather than counted as zero. Every widget except Recordings SHALL update live while shown. A status colour SHALL always be accompanied by a label or an accessible name. An item SHALL be identified by its server together with its own id, so that equal ids on two servers are never confused.

Activating a widget item SHALL take the user to the place that holds its detail: the project and agent widgets SHALL open the Tabs section; an agent, workflow, notification, or pull request SHALL activate its panel in its project; a bot or bot session SHALL open that bot's tab; an automation SHALL open that automation's tab; a run SHALL open that run's tab; a recording SHALL open its replay tab; and the offer to create an automation SHALL open a new automation tab. Each SHALL bring an already open tab to the front rather than opening a second. A target SHALL be resolved when it is activated, so activating an item whose target has gone does nothing. Dismissing a notification SHALL do exactly what dismissing it from the Notifications control does.

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

- **WHEN** a user activates a run in the run-history widget
- **THEN** that run's tab opens in front, and the Home section's tab stays open behind it

#### Scenario: Empty workspace

- **WHEN** the workspace holds one empty project and no automations
- **THEN** the overview shows one project, zero tabs, zero agents, and an empty automations widget that offers to create an automation

#### Scenario: Two servers

- **WHEN** a window holds the panels of server A and is also attached to server B, and both have a bot with the same id
- **THEN** the Bots widget lists both bots, each named with its server, and the Workflows widget lists only server A's workflows and names B as not counted

#### Scenario: A target that has gone

- **WHEN** a user activates a workflow row whose terminal closed after the row was shown
- **THEN** nothing is activated and Home stays as it was

### Requirement: The main window outlives its last project

Closing the last project in the window that presents a workspace's first view SHALL NOT close that window. The window SHALL stay open with no project and SHALL show Home, and the workspace view SHALL remain, holding no project. While a window holds no project it SHALL show Home whatever Home selection it remembers, and project-scoped commands SHALL act on nothing. Creating a project from such a window SHALL create it awaiting a start choice, SHALL leave Home, and SHALL show that project's start chooser. Closing the last project in a window presenting any other view SHALL close that window as before.

#### Scenario: Closing the only project

- **WHEN** a user closes the only project in the main window
- **THEN** the window stays open, no project tab is shown, and Home is selected

#### Scenario: A project from an empty window

- **WHEN** a user creates a project in a window that holds none
- **THEN** it is created awaiting a start choice, Home is left, and the project's start chooser is shown with its first start action focused

#### Scenario: A popped-out window

- **WHEN** a user closes the last project in a popped-out window
- **THEN** that window closes

### Requirement: Dashboard view modes

The dashboard SHALL offer exactly three view modes over one model — List, Board, and Projects — selectable from a control in the dashboard header that names the current mode and is reachable by keyboard. Every mode SHALL present the same facts, differing only in arrangement: a status, count, or name SHALL NEVER read one way in one mode and another way in another.

- **List** SHALL present every project as a header row followed by its panels, one unwrapped line each.
- **Board** SHALL present one column per canonical status group, in the reading order Idle, Working, Needs you, Done, followed by the Untracked column. Each column holds one card per agent, or per panel where no agent owns it, named with the project it belongs to. Board is a triage view and MAY omit a project that has nothing in a column.
- **Projects** SHALL present one card per project holding that project's panels and agents.

The selected mode SHALL be per-device presentation state, SHALL NEVER be written to server-owned workspace state, and SHALL be remembered across reconnects. That memory SHALL be a hint: when it cannot be read, or when device storage is unavailable, the dashboard SHALL show the List view and SHALL report no error.

#### Scenario: Switching mode

- **WHEN** a user selects a different view mode
- **THEN** the dashboard re-arranges into that mode over the same projects, panels, and agents

#### Scenario: Board column order

- **WHEN** the Board view is shown
- **THEN** its columns read, from the start of the reading direction, Idle, Working, Needs you, Done, Untracked

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

The dashboard SHALL present a summary of the whole workspace — the number of panels and agents needing a person, working, done, and idle, and the number of untracked terminals — computed over every attached connection, with each contribution still belonging to exactly one server. An untracked terminal and its agent SHALL be counted only as untracked and SHALL NEVER be counted as needing a person, working, done, or idle. The untracked count MAY be omitted while it is zero. The dashboard SHALL also offer a filter input that narrows every view mode to the projects, panels, and agents whose project name, panel title, agent name, provider, model, or prompt text matches the entered text, case-insensitively. A project SHALL be kept when it matches or when anything it holds matches. While a filter is active the dashboard SHALL say so and SHALL offer to clear it, so an empty result is never mistaken for an empty workspace. The filter SHALL be transient: it SHALL NOT be remembered across reconnects and SHALL NOT be written to server-owned workspace state.

#### Scenario: Summary counts

- **WHEN** the dashboard renders
- **THEN** it states how many panels and agents need a person, are working, are done, and are idle across every attached connection, and how many terminals are untracked when any are

#### Scenario: Untracked terminal in the summary

- **WHEN** an untracked terminal is running a command
- **THEN** the summary counts it as untracked and not as working

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

While the Board view is selected the dashboard SHALL offer a "Group by project" control in the dashboard header, reachable by keyboard and stating whether grouping is on. The control SHALL NOT be offered in the List or Projects view. With grouping on, the Board SHALL keep its columns in the same order as the ungrouped Board — Idle, Working, Needs you, Done, and Untracked — and SHALL band them into one lane per project, in the window's tab order, each lane naming its project and, when more than one connection is attached, the server that owns it. The Untracked column's collapsed state SHALL apply to it in every lane. A lane SHALL hold exactly the cards the ungrouped Board presents for that project, each under the column the ungrouped Board places it in: grouping SHALL NEVER add, remove, or re-classify a card. Two projects on different servers SHALL NEVER share a lane. A project with nothing in any column MAY be given no lane. Activating a lane's heading SHALL activate that project.

Whether the Board is grouped SHALL be per-device presentation state, SHALL NEVER be written to server-owned workspace state, and SHALL be remembered across reconnects. That memory SHALL be a hint: when it cannot be read, or when device storage is unavailable, the Board SHALL be ungrouped and SHALL report no error.

#### Scenario: Grouping the Board
- **WHEN** a user on the Board view turns on "Group by project" in a workspace with agents in two projects
- **THEN** the Board shows one lane per project, each holding that project's cards under the Idle, Working, Needs you, Done, and Untracked columns, in that order

#### Scenario: Grouping changes no card
- **WHEN** the Board is switched between grouped and ungrouped
- **THEN** the same cards are presented in both, each under the same column, and the columns keep the same order

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

When every Home tab is closed, Home SHALL show an empty state that names the six sections and opens the one a user activates. Home SHALL remain the selected view, and the Home sidebar SHALL remain available.

#### Scenario: Closing the last tab

- **WHEN** a user closes the only Home tab
- **THEN** Home stays selected and shows an empty state offering Home, Tabs, Bots, Automations, Workflows, and Recordings

#### Scenario: Opening from the empty state

- **WHEN** a user activates Automations in the empty state
- **THEN** the Automations tab opens in front

### Requirement: Home tabs on a compact workspace

On a compact workspace, where no panel tab strip is drawn, Home SHALL show only the Home tab in front, filling the content area whatever arrangement the device remembers. The switcher's Home panel, reached from the Home item of its rail, SHALL be the way to open a section, and a tab opened from within a section SHALL come to the front. Each Home tab that is not a section SHALL offer a control that closes it and returns to the tab that opened it, so that no tab is reachable only through a tab strip.

#### Scenario: Compact Home shows one tab

- **WHEN** a device that remembers two Home tabs side by side shows Home on a compact workspace
- **THEN** only the tab in front is shown, filling the content area

#### Scenario: Opening a section from the drawer

- **WHEN** a user on a compact workspace opens the switcher, selects Home in the rail, and chooses Automations
- **THEN** Home is selected with the Automations tab in front and the switcher is dismissed

#### Scenario: Leaving an automation's tab without a tab strip

- **WHEN** a user on a compact workspace opens an automation from the Automations tab and then activates that tab's close control
- **THEN** the automation's tab closes and the Automations tab is in front

### Requirement: Untracked column

The Board SHALL present an **Untracked** column after Done. It SHALL hold one card for every untracked terminal, as specified by `terminal-activity-signals`, together with the agent bound to it, and no untracked terminal or its agent SHALL appear in any other Board column. A card in the Untracked column SHALL show no activity or agent state. The column SHALL be collapsible by a control in its header that is reachable by keyboard, states whether the column is collapsed, and names how many cards the column holds. A collapsed column SHALL keep its header and count visible and SHALL hide its cards. The column SHALL be shown, and SHALL say it is empty, when no terminal is untracked.

Whether the Untracked column is collapsed SHALL be per-device presentation state, SHALL NEVER be written to server-owned workspace state, and SHALL be remembered across reconnects. The column SHALL start collapsed. That memory SHALL be a hint: when it cannot be read, or when device storage is unavailable, the column SHALL be collapsed and SHALL report no error.

In the List and Projects views an untracked terminal SHALL be presented in its usual place as an idle panel, with no activity or agent state.

#### Scenario: Untracked tab on the Board

- **WHEN** a user turns off **Track activity** on a working terminal and opens the Board view
- **THEN** that terminal's card is in the Untracked column and in no other column

#### Scenario: Untracked tab in List and Projects views

- **WHEN** the List or Projects view is shown and a terminal is untracked
- **THEN** the terminal is presented in its usual place as idle

#### Scenario: Untracked column starts collapsed

- **WHEN** a device with no remembered preference shows the Board with two untracked terminals
- **THEN** the Untracked column is collapsed, its header says it holds 2, and its cards are hidden

#### Scenario: Expanding the column is remembered

- **WHEN** a user expands the Untracked column and later reopens the dashboard on the same device
- **THEN** the Untracked column is expanded

#### Scenario: Unreadable collapse preference

- **WHEN** the remembered collapse state cannot be read
- **THEN** the Untracked column is collapsed and no error is reported

#### Scenario: Agent in an untracked tab

- **WHEN** an agent is bound to an untracked terminal
- **THEN** its card is in the Untracked column and shows no agent state

### Requirement: Terminals outside the window's projects

The Tabs section SHALL list every terminal on the window's current server,
including terminals no project tab in this window presents. After the
window's own projects, it SHALL list each project of another workspace view
that holds a terminal, titled with the project's name and "not in this
window", and then the automation space, titled "Automations", each with their
terminals. Activating a terminal of the automation space SHALL open it in the
Automations section. Activating a terminal or project of another view SHALL
bring that project into this window. The automation space SHALL NOT become a
project tab.

#### Scenario: An agent opened a terminal in the automation space

- **WHEN** Pixel opens a terminal with no project and the user opens Tabs
- **THEN** the terminal is listed under Automations, and activating it opens it in the Automations section

#### Scenario: A project in a view no window shows

- **WHEN** a project with a running terminal is in a workspace view this window does not present
- **THEN** Tabs lists it as not in this window, and activating it brings the project into this window

#### Scenario: Nothing elsewhere

- **WHEN** every terminal on the server is in this window's projects
- **THEN** Tabs lists only this window's projects

### Requirement: Dashboard shows a panel's pull request and checks

Every panel the dashboard presents, and every agent card for an agent running in a panel, SHALL show the pull request and checks summary of the worktree its folder stands for, worded and coloured as that folder's Folders row shows them. Every panel in one folder SHALL show the same facts. A panel whose folder has neither SHALL show neither. The facts SHALL appear on every view mode and SHALL carry no action of their own.

#### Scenario: Agent card in a worktree with a pull request

- **WHEN** an agent runs in a terminal whose folder's worktree has pull request #99 open with 12 checks running
- **THEN** its Board card shows `PR #99` and `12 running`

#### Scenario: Two terminals in one worktree

- **WHEN** two terminals are in the same folder and its worktree has a pull request
- **THEN** both terminals' cards show the same pull request and checks

#### Scenario: Folder with no pull request

- **WHEN** a panel's folder worktree has no pull request and no checks
- **THEN** its card shows no pull request or checks chip

#### Scenario: Same facts as the Folders row

- **WHEN** the same folder is shown in the Folders sidebar and a panel of it on the dashboard
- **THEN** both show the same pull request number, state, and checks count

#### Scenario: Activating a chip

- **WHEN** a user activates the pull request or checks chip on a dashboard card
- **THEN** the card is activated and no browser or check list opens

### Requirement: Needs you widget

The Needs you widget SHALL list, in this order: first every agent in Needs you, every bot session waiting on a decision or permission, and every workflow whose current step needs input, ordered oldest first by when each entered that state (an agent's state start, a session's start, a step's start); then every workflow with a failed step and no step needing input, oldest failure first. It SHALL show how many items are waiting and, when none are, say that nothing needs the user.

#### Scenario: Everything that needs the user in one place

- **WHEN** one agent is waiting, one bot session asks for permission, and one workflow step needs input
- **THEN** the Needs you widget lists all three, and activating the bot session opens that bot's tab

#### Scenario: Nothing waiting

- **WHEN** no agent, bot session, or workflow needs the user
- **THEN** the Needs you widget says nothing needs the user

### Requirement: Workflows widget

The Workflows widget SHALL list every workflow attached to a running terminal of the server whose panels the window holds, each with its progress dial, its step bar, its current step, and how many steps are done. Unfinished workflows SHALL come first: those with a step needing input or failed, then those with a step running, then the rest; finished workflows SHALL follow, most recently finished first. The current step SHALL be the step running or needing input, otherwise the first failed step, otherwise the first step not done. Elapsed time SHALL be the time since the current step started, and SHALL be shown only while that step is running or needs input. A workflow that could not be restored SHALL be listed as such.

#### Scenario: A running workflow

- **WHEN** a terminal's workflow has three of eight steps done and a step running
- **THEN** the Workflows widget shows that terminal with its dial, the running step's title, "3 of 8", and the time since the step started, and activating it activates that terminal

#### Scenario: A finished workflow

- **WHEN** a terminal's workflow has every step done
- **THEN** it is listed after every unfinished workflow, with a full dial

### Requirement: Pull requests widget

The Pull requests widget SHALL list one row per folder that holds a panel and has a pull request in state open or draft, with its number, title, draft marker, and check counts, or "No checks" when the folder has no check data. Rows with a failed check SHALL come first, then rows with a pending check, then the rest. Activating a row SHALL activate the first panel of that folder in the order the Tabs section lists them.

#### Scenario: A pull request with failing checks

- **WHEN** a folder that holds two panels has an open pull request with one failed check of four
- **THEN** the Pull requests widget lists it once, first, with its number, title, and check counts, and activating it activates the folder's first panel

#### Scenario: A merged pull request

- **WHEN** a folder's pull request is merged
- **THEN** the Pull requests widget does not list it

### Requirement: Run history widget

The Run history widget SHALL show the most recent thirty automation runs as a strip of marks coloured by outcome, each named by its automation, outcome, and start time, and list the latest three runs. Its success rate SHALL be the share of succeeded runs among the strip's runs that succeeded, failed, or timed out; running, skipped, and cancelled runs SHALL be counted separately and not in the rate. With no finished runs, it SHALL show no rate.

#### Scenario: Success rate

- **WHEN** the last thirty runs are twenty-six succeeded, two failed, one skipped, and one running
- **THEN** the widget shows a success rate of 93% and counts one skipped and one running separately

### Requirement: Recordings widget freshness

The Recordings widget SHALL read the most recent five recordings when the overview is shown and each time Home is selected again. It SHALL NOT read on a timer. While its read is in progress it SHALL say so, and when the read fails or the server does not support recordings it SHALL say that instead of showing an empty list.

#### Scenario: Returning to Home

- **WHEN** a user stops a recording in a project and then selects Home
- **THEN** the Recordings widget lists that recording

#### Scenario: Unsupported server

- **WHEN** the server the window is working in does not support recordings
- **THEN** the Recordings widget says recordings are unavailable on that server

### Requirement: Customising the Home overview

The Home overview SHALL offer an edit mode in which the user can hide any widget, show a hidden widget again, reorder widgets by dragging them or with move-earlier and move-later controls, choose each widget's size from the sizes that widget allows, and reset the overview to its default layout. Quick actions SHALL allow small and wide; every other widget SHALL allow small, wide, and tall. While in edit mode, activating a widget SHALL NOT navigate. Each change SHALL take effect immediately.

#### Scenario: Hiding a widget

- **WHEN** a user enters edit mode and hides the Connections widget
- **THEN** Connections leaves the grid and appears in the list of hidden widgets, from which it can be added back

#### Scenario: Reordering by keyboard

- **WHEN** a user in edit mode focuses the Bots widget and activates Move earlier
- **THEN** Bots swaps places with the widget shown before it

#### Scenario: Resizing

- **WHEN** a user in edit mode sets the Workflows widget to wide
- **THEN** it spans two columns of the grid

#### Scenario: Resetting

- **WHEN** a user in edit mode activates Reset
- **THEN** every widget returns to its default visibility, order, and size

### Requirement: Home overview grid order

Widgets SHALL be placed in the stored order, left to right and top to bottom, and the visual order SHALL equal the stored order and the keyboard focus order; a later widget SHALL NOT be moved ahead of an earlier one to fill a gap. When the overview is narrow enough to fit only one column, a wide widget SHALL take that one column and a tall widget SHALL keep its height.

#### Scenario: Mixed sizes keep their order

- **WHEN** a small widget follows a wide widget that does not fit on the current row
- **THEN** the small widget is placed after the wide widget, not in the gap before it

#### Scenario: One column

- **WHEN** the overview fits only one column
- **THEN** every widget, including a wide one, takes that column in the stored order

### Requirement: Home overview layout storage

The Home overview layout SHALL be stored as a server setting of the server the window is working in, so that every device attached to that server shows the same layout. It SHALL hold only widget identities, sizes, and visibility. Home tab arrangement and section selection SHALL remain per-device.

#### Scenario: Layout on a second device

- **WHEN** a user hides Connections and widens Workflows on one device
- **THEN** another device attached to the same server shows Connections hidden and Workflows wide

### Requirement: Home overview layout resolution

A stored entry naming a widget this client does not know SHALL be kept and not shown. A widget the stored layout does not name SHALL appear at its default size and visibility after the named ones. A stored size the widget does not allow SHALL be shown as that widget's default size.

#### Scenario: A widget added later

- **WHEN** a stored layout predates a widget in the catalogue
- **THEN** that widget appears after the stored widgets at its default size, and the stored order is unchanged

#### Scenario: Unknown widget kept

- **WHEN** a client reads a layout that names a widget it does not know and then changes another widget's size
- **THEN** the unknown entry is written back unchanged

#### Scenario: Unsupported size

- **WHEN** a stored layout gives Quick actions the size tall
- **THEN** Quick actions is shown at its default size

### Requirement: Home overview layout save failure

When saving a layout change fails, the overview SHALL return to the layout the server last confirmed and SHALL say that the change could not be saved. Successive changes SHALL be saved in the order they were made, and the last change SHALL be the one that persists.

#### Scenario: Save fails

- **WHEN** a user hides a widget and the server refuses the change
- **THEN** the widget is shown again and the overview says the layout could not be saved

#### Scenario: Rapid edits

- **WHEN** a user moves a widget twice in quick succession
- **THEN** the server holds the result of the second move

### Requirement: Workflows section lists the window's workflows

The Workflows section SHALL show, as one horizontally scrolling row of columns, one column for every workflow attached to a terminal panel that the window's dashboard lists. A workflow whose terminal the dashboard does not list SHALL NOT be shown. The section SHALL cover the window's one server and SHALL NOT merge workflows across servers.

#### Scenario: Workflows from two projects

- **WHEN** project A has two terminals with workflows and project B has one
- **THEN** the Workflows section shows three columns

#### Scenario: Terminal the dashboard does not list

- **WHEN** the server reports a workflow for a terminal session that no dashboard panel row holds
- **THEN** no column is shown for it

### Requirement: Workflow column content

Each column SHALL show the workflow's name, its project and terminal title, steps done out of total, the time since its first step started or that it is finished, a collapsible brief holding the opening prompt, and each step's marker, time, and note as the expanded workflow panel shows them. Every `running`, `failed`, or `needs_input` step SHALL be highlighted. All workflow text SHALL be rendered as plain text.

#### Scenario: Running step

- **WHEN** a workflow has three of seven steps done with notes, and its fourth step has been running for 14 minutes
- **THEN** its column shows "3 of 7 done", the three notes, and the fourth step highlighted with "14m"

#### Scenario: Earlier failure and a running step

- **WHEN** step 2 failed and step 4 is running
- **THEN** both steps are highlighted

#### Scenario: Note containing markup

- **WHEN** a step's note is `<img src=x onerror=alert(1)>`
- **THEN** the column shows those characters and nothing else happens

### Requirement: Workflow tone

Each shown workflow SHALL have one tone, used by every status filter, count, mark, and sort in the section and by the sidebar count: **Needs you** when any step is `failed` or `needs_input`, or when the workflow could not be restored; otherwise **Running** when a step is `running`; otherwise **Done** when every step is `done`; otherwise **Idle**. A column whose tone is Needs you SHALL be marked as needing the user.

#### Scenario: A step needs the user

- **WHEN** an agent sets a step to `needs_input` with the note "Keep finished workflows?"
- **THEN** that column is marked as needing the user, and shows the step with a red marker and the note

#### Scenario: Failed and running

- **WHEN** one step failed and a later step is running
- **THEN** the workflow's tone is Needs you

### Requirement: Unrestorable workflow column

A workflow that could not be restored SHALL be shown as a column named "Workflow could not be restored" that names its terminal and project, has the Needs you tone, and offers only the open control. For text filtering it SHALL match on its terminal title and project name, and grouped by Workflow it SHALL be in a group of that name.

#### Scenario: Unrestorable

- **WHEN** a terminal's workflow could not be restored
- **THEN** its column says "Workflow could not be restored", names the terminal, and counts toward Needs you

### Requirement: Opening a workflow's terminal

Each column SHALL offer a control that opens its terminal exactly as activating that terminal's row on the dashboard does, including for a terminal in the automation space or in a project another workspace view shows. A column rendered before its terminal went away SHALL do nothing when activated. The section SHALL NOT change any workflow or step, and SHALL NOT type into any terminal.

#### Scenario: Opening the terminal

- **WHEN** a user activates the open control of a column whose terminal is in a project of this window
- **THEN** the project is selected, Home is left, and that terminal is focused

#### Scenario: Automation terminal

- **WHEN** a user activates the open control of a column whose terminal is in the automation space
- **THEN** Home stays selected and that terminal opens in a Home tab, as from the dashboard

#### Scenario: Stale column

- **WHEN** a user activates the open control of a column whose terminal was closed a moment before
- **THEN** nothing is opened and no error is shown

### Requirement: Workflows section updates live

The section SHALL update while shown and while its tab is hidden: a workflow that is launched, changed, replaced, or removed, and a terminal that is renamed, moved, or closed, SHALL be reflected without the user leaving the section.

#### Scenario: Step update

- **WHEN** an agent marks a step done while the Workflows section is shown
- **THEN** the column shows that step done with its note

#### Scenario: Terminal closed

- **WHEN** a terminal with a workflow is closed while the section is shown
- **THEN** its column disappears

#### Scenario: Terminal renamed

- **WHEN** a terminal with a workflow is renamed
- **THEN** its column shows the new title

### Requirement: Workflows section loading and empty states

Until the server's workflows have been read once, the section SHALL say that workflows are loading rather than that there are none. When no workflow can be shown, it SHALL say there are no workflows and that a workflow is launched from a terminal's Command Bar. When filters leave none of the existing workflows, it SHALL say that no workflow matches the view and offer **Reset view**.

#### Scenario: Before the first read

- **WHEN** the section opens before the server has answered the first workflow read
- **THEN** it says workflows are loading

#### Scenario: No workflows

- **WHEN** no terminal the dashboard lists has a workflow
- **THEN** the section says there are no workflows and that one is launched from a terminal's Command Bar

#### Scenario: Nothing matches

- **WHEN** the filters leave no workflow to show while three exist
- **THEN** the section says no workflow matches the view, and Reset view shows all three

### Requirement: Workflows text filter

The section SHALL offer a text filter that shows only workflows whose name, terminal title, or project name contains the text, ignoring case. The section SHALL state how many workflows it shows out of how many there are.

#### Scenario: Text filter

- **WHEN** a user types "pairing" and one terminal is titled "claude · pairing"
- **THEN** only that terminal's workflow is shown, and the count reads "1 of" the total

### Requirement: Workflows status filter

The section SHALL offer status filters **Needs you**, **Running**, and **Done**, by tone. Any number MAY be selected; none selected SHALL mean every tone, and with any selected only workflows of a selected tone SHALL be shown. Each filter SHALL show how many workflows in the included projects have its tone, and SHALL expose whether it is selected to assistive technology.

#### Scenario: Two status filters

- **WHEN** a user selects Needs you and Running
- **THEN** workflows of those tones are shown, and Done and Idle workflows are not

### Requirement: Workflows project filter

The section SHALL offer a project filter listing every project that holds a shown workflow, each of which the user MAY include or leave out, and a control that includes all or leaves all out. Every project SHALL be included until the user leaves it out, so a project the device has not seen before is included.

#### Scenario: Leaving a project out

- **WHEN** a user leaves project B out
- **THEN** no workflow of project B is shown, and the status counts cover only the other projects

#### Scenario: A new project is included

- **WHEN** a user has left project B out and a workflow appears in a new project C
- **THEN** project C's workflow is shown

### Requirement: Show finished toggle

The section SHALL offer a **Show finished** toggle, on by default, that hides workflows whose tone is Done when off.

#### Scenario: Hiding finished workflows

- **WHEN** a user turns Show finished off
- **THEN** workflows whose every step is done are hidden

### Requirement: Workflows grouping

The section SHALL offer grouping by **None**, **Project**, or **Workflow**. By Project, each project's workflows SHALL form one group named by the project; by Workflow, workflows sharing a name SHALL form one group named by it. Each group SHALL state how many workflows it holds and how many have each of the Needs you, Running, and Done tones. Groups SHALL be ordered by their first workflow under the chosen sort. A column SHALL NOT repeat the name its group shows.

#### Scenario: Grouping by project

- **WHEN** a user groups by Project with workflows in three projects
- **THEN** three groups are shown, each named by its project, and no column names its project

#### Scenario: Grouping by workflow

- **WHEN** a user groups by Workflow and three workflows are named "OpenSpec: Propose → Ship"
- **THEN** one group of that name holds those three columns

### Requirement: Workflows group layout

While grouped, the section SHALL offer to lay groups out **Side by side**, one after another in the one horizontally scrolling row, or as **Rows**, each group a row of its own that scrolls sideways independently, with the rows stacked and scrolling vertically.

#### Scenario: Project rows

- **WHEN** a user groups by Project and chooses Rows
- **THEN** each project is a row of its own, and scrolling one row sideways does not move the others

### Requirement: Folding a group

Each group SHALL offer a control that folds it to its header and a progress dial for each of its workflows, and unfolds it again. The control SHALL be reachable by keyboard and SHALL expose whether the group is expanded.

#### Scenario: Folding a group

- **WHEN** a user folds the group of project B
- **THEN** its columns are hidden, its header remains with a dial per workflow, and unfolding shows the columns again

### Requirement: Workflows sort

The section SHALL offer four sorts. **Needs you first** SHALL order by tone (Needs you, Running, Idle, Done), then by most recent step time. **Recently updated** SHALL order by the latest start or end time of any step, newest first, with workflows that have none last. **Most progress** SHALL order by share of steps done, most first. **Name** SHALL order by workflow name, then terminal title.

#### Scenario: Needs you first

- **WHEN** one workflow is running, one has a failed step, and one is finished
- **THEN** the failed one comes first, then the running one, then the finished one

#### Scenario: Recently updated

- **WHEN** workflow A's latest step started 2 minutes ago and workflow B's ended 10 minutes ago
- **THEN** A comes before B

### Requirement: Workflows density

The section SHALL offer to show step notes **Full**, cut to **2 lines**, or for **Current only**, which shows the notes of every `running`, `failed`, or `needs_input` step and no other; and a **Narrow columns** toggle. Neither SHALL change which workflows are shown.

#### Scenario: Current only

- **WHEN** a user chooses Current only and step 2 failed while step 4 runs
- **THEN** the notes of steps 2 and 4 are shown and no other step's note

### Requirement: Workflows view is per-device and remembered

The section's filters, grouping, layout, sort, density, toggles, and folded groups SHALL be per-device presentation state, NEVER written to server-owned state. A device SHALL restore them when the section is next shown, including after the client reloads. When device storage is unavailable or unreadable, the section SHALL use the defaults and report no error.

#### Scenario: Restored after reload

- **WHEN** a user groups by Project in Rows and the client reloads
- **THEN** the Workflows section is grouped by Project in Rows

#### Scenario: Two devices

- **WHEN** one device groups the section by Workflow
- **THEN** no other device's Workflows section changes

#### Scenario: Storage unavailable

- **WHEN** device storage is unavailable, full, or disabled
- **THEN** the section opens with the default view and no error is reported

### Requirement: Reset view

**Reset view** SHALL return every option to its default: no text, no status selected, every project included, no grouping, Side by side, Needs you first, Full notes, finished shown, normal width, and no group folded.

#### Scenario: Reset view

- **WHEN** a user has filtered, grouped, and sorted the section and activates Reset view
- **THEN** every option returns to its default and every workflow is shown

### Requirement: Workflows needing the user are counted on the sidebar

The Workflows item in the Home sidebar SHALL show how many workflows the section could show have the Needs you tone, whatever the section's filters and whether or not its tab is open, and no count when there are none. The count SHALL update live and SHALL be part of the item's accessible name.

#### Scenario: Two workflows need the user

- **WHEN** one workflow has a failed step and another has a step waiting for input, and the Workflows tab is closed
- **THEN** the Workflows item shows 2, and its accessible name says two workflows need you

#### Scenario: Answered

- **WHEN** the waiting step is set back to running
- **THEN** the count drops to 1 without the user leaving Home

### Requirement: Show workflows command

The Command Bar SHALL offer **Show workflows** wherever it offers **Show dashboard**: with a project selected, with Home selected, and with no project in the window. It SHALL select Home and open the Workflows section, or bring its tab to the front where one is open.

#### Scenario: From a project

- **WHEN** a user runs Show workflows while a project is selected
- **THEN** Home is selected with the Workflows tab in front

#### Scenario: Already open

- **WHEN** a user runs Show workflows with Home selected and the Workflows tab behind another tab
- **THEN** that tab comes to the front and no second Workflows tab opens

### Requirement: Unread bot posts are counted on the Home control

The Home control on the project bar SHALL show the window's unread bot post count: the sum of the post counts of the bot notifications the window's server has published to it, over the bots that window knows. It SHALL show no count when that sum is zero. The count SHALL update live, SHALL read `99+` above 99, and SHALL be part of the control's accessible name, stated exactly. The compact chrome row's Home control SHALL NOT show this count.

#### Scenario: Seen from a project

- **WHEN** a project is the selected view and the server has published a notification for the bot Bird with three posts
- **THEN** the Home control shows 3 without the user opening Home, and its accessible name says three unread messages

#### Scenario: Summed over bots

- **WHEN** published notifications hold three posts for Bird and one for Owl
- **THEN** the Home control shows 4

#### Scenario: More than 99

- **WHEN** published notifications hold 120 posts in total
- **THEN** the Home control shows `99+` and its accessible name says 120 unread messages

#### Scenario: Not yet published

- **WHEN** a bot posts and the notification settle period has not yet passed
- **THEN** the Home control does not count the post

#### Scenario: Nothing unread

- **WHEN** the server has published no bot notification
- **THEN** the Home control shows no count and its accessible name is Home

### Requirement: Unread bot posts are counted in the Home sidebar

The Bots item in the Home sidebar SHALL show the same count as the Home control, whether or not its tab is open. Each row in the Home sidebar for a bot on the window's server SHALL show that bot's published post count, and no count when it has none. A row for a bot on another attached server SHALL show no count. The counts SHALL update live, SHALL read `99+` above 99 on a bot's row, and SHALL be part of the item's or row's accessible name.

#### Scenario: Per bot

- **WHEN** published notifications hold three posts for Bird and one for Owl, and the Bots tab is closed
- **THEN** the Bots item shows 4, Bird's row shows 3, and Owl's row shows 1, and Bird's row's accessible name says three unread messages

#### Scenario: A bot on another attached server

- **WHEN** another attached server has a bot with the same id as Bird, and the window's server has published three posts for Bird
- **THEN** the window's Bird row shows 3 and the other server's row shows no count

#### Scenario: A bot the window does not know

- **WHEN** the server publishes a notification for a bot missing from the window's bot list
- **THEN** no row shows its count, and neither the Bots item nor the Home control counts it

### Requirement: Unread bot counts clear on acknowledgement

The Home control, the Bots item, and a bot's sidebar row SHALL stop counting a bot's posts once the server withdraws that bot's notification: when any client shows the bot's Chat, when the user sends the bot a message, or when its notification is dismissed. Clearing one bot SHALL leave every other bot's count in place. The device-local unread divider in a bot's Chat is separate and is not cleared by these counts.

#### Scenario: Opening Chat

- **WHEN** Bird and Owl have unread posts and the user opens Bird's Chat
- **THEN** Bird's row shows no count, and the Bots item and the Home control show only Owl's posts

#### Scenario: Sending a message

- **WHEN** the user sends Bird a message
- **THEN** Bird's row, the Bots item, and the Home control no longer count Bird's posts

#### Scenario: Dismissing the notification

- **WHEN** the user dismisses Bird's row in the Notifications list
- **THEN** Bird's row, the Bots item, and the Home control no longer count Bird's posts, and Bird's Chat still shows its unread divider when opened

#### Scenario: Read on another client

- **WHEN** another client shows Bird's Chat
- **THEN** this window's Bird row, Bots item, and Home control no longer count Bird's posts
