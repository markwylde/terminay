## MODIFIED Requirements

### Requirement: Compact bar presentation

On a compact bar at phone width or 640px and below, the workspace chrome SHALL be a single row holding, in order: the application menu control where the host renders one, the file-explorer toggle, the Command Bar control, a title block that grows to fill the remaining width, the Home control, the Notifications control, and a trailing control. The trailing control SHALL be Pixel's dock while the active server has Pixel on, and the connection control otherwise. While Pixel's dock takes the trailing place, the title block SHALL show when the active server is unreachable or has a server upgrade available, and SHALL say so in its accessible name. The row SHALL carry no dashboard control other than the Home control. The Command Bar control SHALL open the Command Bar whichever view is selected, including Home and a window that holds no project. The title block SHALL name what is on screen as the compact title block requirement states and SHALL open the unified switcher wherever it is pressed. The panel tab strip SHALL be absent on a compact workspace, for a project and for Home alike, and New project SHALL live in the switcher instead of as header `+` chrome. A pending application update SHALL stay visible on the row rather than being folded away. Above 640px the bar SHALL present the full project tab strip, its overflow switcher, the named connection control, and the panel tab strip.

#### Scenario: Phone-width chrome
- **WHEN** the project bar is at 640px or narrower and Pixel is off
- **THEN** the chrome is one row of application menu, file-explorer toggle, Command Bar control, title block, Home control, Notifications control, and connection control, and the panel tab strip is absent

#### Scenario: Pixel takes the trailing place
- **WHEN** the project bar is at 640px or narrower and the active server has Pixel on
- **THEN** Pixel's dock is the trailing control of the row and the connection control is absent

#### Scenario: Server trouble without the connection control
- **WHEN** Pixel's dock takes the trailing place and the active server is unreachable
- **THEN** the title block shows that the server is unreachable

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

### Requirement: Compact switcher terminal creation shows the created terminal

A terminal created from the compact switcher SHALL become the active terminal of its project: it SHALL be the terminal shown on screen, it SHALL receive terminal focus, and the switcher SHALL mark it as current the next time it opens. This SHALL hold for the create bar's split new-terminal control and for every entry of the launcher dropup, which create in the folder the dropup targets; for a folder's new-terminal entries in its ⋯ menu; and for a project whose folders this window does not list, which SHALL select that project on its own server first. Creating in a folder that is not selected, or in a project that is not in front, SHALL select that folder and its project first. The switcher SHALL dismiss when any create action is chosen. The terminal on screen and the switcher's current row SHALL never name different terminals after a create.

#### Scenario: New terminal in the project in front
- **WHEN** a user opens the compact switcher and presses the main part of the split new-terminal control
- **THEN** the switcher dismisses, a terminal is created in the selected folder of the project in front, and that terminal replaces the previous one on screen and takes terminal focus

#### Scenario: New terminal in another folder of the project in front
- **WHEN** a user chooses a launcher from the dropup aimed at a folder that is not the selected folder of the project in front
- **THEN** that folder becomes selected, the created terminal belongs to it, and it is the terminal shown on screen

#### Scenario: New terminal in a folder of a background project
- **WHEN** a user chooses a new-terminal entry for a folder of a project that is not the project in front
- **THEN** that project becomes active with that folder selected, and the created terminal belongs to that folder and is the terminal shown on screen

#### Scenario: New terminal in a background project
- **WHEN** a user presses the main part of the split new-terminal control while the panel presents a project on another server whose folders this window does not list
- **THEN** that project becomes active on its own server and the created terminal is the terminal shown on screen

#### Scenario: Switcher agrees with the screen
- **WHEN** a user reopens the compact switcher after creating a terminal from it
- **THEN** the row marked current is the created terminal, which is also the terminal on screen

### Requirement: Unified compact switcher

