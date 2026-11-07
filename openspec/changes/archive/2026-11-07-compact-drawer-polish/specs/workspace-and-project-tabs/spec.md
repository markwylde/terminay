## MODIFIED Requirements

### Requirement: Compact switcher panel rows

The switcher's folder tree SHALL list every terminal, file, and folder panel of the presented project, under the folder that holds it, in canonical panel order. Each panel row SHALL name that panel and SHALL activate it on its own server when pressed, selecting that panel's project and folder first when they are not in front, and SHALL dismiss the switcher. A terminal row SHALL present that terminal's activity state, its title, and a second line that is its workflow's current step when a workflow is attached and its preview line otherwise. A row SHALL end in a ⋯ control at the trailing edge of the tree. A terminal with an attached workflow SHALL show its workflow dial in a column immediately before that ⋯ control, so every dial in the tree sits on one vertical line; a row without a workflow SHALL give that column's width to its title. A row's activity state and title SHALL line up with its folder header's glyph and name. The row marked current SHALL be the panel on screen. A long press on a panel row SHALL open that row's menu.

#### Scenario: File and folder panels appear as rows
- **WHEN** a project holds a terminal, a file panel, and a folder panel in one folder
- **THEN** the tree lists a row for each under that folder

#### Scenario: Activating a file in a background project
- **WHEN** a user presses a file row belonging to a project that is not active
- **THEN** that project becomes active on its own server, that file panel becomes the active panel, and the switcher dismisses

#### Scenario: Workflow step replaces the preview
- **WHEN** a terminal has an attached workflow whose third of five steps is running
- **THEN** its row's second line names that step instead of the preview line

#### Scenario: Dials line up
- **WHEN** two terminals in different folders of the presented project each have an attached workflow
- **THEN** both dials sit at the same horizontal position, immediately before each row's ⋯ control

#### Scenario: No workflow, no dial column
- **WHEN** a terminal has no attached workflow
- **THEN** its row shows no dial and its title extends up to the row's ⋯ control

### Requirement: Compact switcher folder tree

While the panel presents a project, it SHALL show a header naming the project with its status summary, a search control, an edit control, and a close control, and SHALL list beneath it every folder this window knows the project to have, in the project's folder order, each followed by its panel rows. A project whose folders this window does not know SHALL list its panel rows directly beneath the header with no folder header. Pressing a folder's header line outside its new-terminal and ⋯ controls SHALL collapse or expand that folder, and the header SHALL expose that state. Collapsing a folder SHALL hide its rows and SHALL use the same per-device collapse preference as the Folders tree. Showing a folder SHALL be reached from its ⋯ menu.

#### Scenario: Collapse is shared with the Folders tree
- **WHEN** a user collapses a folder in the switcher and later widens the window
- **THEN** the Folders tree shows that folder collapsed

#### Scenario: Pressing a folder name
- **WHEN** a user presses the name of an expanded folder in the switcher
- **THEN** that folder collapses, its rows are hidden, and the switcher stays open

#### Scenario: Pressing a collapsed folder header
- **WHEN** a user presses the name of a collapsed folder
- **THEN** that folder expands and lists its rows

### Requirement: Compact switcher folder header

Each folder in the switcher's tree SHALL have a header line with a collapse control, a glyph, the folder's name, a count of its panels while it holds any, a new-terminal control that opens the launcher dropup aimed at that folder, and a ⋯ control. The glyph SHALL mark a linked folder as a worktree and every other folder as a folder, so every folder name starts at the same position. A linked folder's name SHALL be shown without a leading `worktree-` prefix while its full name remains its accessible name. A folder that holds no panel SHALL show no count, SHALL show one New terminal entry beneath its header in place of rows, and that entry SHALL take the place of the header's new-terminal control, opening the launcher dropup aimed at that folder.

#### Scenario: Linked folder header
- **WHEN** a project has a linked folder named `worktree-mobile-workflow-rail-overlap` holding two terminals
- **THEN** its header shows a worktree glyph, `mobile-workflow-rail-overlap`, a count of 2, a new-terminal control, and a ⋯ control

