## ADDED Requirements

### Requirement: Compact switcher Servers item

The rail's Servers item SHALL show a server glyph with the reachability of the window's current server and the label Servers beneath it. Its accessible name SHALL name the current server and state when it is unreachable. It SHALL be drawn without a fill unless it is selected, and SHALL never show a grip or a close control. Selecting it SHALL present the Servers panel in the drawer, as selecting Home presents the Home panel, and no menu SHALL open over the drawer from it.

#### Scenario: Opening the Servers panel
- **WHEN** a user opens the switcher and selects Servers in its rail
- **THEN** the panel presents the Servers panel, Servers is marked selected in the rail, and no popout menu opens

#### Scenario: Servers in edit mode
- **WHEN** edit mode is on
- **THEN** the Servers item shows no grip and no close control, and selecting it ends edit mode and presents the Servers panel

### Requirement: Compact switcher Servers panel

The Servers panel SHALL present a header naming Servers, every server this window could show with the current one marked, and a row for each of the window's attached connections that has an upgrade to show. An Add connection control SHALL sit in a bar at the bottom of the panel that stays in place while the list scrolls. The panel SHALL offer no search, no edit control, no Tabs and Agents tabs, and no folder tree.

#### Scenario: Adding a connection
- **WHEN** a user selects Servers in the rail and presses Add connection
- **THEN** the switcher dismisses and the connection manager opens

#### Scenario: Server upgrade available
- **WHEN** an attached server has an upgrade available and the user selects Servers
- **THEN** the panel lists a row offering that upgrade

### Requirement: Servers panel scope

The Servers panel SHALL show reachability and upgrade state only for the window's attached connections, never for a saved server the window is not attached to, and SHALL offer no way to rename, edit, or forget a saved server, which Settings manages.

#### Scenario: Saved server not attached
- **WHEN** a saved server is listed in the Servers panel but the window is not attached to it
- **THEN** its row offers a switch to it and shows no reachability or upgrade state, and no rename or forget action

### Requirement: Switching server from the Servers panel

Choosing a server in the Servers panel that is not the current one SHALL switch the window to it, marking it as connecting until the switch completes. Choosing the current server SHALL do nothing. A switch that fails SHALL report the failure and leave the window on its current server.

#### Scenario: Switching server
- **WHEN** a user selects Servers and chooses a server that is not the current one
- **THEN** that server is marked as connecting and the window switches to it

#### Scenario: Switch fails
- **WHEN** a switch chosen in the Servers panel fails
- **THEN** the failure is reported and the window stays on its current server

### Requirement: Launcher folder picker

The launcher dropup's Open in control SHALL name the target folder, with a branch glyph for a linked folder, and SHALL expose whether it is expanded. When the presented project has exactly one folder, the control SHALL name it and SHALL NOT expand. Activating the control SHALL replace the dropup's launcher entries with a Filter folders text field, which takes focus, above a scrolling list of the presented project's folders with the target folder marked.

#### Scenario: Many worktrees
- **WHEN** the presented project has twelve folders and a user opens the dropup
- **THEN** the dropup shows one Open in control naming the target folder above the launcher entries, and no chip for each folder

#### Scenario: One folder
- **WHEN** the presented project has only General
- **THEN** Open in names General and does not expand

### Requirement: Filtering and choosing a launcher folder

Typing in Filter folders SHALL narrow the list to folders whose displayed name contains the typed text, ignoring case, and SHALL say when nothing matches. The arrow keys SHALL move a highlight through the listed folders, and Enter SHALL choose the highlighted folder. Choosing a folder by tap, click, or Enter SHALL make it the target and collapse the picker back to the launcher entries without creating a terminal. The dismiss key SHALL collapse an expanded picker and leave the dropup open.

#### Scenario: Filtering to a worktree
- **WHEN** a user expands Open in and types `rail`
- **THEN** only folders whose names contain rail are listed, and choosing `rail-drawer` makes it the target and shows the launcher entries again

#### Scenario: Escape collapses the picker
- **WHEN** the picker is expanded and the user presses the dismiss key
- **THEN** the picker collapses, the target is unchanged, and the dropup stays open

## MODIFIED Requirements

### Requirement: Compact chrome row