A compact workspace SHALL provide one switcher, presented as a drawer, that reaches every terminal, file, and folder panel of every project of every attached connection. The drawer SHALL hold a project rail along its leading edge and a panel beside it that presents the rail item that is selected. When the drawer opens, the rail item selected SHALL be Home while Home is the selected view and the project in front otherwise. Selecting a project in the rail SHALL present that project in the panel without activating it; only choosing a panel, a folder, or a create action SHALL change what is on screen. The switcher SHALL offer a new terminal in every folder it lists, a new terminal for a presented project whose folders it does not list, a new terminal where the user already is, New project, and Add connection, so every create action absorbed from the collapsed chrome remains reachable. The new terminal where the user already is SHALL be absent when no project is in front rather than acting on an arbitrary one. The switcher SHALL open from the title block and from the connection control, presenting the same content from both.

#### Scenario: Grouped by connection and project
- **WHEN** the switcher opens with two attached connections holding projects with terminals
- **THEN** the rail lists each connection's projects under that connection's name, and selecting a project presents its terminals in the panel

#### Scenario: Opening on the project in front
- **WHEN** a user opens the switcher while project Infra is in front
- **THEN** Infra is selected in the rail and its folder tree fills the panel

#### Scenario: Browsing another project
- **WHEN** a user selects project Docs in the rail while Infra is in front
- **THEN** the panel presents Docs, Infra stays in front, and the terminal on screen is unchanged

#### Scenario: Activating a terminal in a background project
- **WHEN** a user presses a terminal row belonging to a project that is not active
- **THEN** that project becomes active on its own server, that terminal becomes the active terminal, and the switcher dismisses

#### Scenario: Connection control opens the same switcher
- **WHEN** a user presses the connection control on a compact workspace
- **THEN** the switcher opens with the same content the title block opens

#### Scenario: Create actions survive the collapse
- **WHEN** the switcher is open with a project in front
- **THEN** it offers a new terminal on each listed folder, a new terminal where the user already is, New project, and Add connection

#### Scenario: A project whose folders are not listed
- **WHEN** the panel presents a project without listing its folders
- **THEN** its create bar offers a new terminal for that project

#### Scenario: No project in front
- **WHEN** the switcher is open while Home is selected
- **THEN** the new terminal for where the user already is is absent, and the other create actions remain

#### Scenario: Single connection still names its server
- **WHEN** exactly one connection is attached
- **THEN** the rail's server control names that server

### Requirement: Compact project editing survives the collapse

A project in the switcher's rail SHALL open that project's editor on a long press, so editing a project stays reachable at a width where no project tab is rendered. A short press on a rail project SHALL select it in the rail and SHALL NOT activate it.

#### Scenario: Long-pressing a project heading
- **WHEN** a user long-presses a project in the switcher's rail
- **THEN** that project's editor opens

#### Scenario: A short press on a heading is inert
- **WHEN** a user taps a project in the rail without holding
- **THEN** the panel presents that project, nothing on screen changes, and the switcher stays open

### Requirement: Compact switcher filtering

The switcher SHALL offer a text filter that matches terminal titles, folder names, project names, and connection names across every attached connection. The filter SHALL start collapsed as a search control in the panel header and SHALL expand into a field only when a user asks for it; nothing in the switcher SHALL take focus when it opens, so reaching a project or terminal never raises a software keyboard. While the filter holds text the panel SHALL list matching folders and matching panels, each naming its project and, where more than one connection is attached, its connection. A folder SHALL match when its own name, its project's name, or its connection's name contains the text, ignoring case. A panel SHALL match when its own title, its folder's name, its project's name, or its connection's name contains the text, ignoring case, so a folder that matches brings its panels with it. Pressing a result SHALL act as its row does in the tree, whichever rail item is selected. Collapsing the filter SHALL clear it and restore what the panel presented before. The filter SHALL NOT change which terminal is active.

#### Scenario: The switcher opens without taking focus
- **WHEN** the switcher opens
- **THEN** the filter is a collapsed search control, no field holds focus, and no software keyboard is raised

#### Scenario: Collapsing the filter restores the list
- **WHEN** a user collapses an expanded filter that was narrowing the list
- **THEN** the filter clears and the panel presents the selected rail item again

#### Scenario: Filtering by terminal title
- **WHEN** a user types text matching one terminal's title in a project that is not selected in the rail
- **THEN** that terminal is listed with its project and folder, and pressing it activates it

