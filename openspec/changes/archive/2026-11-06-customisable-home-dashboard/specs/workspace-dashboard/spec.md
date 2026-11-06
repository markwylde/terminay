## MODIFIED Requirements

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

## ADDED Requirements

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