On a compact bar at phone width or 640px and below, the workspace chrome SHALL be a single row holding, in order: the Command Bar control, a title block that grows to fill the remaining width, the Notifications control, Pixel's dock while the active server has Pixel on, and the sidebar toggle at the trailing end. The row SHALL carry no application menu control, no Home control, and no connection control; Home and the server menu are reached from the switcher's rail. The sidebar toggle SHALL be drawn as a panel on the right-hand side and SHALL show and hide the project sidebar while a project is in front. While Home is selected the sidebar toggle SHALL be absent, because a compact Home has no sidebar and each Home section carries its own View options control. The title block SHALL show when the active server is unreachable or has a server upgrade available, and SHALL say so in its accessible name. The Command Bar control SHALL open the Command Bar whichever view is selected, including Home and a window that holds no project. The title block SHALL name what is on screen as the compact title block requirement states and SHALL open the unified switcher wherever it is pressed. The panel tab strip SHALL be absent on a compact workspace, for a project and for Home alike, and New project SHALL live in the switcher instead of as header `+` chrome. A pending application update SHALL stay visible on the row rather than being folded away. Above 640px the bar SHALL present the full project tab strip, its overflow switcher, the named connection control, and the panel tab strip.

#### Scenario: Phone-width chrome
- **WHEN** the project bar is at 640px or narrower and Pixel is off
- **THEN** the chrome is one row of Command Bar control, title block, Notifications control, and sidebar toggle, and the panel tab strip is absent

#### Scenario: Pixel sits before the sidebar toggle
- **WHEN** the project bar is at 640px or narrower and the active server has Pixel on
- **THEN** Pixel's dock sits between the Notifications control and the sidebar toggle

#### Scenario: No duplicated destinations
- **WHEN** the project bar is at 640px or narrower
- **THEN** the row has no application menu control, no Home control, and no connection control

#### Scenario: Sidebar toggle opens the right-hand sidebar
- **WHEN** a user presses the sidebar toggle with a project in front on a compact workspace
- **THEN** the project sidebar is shown, and pressing it again hides it

#### Scenario: Sidebar toggle on Home
- **WHEN** Home is selected on a compact workspace with the Workflows tab in front
- **THEN** the row has no sidebar toggle, and no list of Home sections is shown

#### Scenario: Server trouble on the title block
- **WHEN** the active server is unreachable on a compact workspace
- **THEN** the title block shows that the server is unreachable, whether or not Pixel is on

#### Scenario: Going Home from the switcher
- **WHEN** a user opens the unified switcher on a compact workspace, selects Home in its rail, and chooses a Home section
- **THEN** Home is selected and the switcher closes

#### Scenario: Opening the Command Bar by touch
- **WHEN** a user presses the Command Bar control on a compact workspace with a project in front
- **THEN** the Command Bar opens over that project, and no other menu opens

#### Scenario: No project in front
- **WHEN** Home is selected on a compact workspace and the window holds no project
- **THEN** the Command Bar control is present and opens the Command Bar

#### Scenario: Command Bar on Home
- **WHEN** a user presses the Command Bar control on a compact workspace while Home is selected
- **THEN** the Command Bar opens over Home

#### Scenario: Breadcrumb names where the user is
- **WHEN** a compact workspace has an active project and an active terminal
- **THEN** the title block names that terminal on its first line and that project and its selected folder on its second

#### Scenario: Either breadcrumb segment opens the switcher
- **WHEN** a user presses either line of the title block
- **THEN** the unified switcher opens, and no other menu opens

#### Scenario: Compact All projects menu
- **WHEN** the compact switcher opens
- **THEN** its rail lists every project of every attached connection and its create bar offers New project instead of header `+` chrome

#### Scenario: A pending update stays visible
- **WHEN** an application update is pending on a compact bar
- **THEN** its control stays on the row, between the title block and the Notifications control

#### Scenario: Wide bar is unchanged
- **WHEN** the project bar is wider than 640px
- **THEN** the full project tab strip, its overflow switcher, the named connection control, and the panel tab strip are present

### Requirement: Compact switcher project rail

The switcher's rail SHALL present, from top to bottom: the Servers item, which is the rail's server control, the Home item, a divider, every project of every attached connection, and a New project control. Projects SHALL be grouped by connection: the window's current server first, then each other attached connection in the order the server menu lists them. Within a group, projects SHALL appear in the order they hold in the window's project composition. When more than one connection is attached, each group SHALL be headed by that connection's short name. Each project item SHALL show the project's colour, a short form of its name on its tile, and the project's name as a visible label beneath the tile, truncated to the rail's width. It SHALL carry an accessible name made of the project's name followed by the accessible text of its status summary when it has one, and SHALL carry the badge the activity presentation requirement defines, drawn clear of the selection mark. Only the selected item, which may be Servers, Home, or a project, SHALL be marked as selected. Outside edit mode a swipe that starts on a rail item SHALL scroll the rail. The rail SHALL scroll when its items do not fit.