#### Scenario: Filtering by project name
- **WHEN** a user types text matching a project name
- **THEN** every terminal and folder of that project is listed

#### Scenario: Filtering by folder name
- **WHEN** a user types text matching a folder's name
- **THEN** that folder is listed with its project, followed by every panel it holds, and pressing the folder shows that folder

#### Scenario: Filtering by connection name
- **WHEN** two connections are attached and a user types text matching only the second connection's name
- **THEN** every folder and panel of that connection's projects is listed, and nothing from the first connection

#### Scenario: Filter result outside the selected rail item
- **WHEN** Home is selected in the rail and a user filters and presses a terminal of project Docs
- **THEN** Docs becomes active with that terminal on screen and the switcher dismisses

#### Scenario: Filter matches nothing
- **WHEN** the filter matches no terminal, folder, project, or connection
- **THEN** the switcher reports that nothing matches and still offers its create actions

### Requirement: Compact switcher panel rows

The switcher's folder tree SHALL list every terminal, file, and folder panel of the presented project, under the folder that holds it, in canonical panel order. Each panel row SHALL name that panel and SHALL activate it on its own server when pressed, selecting that panel's project and folder first when they are not in front, and SHALL dismiss the switcher. A terminal row SHALL present that terminal's activity state, its title, and a second line that is its workflow's current step when a workflow is attached and its preview line otherwise. The row marked current SHALL be the panel on screen. A long press on a panel row SHALL open that row's menu.

#### Scenario: File and folder panels appear as rows
- **WHEN** a project holds a terminal, a file panel, and a folder panel in one folder
- **THEN** the tree lists a row for each under that folder

#### Scenario: Activating a file in a background project
- **WHEN** a user presses a file row belonging to a project that is not active
- **THEN** that project becomes active on its own server, that file panel becomes the active panel, and the switcher dismisses

#### Scenario: Workflow step replaces the preview
- **WHEN** a terminal has an attached workflow whose third of five steps is running
- **THEN** its row's second line names that step instead of the preview line

### Requirement: Compact switcher closing

Closing from the compact switcher SHALL go through the same paths and close protection as the wide workspace. A panel row SHALL be closable from its row menu and, in edit mode, from its close control. A project SHALL be closable in edit mode from its close control in the rail. A folder SHALL be removable from its ⋯ menu and, in edit mode, from its close control, which SHALL offer the action the folder context menu offers for that folder: Delete worktree for a linked folder and Delete folder for a plain folder, each with its existing confirmation; General SHALL offer no removal. Closing a panel or a project SHALL leave the switcher open. Removing a folder, like every folder action other than a new terminal, SHALL dismiss the switcher and run with that folder's project and folder in front, so its confirmation is shown over the workspace it affects. Closing the last panel in a project SHALL close the project. Close protection SHALL still ask whether to **Close Terminal** or **Keep Running** when that terminal's PTY has a non-shell foreground process, and SHALL still ask whether to **Close Project** or **Keep Running** when a project has such a terminal.

#### Scenario: Closing a terminal from the switcher
- **WHEN** a user long-presses a terminal row and chooses Close
- **THEN** that terminal closes and the switcher stays open

#### Scenario: Closing a file from the switcher
- **WHEN** a user in edit mode presses the close control on a file row
- **THEN** that file panel closes and the switcher stays open

#### Scenario: Closing a busy terminal from the switcher
- **WHEN** a user closes a terminal whose PTY has a non-shell foreground process
- **THEN** Terminay asks whether to Close Terminal or Keep Running before terminating it

#### Scenario: Closing a project from the switcher
- **WHEN** a user in edit mode presses the close control on a rail project whose terminals are all at their shell prompts
- **THEN** that project closes and the switcher stays open

#### Scenario: Removing a linked folder
- **WHEN** a user in edit mode presses the close control on a linked folder
- **THEN** the switcher closes with that folder's project in front, Terminay asks to confirm Delete worktree for that folder's worktree, and the folder goes only after the user confirms

#### Scenario: General cannot be removed
- **WHEN** edit mode is on
- **THEN** General shows no close control