#### Scenario: Plain folder header
- **WHEN** a project's General folder holds one terminal
- **THEN** its header shows a folder glyph and its name starts at the same position as a linked folder's name

#### Scenario: Empty folder
- **WHEN** a folder holds no panel
- **THEN** its header shows no count and no new-terminal control, and beneath it the tree shows a single New terminal entry that opens the launcher dropup aimed at that folder

### Requirement: Compact switcher folder menu

A folder's ⋯ control SHALL open a menu that offers first one new-terminal entry for the default shell followed by one for each available terminal launcher in the order the server lists them, then **Show folder**, and then the entries the folder context menu offers for that folder, with the same availability, confirmation, and effect. Show folder SHALL show that folder, selecting its project first when it is not in front, and SHALL dismiss the switcher. A launcher that becomes unavailable SHALL disappear from the menu without a reload. On a project of another connection the menu SHALL offer the default-shell new-terminal entry and Show folder alone.

#### Scenario: Linked folder menu with launchers
- **WHEN** Claude Code and Codex are available and a user opens the ⋯ menu of a linked folder
- **THEN** the menu offers New Terminal, New Claude Code, New Codex, and Show folder, followed by the linked folder's context-menu entries including Rename worktree and Delete worktree

#### Scenario: Plain folder menu
- **WHEN** a user opens the ⋯ menu of a plain folder
- **THEN** after the new-terminal entries and Show folder it offers the plain folder's context-menu entries and no Git action

#### Scenario: Showing an empty folder
- **WHEN** a user opens the ⋯ menu of an empty folder and chooses Show folder
- **THEN** the switcher dismisses and that folder is shown

### Requirement: Compact switcher terminal row menu

A long press on a panel row, a press on its ⋯ control, a secondary click on it, or the context-menu key or Shift+F10 while it has focus SHALL open a menu for that panel. A terminal row's menu SHALL offer **Open**, **Rename**, **Move to folder…**, and **Close**; a file row's menu SHALL offer **Open** and **Close**. Open SHALL activate the panel and dismiss the switcher. Rename SHALL open the terminal's editor. Move to folder SHALL list the project's other folders and move the panel through the server-committed panel folder move, and SHALL be absent when the project has one folder. Close SHALL close the panel under the switcher's closing rules. A short press on the row outside its ⋯ control SHALL activate the panel and SHALL NOT open the menu. The ⋯ control's accessible name SHALL name the panel.

#### Scenario: Moving a terminal to another folder
- **WHEN** a user long-presses a terminal row, chooses Move to folder, and chooses folder beta
- **THEN** the terminal is presented under beta with the same session, and its process keeps running

#### Scenario: Short press
- **WHEN** a user taps a terminal row without holding
- **THEN** that terminal is activated and no menu opens

#### Scenario: Opening the row menu from its ⋯ control
- **WHEN** a user presses the ⋯ control on a terminal row
- **THEN** that row's menu opens and the terminal on screen is unchanged

#### Scenario: Opening the row menu from the keyboard
- **WHEN** a terminal row has focus and the user presses Shift+F10
- **THEN** the row menu opens with focus on Open, and dismissing it returns focus to the row

### Requirement: Compact switcher layered dismissal

The switcher's menus and the launcher dropup SHALL layer above the drawer. The dismiss key, a press outside the drawer, and a press outside an open menu or dropup SHALL close only the topmost open layer: a menu or the dropup first, then an expanded filter, and only then the drawer. The panel header SHALL carry a close control, named for closing the switcher, that dismisses the drawer whatever it presents. Closing a menu or the dropup SHALL return focus to the control that opened it. Dismissing the drawer SHALL return focus to the control that opened the switcher.

#### Scenario: Escape closes the menu first
- **WHEN** a folder's ⋯ menu is open and the user presses Escape
- **THEN** the menu closes, the drawer stays open, and focus returns to that ⋯ control

#### Scenario: Escape closes the drawer last
- **WHEN** no menu, dropup, or expanded filter is open and the user presses Escape
- **THEN** the drawer closes and focus returns to the control that opened it

#### Scenario: A press beside the drawer closes the filter first
- **WHEN** the filter is expanded and the user presses the workspace beside the drawer
- **THEN** the filter collapses and the drawer stays open

