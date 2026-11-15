## ADDED Requirements

### Requirement: Compact chrome row

On a compact bar at phone width or 640px and below, the workspace chrome SHALL be a single row holding, in order: the Command Bar control, a title block that grows to fill the remaining width, the Notifications control, Pixel's dock while the active server has Pixel on, and the sidebar toggle at the trailing end. The row SHALL carry no application menu control, no Home control, and no connection control; Home and the server menu are reached from the switcher's rail. The sidebar toggle SHALL be drawn as a panel on the right-hand side and SHALL show and hide the project sidebar while a project is in front, and Home's sidebar while Home is selected. The title block SHALL show when the active server is unreachable or has a server upgrade available, and SHALL say so in its accessible name. The Command Bar control SHALL open the Command Bar whichever view is selected, including Home and a window that holds no project. The title block SHALL name what is on screen as the compact title block requirement states and SHALL open the unified switcher wherever it is pressed. The panel tab strip SHALL be absent on a compact workspace, for a project and for Home alike, and New project SHALL live in the switcher instead of as header `+` chrome. A pending application update SHALL stay visible on the row rather than being folded away. Above 640px the bar SHALL present the full project tab strip, its overflow switcher, the named connection control, and the panel tab strip.

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

### Requirement: Compact switcher reaches every panel

A compact workspace SHALL provide one switcher, presented as a drawer, that reaches every terminal, file, and folder panel of every project of every attached connection. The drawer SHALL hold a project rail along its leading edge and a panel beside it that presents the rail item that is selected. When the drawer opens, the rail item selected SHALL be Home while Home is the selected view and the project in front otherwise. Selecting a project in the rail SHALL present that project in the panel without activating it; only choosing a panel, a folder, or a create action SHALL change what is on screen. The switcher SHALL offer a new terminal in every folder it lists, a new terminal for a presented project whose folders it does not list, a new terminal where the user already is, New project, and Add connection, so every create action absorbed from the collapsed chrome remains reachable. The new terminal where the user already is SHALL be absent when no project is in front rather than acting on an arbitrary one. The switcher SHALL open from the title block.

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


### Requirement: Compact switcher application menu

When the host draws its application menu in page, or offers a menu button for its native application menu, the switcher SHALL show that menu as a band across the top of the drawer, above both the rail and the panel. A menu drawn in page SHALL present as a menu bar of the same named menus, in the same order, as the wide menu bar, and SHALL scroll sideways when its names do not fit the drawer's width. Pressing a menu name SHALL open that menu's commands beneath it, uncut by the drawer or the band. Choosing a command SHALL close the switcher and run the command on the workspace. A host with neither SHALL show no band.

#### Scenario: Browser on a phone
- **WHEN** a browser user opens the switcher on a 390px workspace
- **THEN** a menu bar with Terminay, Edit, View, and Help runs across the top of the drawer

#### Scenario: Running a command from the switcher
- **WHEN** a user opens View in the switcher's menu bar and chooses Open Command Bar
- **THEN** the switcher closes and the Command Bar opens

#### Scenario: Narrower than the menu bar
- **WHEN** the menu names are wider than the drawer
- **THEN** the band scrolls sideways and the drawer does not

#### Scenario: Desktop on a phone-width window
- **WHEN** a Desktop host with native menus and no menu button renders the switcher
- **THEN** the switcher shows no menu band

## REMOVED Requirements

### Requirement: Compact bar presentation

**Reason:** Restated as **Compact chrome row**: the row drops its application menu, Home, and connection controls, and the sidebar toggle moves to the trailing end.

**Migration:** See **Compact chrome row**.

### Requirement: Unified compact switcher

**Reason:** Restated as **Compact switcher reaches every panel**: the switcher no longer opens from a connection control, which the row no longer has.

**Migration:** See **Compact switcher reaches every panel**.

### Requirement: Compact connection control presentation

**Reason:** The compact chrome row no longer carries a connection control. It opened the same switcher as the title block, and the switcher's rail already holds the server control, its reachability, and the server menu.

**Migration:** Server reachability and upgrades show on the title block and the rail's server control.

### Requirement: Compact Home toggle

**Reason:** The compact chrome row no longer carries a Home control; Home is the first item of the switcher's rail.

**Migration:** Open the switcher from the title block and choose Home in its rail.