#### Scenario: Closing the last panel closes the project
- **WHEN** a user closes the last remaining panel of a project from the switcher
- **THEN** the project closes

### Requirement: Compact switcher Tabs and Agents tabs

While the panel presents the project in front, it SHALL offer the same two tabs as a project's left column, in the same order: **Tabs** and **Agents**. Tabs SHALL present the folder tree. Agents SHALL present the Agents pane of the project in front, and SHALL NOT present the filter, the edit control, or the folder tree. The panel SHALL show Tabs every time the switcher opens. The tab bar SHALL be a tab list whose tabs are named Tabs and Agents, with Arrow Left and Arrow Right moving between them and the shown content exposed as the tab panel; selecting a tab SHALL NOT move focus into a text field.

Pressing an agent row SHALL act as it does in the left column's Agents tab and SHALL dismiss the switcher, so the terminal it leads to is on screen.

The tab bar SHALL be omitted when agent integration is disabled, when Home is presented, or when the presented project is not the project in front; the panel SHALL then show its content with no tab bar.

#### Scenario: Switcher opens on Tabs
- **WHEN** a user opens the compact switcher with a project in front and agent integration enabled
- **THEN** the panel shows a Tabs tab and an Agents tab with Tabs selected, and the folder tree beneath

#### Scenario: Selecting Agents
- **WHEN** a user selects the Agents tab
- **THEN** the panel shows the agents of the project in front in place of the folder tree, and no software keyboard is raised

#### Scenario: Reopening the switcher
- **WHEN** a user selects Agents, dismisses the switcher, and opens it again
- **THEN** Tabs is selected

#### Scenario: Pressing an agent
- **WHEN** a user presses a bound agent's row in the Agents tab
- **THEN** that agent's terminal becomes the terminal on screen and the switcher is dismissed

#### Scenario: No project in front
- **WHEN** the switcher is open while Home is selected
- **THEN** the panel presents Home with no tab bar

#### Scenario: Browsing a background project
- **WHEN** the panel presents a project that is not the project in front
- **THEN** it shows that project's folder tree with no tab bar

#### Scenario: Agent integration disabled
- **WHEN** agent integration is disabled
- **THEN** the panel shows the folder tree with no tab bar

### Requirement: Compact switcher create bar

While the panel presents a project, the switcher SHALL end in a create bar that stays in place while the tree above it scrolls. The bar SHALL hold a split new-terminal control and a New project control. The split control's main part SHALL create a terminal with the launcher this device chose most recently from the switcher, or the default shell when it has chosen none or that launcher is no longer available, in the selected folder of the presented project; its visible label SHALL name that launcher and its accessible name SHALL state the launcher, the folder, and the project. The split control's disclosure part SHALL open the launcher dropup. When no project is presented, the bar SHALL offer New project as its wide control. Add connection SHALL be reached from the server menu. Each control SHALL carry an accessible name stating its action. The create bar SHALL remain when a filter matches nothing.

#### Scenario: Label names where the terminal will be created
- **WHEN** the switcher presents project Infra with its General folder selected and the device has never chosen a launcher
- **THEN** the split control's main part is labelled Terminal and its accessible name states Terminal, General, and Infra

#### Scenario: Label follows the selected folder
- **WHEN** the selected folder of the presented project changes and the switcher is opened again
- **THEN** the main part's accessible name states the newly selected folder

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

## ADDED Requirements

### Requirement: Compact switcher project rail

The switcher's rail SHALL present, from top to bottom: a server control, the Home item, a divider, every project of every attached connection, and a New project control. Projects SHALL be grouped by connection: the window's current server first, then each other attached connection in the order the server menu lists them. Within a group, projects SHALL appear in the order they hold in the window's project composition. When more than one connection is attached, each group SHALL be headed by that connection's short name. Each project item SHALL show the project's colour and a short form of its name, SHALL carry the project's name as its accessible name, and SHALL carry the badge the activity presentation requirement defines. The selected item SHALL be marked as selected, and the rail SHALL scroll when its items do not fit.

#### Scenario: Rail order
- **WHEN** the switcher opens with one connection holding projects terminay, paged, and dotfiles in that order
- **THEN** the rail shows the server control, Home, a divider, terminay, paged, dotfiles, and New project