#### Scenario: A press beside the drawer closes a menu first
- **WHEN** a row menu is open and the user presses the workspace beside the drawer
- **THEN** the menu closes and the drawer stays open

#### Scenario: Close control
- **WHEN** a user presses the panel header's close control
- **THEN** the drawer closes

### Requirement: Compact switcher create bar

While the panel presents a project, the switcher SHALL end in a create bar that stays in place while the tree above it scrolls. The bar SHALL hold a split new-terminal control and a New project control. The split control's main part SHALL create a terminal with the launcher this device chose most recently from the switcher, or the default shell when it has chosen none or that launcher is no longer available, in the selected folder of the presented project. Its visible label SHALL name that launcher and, when the project lists folders, the folder it creates in. Its accessible name SHALL state the launcher, the folder, and the project. The split control's disclosure part SHALL open the launcher dropup and SHALL point toward where the dropup opens. When no project is presented, the bar SHALL offer New project as its wide control. Add connection SHALL be reached from the server menu. Each control SHALL carry an accessible name stating its action. The create bar SHALL remain when a filter matches nothing.

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

### Requirement: Compact switcher project rail

The switcher's rail SHALL present, from top to bottom: a server control, the Home item, a divider, every project of every attached connection, and a New project control. Projects SHALL be grouped by connection: the window's current server first, then each other attached connection in the order the server menu lists them. Within a group, projects SHALL appear in the order they hold in the window's project composition. When more than one connection is attached, each group SHALL be headed by that connection's short name. Each project item SHALL show the project's colour, a short form of its name on its tile, and the project's name as a visible label beneath the tile, truncated to the rail's width. It SHALL carry an accessible name made of the project's name followed by the accessible text of its status summary when it has one, and SHALL carry the badge the activity presentation requirement defines, drawn clear of the selection mark. Only the selected item SHALL be marked as selected. Outside edit mode a swipe that starts on a rail item SHALL scroll the rail. The rail SHALL scroll when its items do not fit.

#### Scenario: Rail order
- **WHEN** the switcher opens with one connection holding projects terminay, paged, and dotfiles in that order
- **THEN** the rail shows the server control, Home, a divider, terminay, paged, dotfiles, and New project

#### Scenario: Two connections
- **WHEN** two connections are attached
- **THEN** the current server's projects come first under its short name, and the other connection's projects follow under its own

#### Scenario: Project label and status
- **WHEN** project terminay has one working terminal
- **THEN** its rail item shows terminay beneath its tile, and its accessible name states terminay and 1 working

#### Scenario: One selected item
- **WHEN** the switcher opens with project terminay in front
- **THEN** terminay is marked selected and Home is drawn unselected

### Requirement: Home in the compact switcher rail

The rail's Home item SHALL show a house glyph and the label Home beneath it, SHALL be drawn distinct from projects in a neutral colour, SHALL be drawn without a fill unless it is selected, SHALL carry a badge counting terminals that need the user across every project, and SHALL never show a grip or a close control.

#### Scenario: Home is not a project
- **WHEN** edit mode is on
- **THEN** the Home item shows no grip and no close control

#### Scenario: Home badge
- **WHEN** two terminals in different projects need the user
- **THEN** the Home item shows a badge of 2

#### Scenario: Home unselected
- **WHEN** a project is selected in the rail
- **THEN** the Home item is drawn without a fill or a selection mark

### Requirement: Compact switcher actions on another connection

While the panel presents a project on a connection other than the window's current server, the switcher SHALL offer only actions that switch the window to that server as their first effect. These are activating a panel or a folder, and creating a terminal with the default shell. A panel row's menu SHALL then offer Open alone. The folder ⋯ menu SHALL offer the default-shell new-terminal entry and Show folder alone. The launcher dropup SHALL list Terminal alone, with a note naming the server to switch to for its launchers. The panel SHALL offer no edit control. That project's rail item SHALL show no grip and no close control. Renaming, moving, closing, reordering, and removing SHALL be reached after the switch, because the window then holds that server's workspace. A switch that fails SHALL report the failure, leave the window on its current server, and perform nothing that was chosen.

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