#### Scenario: Rail order
- **WHEN** the switcher opens with one connection holding projects terminay, paged, and dotfiles in that order
- **THEN** the rail shows Servers, Home, a divider, terminay, paged, dotfiles, and New project

#### Scenario: Two connections
- **WHEN** two connections are attached
- **THEN** the current server's projects come first under its short name, and the other connection's projects follow under its own

#### Scenario: Project label and status
- **WHEN** project terminay has one working terminal
- **THEN** its rail item shows terminay beneath its tile, and its accessible name states terminay and 1 working

#### Scenario: One selected item
- **WHEN** the switcher opens with project terminay in front
- **THEN** terminay is marked selected and Home is drawn unselected

### Requirement: Compact switcher launcher dropup

The launcher dropup SHALL open above the control that opened it and SHALL list the default shell entry named Terminal followed by one entry for each available terminal launcher in the order the server lists them, each with its launcher's icon and name, marking the entry this device chose most recently. It SHALL show the target folder as one Open in control naming the chosen folder, starting on the folder whose control opened it or else the selected folder, as the launcher folder picker requirement states. Choosing an entry SHALL create a terminal in the chosen folder that starts that launcher's agent, or the default shell for Terminal, SHALL remember the entry as this device's most recent choice, and SHALL dismiss the switcher.

#### Scenario: Launching Claude Code in a worktree folder
- **WHEN** Claude Code is available and a user opens the dropup, picks folder `mobile-workflow-rail-overlap`, and chooses Claude Code
- **THEN** a terminal running Claude Code is created in that folder, it is the terminal on screen, and the switcher dismisses

#### Scenario: Dropup from a folder
- **WHEN** a user presses the new-terminal control on folder beta's header
- **THEN** the dropup opens with beta chosen as the target folder

#### Scenario: Launcher not installed
- **WHEN** Codex reports `not_installed`
- **THEN** the dropup lists Terminal and Claude Code and no Codex entry

### Requirement: Compact switcher create bar

While the panel presents a project, the switcher SHALL end in a create bar that stays in place while the tree above it scrolls. The bar SHALL hold a split new-terminal control and a New project control. The split control's main part SHALL create a terminal with the launcher this device chose most recently from the switcher, or the default shell when it has chosen none or that launcher is no longer available, in the selected folder of the presented project. Its visible label SHALL name that launcher and, when the project lists folders, the folder it creates in. Its accessible name SHALL state the launcher, the folder, and the project. The split control's disclosure part SHALL open the launcher dropup and SHALL point toward where the dropup opens. When Home is presented, the bar SHALL offer New project as its wide control. When the Servers panel is presented, the bar SHALL offer Add connection as its wide control. Each control SHALL carry an accessible name stating its action. The create bar SHALL remain when a filter matches nothing.

#### Scenario: Label names where the terminal will be created
- **WHEN** the switcher presents project Infra with its General folder selected and the device has never chosen a launcher
- **THEN** the split control's main part shows Terminal over General, and its accessible name states Terminal, General, and Infra

#### Scenario: Label follows the selected folder
- **WHEN** the selected folder of the presented project changes and the switcher is opened again
- **THEN** the main part's visible label and accessible name state the newly selected folder

#### Scenario: Main part repeats the last launcher
- **WHEN** a user last created a Codex terminal from the dropup and later presses the main part of the split control while project Infra is presented with its General folder selected
- **THEN** a Codex terminal is created in Infra's General folder

#### Scenario: Remembered launcher becomes unavailable
- **WHEN** the launcher the device last chose is no longer listed by the server
- **THEN** the main part creates a terminal with the default shell and is labelled Terminal

#### Scenario: No project in front
- **WHEN** the switcher presents Home
- **THEN** the create bar offers New project as its wide control and no new-terminal control

#### Scenario: Icon controls are named
- **WHEN** assistive technology reads the create bar
- **THEN** it announces the split control's two parts and a control for New project

#### Scenario: Filter matches nothing
- **WHEN** a filter matches no terminal, folder, project, or connection
- **THEN** the create bar is still present with all of its controls

#### Scenario: Servers panel create bar
- **WHEN** the switcher presents the Servers panel
- **THEN** the create bar offers Add connection as its wide control and no new-terminal control

## REMOVED Requirements

### Requirement: Compact switcher server menu

**Reason:** The rail's server control is a rail item with its own panel, like Home and every project, instead of a menu that opens over the drawer.

**Migration:** Server switching, server upgrades, and Add connection are in the Servers panel, which the Compact switcher Servers panel requirement specifies.