#### Scenario: Two connections
- **WHEN** two connections are attached
- **THEN** the current server's projects come first under its short name, and the other connection's projects follow under its own

### Requirement: Compact switcher actions on another connection

While the panel presents a project on a connection other than the window's current server, the switcher SHALL offer only actions that switch the window to that server as their first effect. These are activating a panel or a folder, and creating a terminal with the default shell. A panel row's menu SHALL then offer Open alone. The folder ⋯ menu SHALL offer the default-shell new-terminal entry alone. The launcher dropup SHALL list Terminal alone, with a note naming the server to switch to for its launchers. The panel SHALL offer no edit control. That project's rail item SHALL show no grip and no close control. Renaming, moving, closing, reordering, and removing SHALL be reached after the switch, because the window then holds that server's workspace. A switch that fails SHALL report the failure, leave the window on its current server, and perform nothing that was chosen.

#### Scenario: Row menu on another connection
- **WHEN** a user long-presses a terminal row of a project on another connection
- **THEN** the menu offers Open and nothing else

#### Scenario: No edit mode on another connection
- **WHEN** the panel presents a project on another connection
- **THEN** no edit control is present

#### Scenario: Launchers follow the current server
- **WHEN** the panel presents a project on another connection and a user opens the launcher dropup
- **THEN** it lists Terminal alone and names the server to switch to for its launchers

#### Scenario: Switch fails
- **WHEN** a user presses a terminal row of a project on another connection and the switch to that server fails
- **THEN** the failure is reported and the window stays on its current server with the same panel on screen

### Requirement: Home in the compact switcher rail

The rail's Home item SHALL show a house glyph, SHALL be drawn distinct from projects in a neutral colour, SHALL carry a badge counting terminals that need the user across every project, and SHALL never show a grip or a close control.

#### Scenario: Home is not a project
- **WHEN** edit mode is on
- **THEN** the Home item shows no grip and no close control

#### Scenario: Home badge
- **WHEN** two terminals in different projects need the user
- **THEN** the Home item shows a badge of 2

### Requirement: Compact switcher folder tree

While the panel presents a project, it SHALL show a header naming the project with its status summary, a search control, and an edit control, and SHALL list beneath it every folder this window knows the project to have, in the project's folder order, each followed by its panel rows. A project whose folders this window does not know SHALL list its panel rows directly beneath the header with no folder header. Collapsing a folder SHALL hide its rows and SHALL use the same per-device collapse preference as the Folders tree. Pressing a folder's name SHALL show that folder, selecting its project first when it is not in front, and SHALL dismiss the switcher.

#### Scenario: Collapse is shared with the Folders tree
- **WHEN** a user collapses a folder in the switcher and later widens the window
- **THEN** the Folders tree shows that folder collapsed

#### Scenario: Pressing a folder name
- **WHEN** a user presses the name of an empty folder
- **THEN** the switcher dismisses and that folder is shown

### Requirement: Compact switcher folder header

Each folder in the switcher's tree SHALL have a header line with a collapse control, a glyph that marks a linked folder as a worktree, the folder's name, a count of its panels, a new-terminal control that opens the launcher dropup aimed at that folder, and a ⋯ control. A linked folder's name SHALL be shown without a leading `worktree-` prefix while its full name remains its accessible name. A folder that holds no panel SHALL show one New terminal entry beneath its header instead of rows.

#### Scenario: Linked folder header
- **WHEN** a project has a linked folder named `worktree-mobile-workflow-rail-overlap` holding two terminals
- **THEN** its header shows a worktree glyph, `mobile-workflow-rail-overlap`, a count of 2, a new-terminal control, and a ⋯ control

#### Scenario: Empty folder
- **WHEN** a folder holds no panel
- **THEN** beneath its header the tree shows a single New terminal entry that opens the launcher dropup aimed at that folder

### Requirement: Compact switcher terminal row menu

A long press on a panel row, a secondary click on it, or the context-menu key or Shift+F10 while it has focus SHALL open a menu for that panel. A terminal row's menu SHALL offer **Open**, **Rename**, **Move to folder…**, and **Close**; a file row's menu SHALL offer **Open** and **Close**. Open SHALL activate the panel and dismiss the switcher. Rename SHALL open the terminal's editor. Move to folder SHALL list the project's other folders and move the panel through the server-committed panel folder move, and SHALL be absent when the project has one folder. Close SHALL close the panel under the switcher's closing rules. A short press SHALL activate the panel and SHALL NOT open the menu.

#### Scenario: Moving a terminal to another folder
- **WHEN** a user long-presses a terminal row, chooses Move to folder, and chooses folder beta
- **THEN** the terminal is presented under beta with the same session, and its process keeps running

#### Scenario: Short press
- **WHEN** a user taps a terminal row without holding
- **THEN** that terminal is activated and no menu opens

#### Scenario: Opening the row menu from the keyboard
- **WHEN** a terminal row has focus and the user presses Shift+F10
- **THEN** the row menu opens with focus on Open, and dismissing it returns focus to the row

### Requirement: Compact switcher layered dismissal

The switcher's menus and the launcher dropup SHALL layer above the drawer. The dismiss key and a press outside SHALL close only the topmost open layer: a menu or the dropup first, then an expanded filter, and only then the drawer. Closing a menu or the dropup SHALL return focus to the control that opened it. Dismissing the drawer SHALL return focus to the control that opened the switcher.

#### Scenario: Escape closes the menu first
- **WHEN** a folder's ⋯ menu is open and the user presses Escape
- **THEN** the menu closes, the drawer stays open, and focus returns to that ⋯ control

#### Scenario: Escape closes the drawer last
- **WHEN** no menu, dropup, or expanded filter is open and the user presses Escape
- **THEN** the drawer closes and focus returns to the control that opened it

### Requirement: Compact switcher folder menu

A folder's ⋯ control SHALL open a menu that offers first one new-terminal entry for the default shell followed by one for each available terminal launcher in the order the server lists them, and then the entries the folder context menu offers for that folder, with the same availability, confirmation, and effect. A launcher that becomes unavailable SHALL disappear from the menu without a reload.

#### Scenario: Linked folder menu with launchers
- **WHEN** Claude Code and Codex are available and a user opens the ⋯ menu of a linked folder
- **THEN** the menu offers New Terminal, New Claude Code, and New Codex, followed by the linked folder's context-menu entries including Rename worktree and Delete worktree

#### Scenario: Plain folder menu
- **WHEN** a user opens the ⋯ menu of a plain folder
- **THEN** after the new-terminal entries it offers the plain folder's context-menu entries and no Git action

### Requirement: Compact switcher edit mode

The panel's edit control SHALL toggle edit mode for the rail and the presented project's tree. In edit mode:
- rail projects of the window's current server, folders, and panel rows SHALL each show a grip and a close control;
- General SHALL show a grip and no close control;
- short presses on panel rows and folder headers SHALL not activate anything;
- row and folder menus SHALL not open;
- the search control, the folder new-terminal controls, and the create bar SHALL be hidden.

The edit control, grips, close controls, the rail, the server control, and the Tabs and Agents tab bar SHALL remain usable. Selecting a rail item SHALL end edit mode and present that item. Selecting the Agents tab, pressing the edit control again, or dismissing the switcher SHALL also end edit mode. When the project being presented closes, the rail SHALL select the project in front, or Home when no project is in front, and edit mode SHALL end.

#### Scenario: Short press in edit mode
- **WHEN** a user taps a terminal row in edit mode
- **THEN** nothing is activated and the switcher stays open

#### Scenario: Selecting a rail item in edit mode
- **WHEN** a user in edit mode taps rail project Docs
- **THEN** edit mode ends and the panel presents Docs

#### Scenario: Closing the presented project in edit mode
- **WHEN** a user in edit mode closes the rail project the panel presents, which is not the project in front
- **THEN** the rail selects the project in front and edit mode is off

#### Scenario: Edit mode ends with the switcher
- **WHEN** a user turns on edit mode, dismisses the switcher, and opens it again
- **THEN** edit mode is off

### Requirement: Reordering in the compact switcher

In edit mode, dragging a rail project by its grip SHALL reorder it among the current server's projects, committing through `project.move`; a project SHALL NOT be dragged out of its connection group. Dragging a folder by its grip SHALL reorder the project's folders under the folder reordering rules. Dragging a panel row by its grip SHALL reorder panels within its folder and commit that order to canonical panel order. A dragged item SHALL follow the pointer along its list's axis only while the others slide to open its place. Its list SHALL scroll while the pointer is held near the list's top or bottom edge. Pressing the dismiss key or losing the pointer SHALL cancel the drag and restore the previous order. Each grip SHALL also be a focusable control that moves its item one place with Arrow Up or Arrow Down, committing as a drag does, and announces the item's new position. After a commit the list SHALL present the order the server committed. Where the device asks for reduced motion, items SHALL take their new places without animation.

#### Scenario: Reordering folders
- **WHEN** a user in edit mode drags folder beta above folder alpha and releases
- **THEN** the tree lists beta before alpha and every other device showing the project lists the same order

#### Scenario: Reordering terminals within a folder
- **WHEN** a user in edit mode drags the second terminal of a folder above the first and releases
- **THEN** the folder lists them in the new order and a reconnect preserves it

#### Scenario: Reordering projects
- **WHEN** a user in edit mode drags rail project paged above terminay on the same server
- **THEN** the rail lists paged before terminay and the order commits through `project.move`

#### Scenario: Cancelling a drag
- **WHEN** a user in edit mode drags a folder and presses Escape before releasing
- **THEN** the folders keep their previous order and nothing is committed

#### Scenario: Reordering from the keyboard
- **WHEN** a folder's grip has focus in edit mode and the user presses Arrow Up
- **THEN** that folder moves one place up and the new order commits through the folder reorder command

### Requirement: Compact switcher launcher dropup

The launcher dropup SHALL open above the control that opened it and SHALL list the default shell entry named Terminal followed by one entry for each available terminal launcher in the order the server lists them, each with its launcher's icon and name, marking the entry this device chose most recently. It SHALL show a target-folder picker over the presented project's folders, starting on the folder whose control opened it or else the selected folder. Choosing an entry SHALL create a terminal in the chosen folder that starts that launcher's agent, or the default shell for Terminal, SHALL remember the entry as this device's most recent choice, and SHALL dismiss the switcher.

#### Scenario: Launching Claude Code in a worktree folder
- **WHEN** Claude Code is available and a user opens the dropup, picks folder `mobile-workflow-rail-overlap`, and chooses Claude Code
- **THEN** a terminal running Claude Code is created in that folder, it is the terminal on screen, and the switcher dismisses

#### Scenario: Dropup from a folder
- **WHEN** a user presses the new-terminal control on folder beta's header
- **THEN** the dropup opens with beta chosen as the target folder

#### Scenario: Launcher not installed
- **WHEN** Codex reports `not_installed`
- **THEN** the dropup lists Terminal and Claude Code and no Codex entry

### Requirement: Launcher dropup dismissal and memory

Pressing outside the launcher dropup or the dismiss key SHALL close the dropup and leave the switcher open. A launcher that becomes unavailable SHALL disappear from the dropup without a reload. The remembered launcher choice SHALL be a per-device preference that is never written to server-owned state; when it cannot be read, the default shell SHALL be used without reporting an error.

#### Scenario: Dismissing the dropup
- **WHEN** the dropup is open and the user presses outside it
- **THEN** the dropup closes and the switcher stays open

#### Scenario: Storage unavailable
- **WHEN** device storage cannot be read
- **THEN** the split control's main part is labelled Terminal and no error is shown

### Requirement: Compact switcher server menu

The rail's server control SHALL show the reachability of the window's current server and SHALL carry an accessible name naming that server. Pressing it SHALL open a menu that lists every server this window could show with the current one marked and switches the window to a server chosen from it, lists a row for each attached server that has an upgrade to show, and offers Add connection. A server switch that fails SHALL report the failure and leave the window on its current server.

#### Scenario: Adding a connection
- **WHEN** a user presses the rail's server control and chooses Add connection
- **THEN** the switcher dismisses and the connection manager opens

#### Scenario: Server upgrade available
- **WHEN** an attached server has an upgrade available
- **THEN** the server menu lists a row offering that upgrade

### Requirement: Compact switcher Home panel

When the Home item is selected in the rail, the panel SHALL present a header naming Home, a search control, the Home sidebar sections in the Home sidebar's order each with a one-line summary, and beneath them the terminals that need the user across every project. The section that owns the Home tab in front SHALL be marked current while Home is the selected view. Choosing a section SHALL select Home, open that section as the Home sidebar does, and dismiss the switcher. Pressing a listed terminal SHALL activate it as a panel row does. The Home panel SHALL offer no edit control and no folder tree.

#### Scenario: Opening Workflows from the drawer
- **WHEN** a user selects Home in the rail and chooses Workflows
- **THEN** Home is selected, the Workflows section is the Home tab in front, and the switcher dismisses

#### Scenario: Needs you
- **WHEN** one terminal in another project is waiting for the user and Home is selected in the rail
- **THEN** that terminal is listed under the sections with its project and folder, and pressing it shows it on screen

### Requirement: Compact title block

The compact chrome row's title block SHALL name what is on screen. While a project is in front, its first line SHALL name the active panel: a terminal's live title, a file panel's file name, or a folder panel's title. When the project has no active panel, such as an empty folder or the project's start chooser, the first line SHALL be the project name. Its second line SHALL show the project's colour, the project name, and the selected folder's name. The workflow dial SHALL appear on the second line only when the active panel is a terminal with an attached workflow. While Home is selected, the first line SHALL be the title of the Home tab in front, which is its section name for a section tab, and the second line SHALL be the word Home. The project name SHALL truncate before the folder name. Pressing anywhere on the title block SHALL open the switcher. Its accessible name SHALL state the active panel, the folder, and the project, or the Home tab. It SHALL never describe a panel other than the one on screen.

#### Scenario: Terminal in a worktree folder
- **WHEN** terminal "Collapsed mobile workflow overlap" in folder `worktree-mobile-workflow-rail-overlap` of project terminay is on screen
- **THEN** the title block shows that title over terminay › mobile-workflow-rail-overlap

#### Scenario: Home
- **WHEN** Home is selected with Workflows in front
- **THEN** the title block shows Workflows over Home

#### Scenario: File panel in front
- **WHEN** a file panel showing `README.md` is the active panel of project terminay
- **THEN** the title block shows `README.md` over terminay › General and no workflow dial

#### Scenario: Empty folder in front
- **WHEN** the selected folder of project terminay holds no panel
- **THEN** the title block's first line is terminay and no terminal title is shown

### Requirement: Compact Home toggle

The compact chrome row's Home control SHALL select Home when a project is in front and SHALL return to the project that was in front before Home when Home is selected, without closing, suspending, or detaching anything. It SHALL show its selected state while Home is selected and an attention marker while Home is not selected and any terminal needs the user.

#### Scenario: Going Home and back
- **WHEN** a user presses the Home control with project terminay in front, then presses it again
- **THEN** Home is selected after the first press and terminay is in front after the second, with the same terminal on screen as before

#### Scenario: The project left behind has closed
- **WHEN** a user goes Home from project terminay, terminay is closed from another device, and the user presses the Home control
- **THEN** Home stays selected and nothing else is activated

## REMOVED Requirements

### Requirement: Compact breadcrumb disclosure placement

**Reason**: The compact breadcrumb is replaced by the title block, which carries no disclosure chevron.

**Migration**: The title block opens the switcher wherever it is pressed; see "Compact title block".

### Requirement: Compact switcher project cards

**Reason**: The switcher no longer lists every project at once in bordered cards; the rail lists projects and the panel presents one project.

**Migration**: Project colour, name, and status summary appear on the rail item and the panel header; see "Compact switcher project rail" and "Compact switcher folder tree".

### Requirement: Compact switcher folder labels

**Reason**: Folders are presented as collapsible folder headers in the folder tree rather than as full-width label lines.

**Migration**: See "Compact switcher folder header" and "Compact switcher folder menu".
