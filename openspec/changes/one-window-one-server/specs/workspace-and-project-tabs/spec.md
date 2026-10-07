## MODIFIED Requirements

### Requirement: Compact bar presentation

On a compact bar at phone width or 640px and below, the workspace chrome SHALL be a single row holding, in order: the application menu control where the host renders one, the file-explorer toggle, the dashboard control, the Command Bar control, a project-and-terminal breadcrumb that grows to fill the remaining width, and the connection control on the trailing edge. The Command Bar control SHALL open the Command Bar whichever view is selected, including Home and a window that holds no project. The breadcrumb SHALL name the active project and the active terminal, SHALL truncate the project name before the terminal title when space runs out, and SHALL open the unified switcher wherever it is pressed. The panel tab strip SHALL be absent on a compact workspace, for a project and for Home alike, and New project SHALL live in the switcher instead of as header `+` chrome. A pending application update SHALL stay visible on the row rather than being folded away. Above 640px the bar SHALL present the full project tab strip, its overflow switcher, the named connection control, and the panel tab strip.

#### Scenario: Phone-width chrome
- **WHEN** the project bar is at 640px or narrower
- **THEN** the chrome is one row of application menu, file-explorer toggle, dashboard, Command Bar control, breadcrumb, and connection control, and the panel tab strip is absent

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
- **THEN** the breadcrumb names that project and that terminal, truncating the project name first

#### Scenario: Either breadcrumb segment opens the switcher
- **WHEN** a user presses the project segment or the terminal segment of the breadcrumb
- **THEN** the unified switcher opens, and no other menu opens

#### Scenario: Compact All projects menu
- **WHEN** the compact switcher opens
- **THEN** it spans the window with compact rows listing every project of the window's server, and offers New project instead of header `+` chrome

#### Scenario: A pending update stays visible
- **WHEN** an application update is pending on a compact bar
- **THEN** its control stays on the row, between the breadcrumb and the connection control

#### Scenario: Wide bar is unchanged
- **WHEN** the project bar is wider than 640px
- **THEN** the full project tab strip, its overflow switcher, the named connection control, and the panel tab strip are present

### Requirement: Wide overflowing bar presentation

On a wider bar the overflowing strip SHALL fill the space before `+` and the connection control, the switcher SHALL stay pinned to that right edge, and at least one extra tab SHALL continue behind it with the pill covering about half of that last tab, rather than leaving a hole or looking like a last tab-like button. The wide-bar switcher menu SHALL stay an anchored dropdown, and the active tab SHALL stay among the real tabs. When every tab fits, `+` SHALL still sit immediately after the last tab and the connection control SHALL stay trailing.

#### Scenario: Wide bar overflowing
- **WHEN** a wide project bar overflows
- **THEN** the strip fills through to `+` and the connection control, the switcher stays on the right edge, at least one extra tab continues behind the pill covering about half of it, and the active project remains a real tab

#### Scenario: Every tab fits
- **WHEN** all project tabs fit the bar
- **THEN** `+` sits immediately after the last tab and the connection control stays trailing

### Requirement: Trailing chrome stays visible

The project tab bar SHALL NEVER steal leading or trailing chrome. The sidebar toggle, the Home control, the new-project control, activity, and the connection control SHALL stay fully visible.

#### Scenario: Crowded tab bar
- **WHEN** many project tabs are open
- **THEN** the sidebar toggle, the Home control, the new-project control, activity, and the connection control remain fully visible

### Requirement: Compact switcher terminal creation shows the created terminal

A terminal created from the compact switcher SHALL become the active terminal of its project: it SHALL be the terminal shown on screen, it SHALL receive terminal focus, and the switcher SHALL mark it as current the next time it opens. This SHALL hold for **New terminal**, which creates in the project in front, and for a project group's new-terminal control, which SHALL select that group's project first when it is not the project in front. The switcher SHALL dismiss when either create action is pressed. The terminal on screen and the switcher's current row SHALL never name different terminals after a create.

#### Scenario: New terminal in the project in front
- **WHEN** a user opens the compact switcher and presses New terminal
- **THEN** the switcher dismisses, a terminal is created in the project in front, and that terminal replaces the previous one on screen and takes terminal focus

#### Scenario: New terminal in a background project
- **WHEN** a user presses the new-terminal control of a project group that is not the project in front
- **THEN** that project becomes active and the created terminal is the terminal shown on screen

#### Scenario: Switcher agrees with the screen
- **WHEN** a user reopens the compact switcher after creating a terminal from it
- **THEN** the row marked current is the created terminal, which is also the terminal on screen

### Requirement: Compact switcher filtering

The switcher SHALL offer a text filter that matches terminal titles and project names. The filter SHALL start collapsed as a search control and SHALL expand into a field only when a user asks for it; nothing in the switcher SHALL take focus when it opens, so reaching a project or terminal never raises a software keyboard. Collapsing the filter SHALL clear it and restore the full grouped list. A filter SHALL keep a group whose project name matches, keep a terminal row whose title matches, and SHALL hide groups left with no rows. Clearing the filter SHALL restore the full grouped list. The filter SHALL NOT change which terminal is active.

#### Scenario: The switcher opens without taking focus
- **WHEN** the switcher opens
- **THEN** the filter is a collapsed search control, no field holds focus, and no software keyboard is raised

#### Scenario: Collapsing the filter restores the list
- **WHEN** a user collapses an expanded filter that was narrowing the list
- **THEN** the filter clears and every group returns

#### Scenario: Filtering by terminal title
- **WHEN** a user types text matching one terminal's title
- **THEN** only that terminal's row and its enclosing project heading remain

#### Scenario: Filtering by project name
- **WHEN** a user types text matching a project name
- **THEN** that project's group and all of its terminal rows remain

#### Scenario: Filter matches nothing
- **WHEN** the filter matches no terminal or project
- **THEN** the switcher reports that nothing matches and still offers its create actions

### Requirement: Compact switcher panel rows

The compact switcher SHALL list every terminal, file, and folder panel of every project of the window's server, grouped by project. Each panel row SHALL name that panel and SHALL activate it when pressed, selecting that panel's project first when it is not the active one. A terminal row SHALL present that terminal's activity state and, where the window holds its live buffer, its most recent non-empty output line. A long press on a panel row SHALL open that panel's editor.

#### Scenario: File and folder panels appear as rows
- **WHEN** a project holds a terminal, a file panel, and a folder panel
- **THEN** the switcher lists a row for each under that project

#### Scenario: Activating a file in a background project
- **WHEN** a user presses a file row belonging to a project that is not active
- **THEN** that project becomes active and that file panel becomes the active panel

## ADDED Requirements

### Requirement: Project attributes and the tab strip

A project SHALL have an optional root folder on its server, a name, colour, icon, default shell-profile override, per-project navigation state, and a Dockview layout holding terminal, file, and folder panels. Projects and panels SHALL be movable between the projects and workspace views of that server, and a terminal title SHALL NEVER be an identity boundary. A window's tab strip SHALL present the projects of the window's server and of no other.

#### Scenario: Project attributes
- **WHEN** a project exists in a workspace view
- **THEN** it carries an optional root folder on its server, name, colour, icon, shell-profile override, navigation state, and a Dockview layout of panels

#### Scenario: Title is not identity
- **WHEN** a terminal's title changes
- **THEN** no identity or authorization boundary changes

#### Scenario: One server's tabs
- **WHEN** a window shows a server
- **THEN** its tab strip holds that server's projects and no tab names a server

### Requirement: Torn-off windows activate on the same server

A newly torn-off native window SHALL become the active window once its workspace is ready, and the first interaction with its terminal controls SHALL be delivered to that control rather than being consumed only to activate the window. A torn-off window SHALL show the same server as the window it was torn from. Tearing a project into a new native window SHALL be available in a window showing Local and SHALL NOT be offered in a window showing a remote server, because a remote server holds one live connection for each device.

#### Scenario: First click in a new window
- **WHEN** a user clicks a terminal control in a newly torn-off window
- **THEN** the click reaches that control instead of only activating the window

#### Scenario: Server of a torn-off window
- **WHEN** a project is torn out of a window showing a remote server
- **THEN** the new window shows that same server

#### Scenario: A window showing a remote server
- **WHEN** a user drags a project tab out of a window showing a remote server
- **THEN** no new window opens and the project stays in its window

### Requirement: Workspace views are native windows on one server

Desktop SHALL present workspace views as native windows. Project tabs SHALL be draggable between native windows that show Local, while web clients manage the same views in-page. A native window showing a different server SHALL NOT be a drop target. Moving a project SHALL preserve its panels, live PTYs, scrollback, and service identities.

#### Scenario: Dragging a project between windows
- **WHEN** a project tab is dragged into another native window showing the same server
- **THEN** its panels, live PTYs, scrollback, and service identities are preserved

#### Scenario: A window on another server
- **WHEN** a project tab is dragged over a native window showing a different server
- **THEN** that window does not accept the drop and the project stays where it was

### Requirement: New-project control placement

The new-project `+` SHALL sit immediately after the last visible tab, or after the overflow switcher when the strip is filling the bar. Activity and the connections control SHALL stay trailing.

#### Scenario: Control placement with overflow
- **WHEN** the strip is filling the bar
- **THEN** `+` sits after the overflow switcher, with activity and the connections control trailing

### Requirement: New-project control creates on the window's server

The project-bar new-project control SHALL create a project on the window's server immediately. It SHALL NOT offer a choice of server.

#### Scenario: Primary create
- **WHEN** a user activates the new-project `+`
- **THEN** a project is created on the window's server immediately

#### Scenario: No server chooser
- **WHEN** Desktop remembers several servers
- **THEN** the new-project control still offers no server choice, and a project on another server is created from a window showing that server

### Requirement: One workspace view per window

Each native project-host window SHALL present exactly one server-owned workspace view on its server. Tearing a project into a new native window SHALL create a destination view on that server and canonically move the existing project into it; it SHALL NOT copy the project into renderer state and SHALL NOT close the source project.

#### Scenario: Tearing off a project

- **WHEN** a project is torn into a new native window
- **THEN** a destination view is created on the window's server, the project moves canonically into it, and it is neither copied into renderer state nor closed in the source

#### Scenario: After a tear-off

- **WHEN** the workspace later refreshes
- **THEN** the source window shows the source view's remaining projects and the destination shows only the destination view's projects

### Requirement: Managing project tabs

Users SHALL be able to create, rename, reorder, close, and colour or icon project tabs. Renaming, closing, and colour or icon changes SHALL be applied on the window's server, which owns the tab's project, and SHALL NOT reach any other server.

#### Scenario: Editing tab appearance
- **WHEN** a user renames a project or changes its colour or icon
- **THEN** the change is applied to the server-owned project

#### Scenario: Editing a tab while another window shows another server
- **WHEN** a user renames or closes a tab while a second window shows a different server
- **THEN** the command is sent only to the first window's server and no project on the other server changes

### Requirement: Project overflow switcher menu

When project tabs no longer fit, overflowed tabs SHALL leave the strip and remain reachable from a project switcher presenting a colour swatch, label, numeric badge, and chevron opening a shared menu of every project of the window's server. A row SHALL NOT name a server.

#### Scenario: Tabs overflow
- **WHEN** the strip cannot fit every project tab
- **THEN** overflowed tabs leave the strip and remain reachable from the switcher's shared menu of every project of the window's server

#### Scenario: Rows name projects only
- **WHEN** the switcher menu opens
- **THEN** each row shows its project and no row names a server

### Requirement: Reordering project tabs

The strip SHALL be click-and-drag to reorder for visible tabs only. The shared menu SHALL list every project, SHALL be able to activate or close one, and SHALL reorder via its grips so portrait web clients are not limited to a drag-to-reorder strip they cannot scroll. Dragging along the visible strip SHALL reorder there; native tear-off SHALL start only after the pointer leaves the bar. Tab order SHALL be the server-owned project order of the window's workspace view. A drop SHALL commit through `project.move` in the current view so a later snapshot cannot snap the tab back. Menu grips SHALL track the pointer rather than being HTML5 drag sources so they work inside the desktop title-bar drag region, and the menu SHALL stay open through the drop.

#### Scenario: Dragging a visible tab
- **WHEN** a user drags a visible project tab along the strip
- **THEN** the strip reorders and the new order commits through `project.move` in the current view

#### Scenario: Pointer leaves the bar
- **WHEN** a drag continues past the edge of the project bar
- **THEN** native tear-off begins

#### Scenario: Reordering from the menu
- **WHEN** a user drags a grip in the shared project menu
- **THEN** the grip tracks the pointer, the menu stays open through the drop, and the order commits through `project.move`

#### Scenario: Order survives a snapshot
- **WHEN** a tab has been dropped at a new position and a later workspace snapshot arrives
- **THEN** the strip shows the order the server committed and the tab does not snap back

### Requirement: Pending project tab while a project is created

Creating a project SHALL immediately add a non-active pending tab with the future project label and a spinning project icon, for a project on the window's server. Validation, canonical project creation, terminal launch, and terminal hydration SHALL happen behind that tab without covering or replacing the active project, which SHALL remain usable. When the terminal is ready, Terminay SHALL activate and focus the new project only if the user has not selected another project since creation began; if the user has moved elsewhere, the ready project SHALL remain in the background. A creation failure SHALL activate the pending tab and present its error there.

A creation interrupted by loss of the connection SHALL NOT fail. The pending tab SHALL keep its spinning icon while the connection recovers; once the workspace has resynchronised, Terminay SHALL continue with the project if the server has it and SHALL send the creation again if it does not. Creation SHALL fail only when the server refuses it or when recovery itself gives up, and SHALL never yield two projects for one request.

A failed pending tab SHALL NOT hold the rest of the window. Every other project tab and Home SHALL remain selectable and usable while it exists, and selecting one SHALL show that project. The `+` control SHALL remain usable, and starting another creation SHALL replace the failed pending tab. The failed pending tab SHALL offer a retry action, which starts the same creation again in place, and SHALL be dismissible by its close control.

#### Scenario: Creation begins
- **WHEN** a user starts creating a project
- **THEN** a non-active pending tab with the future label and a spinning icon appears while the active project stays usable

#### Scenario: Creation completes with no user navigation
- **WHEN** the new terminal becomes ready and the user has not selected another project
- **THEN** the new project is activated and focused

#### Scenario: User moved elsewhere
- **WHEN** the new terminal becomes ready but the user has since selected another project
- **THEN** the ready project stays in the background

#### Scenario: Creation fails
- **WHEN** project creation fails
- **THEN** the pending tab is activated and the error is presented there

#### Scenario: Pending tab in a window showing a remote server
- **WHEN** a project is created in a window showing a remote server
- **THEN** the pending tab stands for a project on that server and shows the future label and spinning icon with no server name

#### Scenario: Connection lost before the server created the project
- **WHEN** the connection is lost while a project is being created, the workspace reconnects, and the server does not have the project
- **THEN** the pending tab keeps spinning, the creation is sent again, and exactly one project results

#### Scenario: Connection lost after the server created the project
- **WHEN** the connection is lost while a project is being created, the workspace reconnects, and the server already has the project
- **THEN** the pending tab keeps spinning, the creation is not sent again, and the project's terminal is launched

#### Scenario: Selecting another project while a creation has failed
- **WHEN** a pending tab shows a failed creation and the user selects another project tab
- **THEN** that project is shown and is usable, and the failed pending tab stays in the tab bar

#### Scenario: Creating again while a creation has failed
- **WHEN** a pending tab shows a failed creation and the user uses the `+` control
- **THEN** a new creation starts and its pending tab replaces the failed one

#### Scenario: Retrying a failed creation
- **WHEN** the user chooses retry on a failed pending tab
- **THEN** the tab returns to its spinning state and the same creation runs again

### Requirement: Roots of new projects

New projects SHALL use the default root or verified account home of the window's server and SHALL NEVER copy an active project's root. A root chosen for a new project SHALL be browsed and validated on the window's server. Target and root validation SHALL complete before the pending tab becomes a normal project tab.

#### Scenario: Root selection for a new project
- **WHEN** a project is created
- **THEN** it uses the server's default root or verified account home and does not inherit another project's root

#### Scenario: Validation ordering
- **WHEN** target and root validation is still running
- **THEN** the tab remains pending until validation completes

#### Scenario: Browsing a root in a window showing a remote server
- **WHEN** the user browses for a root in a window showing a remote server
- **THEN** the folders offered come from that server's filesystem alone

### Requirement: Creating, splitting, and moving panels

New terminals SHALL open in the active project of that presentation. Tabs SHALL be able to split the active layout horizontally or vertically, be reordered, be moved to another project, or be moved into another workspace view. A panel SHALL only move within its own server: a window showing a different server SHALL NOT be offered as a drop target, and no panel or terminal SHALL be recreated on another server.

#### Scenario: Splitting a layout
- **WHEN** a user splits the active layout horizontally or vertically
- **THEN** the panel layout updates in the active project

#### Scenario: Moving a panel to another project
- **WHEN** a panel is moved to another project or workspace view on the same server
- **THEN** it moves without losing its identity

#### Scenario: Dragging a panel toward a window on another server
- **WHEN** a user drags a panel over a native window showing a different server
- **THEN** that window is not offered as a drop target and no move is attempted

### Requirement: Closing windows and application shutdown

Closing a native project-host window SHALL close only that window and detach its workspace-view presentation while another project-host window remains. Closing a window SHALL release its connection to its server and SHALL close, delete, or terminate nothing on any server. Application shutdown SHALL begin only when the final project-host window closes or the user explicitly invokes Quit.

#### Scenario: Closing one of several windows
- **WHEN** a project-host window closes while others remain
- **THEN** only that window closes and its workspace-view presentation detaches

#### Scenario: Closing the last window
- **WHEN** the final project-host window closes or Quit is invoked
- **THEN** application shutdown begins

#### Scenario: Closing a window showing a remote server
- **WHEN** a window showing a remote server closes while others remain
- **THEN** its connection is released and every project, panel, and terminal on that server is unchanged

### Requirement: Canonical workspace state and local selection

Project identity, layout, panel membership, project-local sidebar layout, and logical workspace views SHALL be canonical state of the server that owns them. The ordered project list in a view and the ordered panels in a project SHALL be broadcast to every presentation connected to that server. Which view is selected — the Home dashboard or a project — which terminal or panel is active inside a selected project, and which server a window shows SHALL be local to that presentation, so a desktop window and a web client on the same server can show different selected views. Desktop windows and browser views SHALL also retain their own per-project sidebar visibility.

#### Scenario: Two presentations of one server
- **WHEN** a desktop window and a web client connect to the same server
- **THEN** they keep independent selected views, active terminals, and per-project sidebar visibility while sharing the ordered project and panel lists

#### Scenario: Structural change broadcast
- **WHEN** a project is created, reordered, or closed
- **THEN** the change appears in every connected client's list without changing another client's selected view

#### Scenario: Locally selected item disappears
- **WHEN** a locally selected project or panel is removed
- **THEN** that presentation falls back locally

#### Scenario: Home selected on one device
- **WHEN** one device selects the Home dashboard
- **THEN** no server-owned workspace state changes and no other device's selected view changes

#### Scenario: Two windows show different servers
- **WHEN** two windows of the same client show different servers
- **THEN** each keeps its own server and selection, and no server records which window shows it

### Requirement: Authorization derives from authenticated identities

A project SHALL be a navigation and authorization boundary, while the immutable server terminal session id SHALL remain the identity used by services. Every request SHALL be authorized by the server that owns its target. Remote and MCP scopes SHALL derive from authenticated server, project, and session identities and SHALL NEVER derive from tab labels, tab order, which server a window shows, or client focus.

#### Scenario: Scoping a remote or MCP request
- **WHEN** a remote or MCP operation is authorized
- **THEN** its scope comes from authenticated server, project, and session identities rather than tab labels or client focus

#### Scenario: A window's server is not authority
- **WHEN** two windows of one device show different servers and one of them reorders its tabs
- **THEN** each server authorizes only its own objects, and neither the server a window shows nor its tab order grants scope on any server

### Requirement: Compact switcher groups by project

A compact workspace SHALL provide one switcher that presents every terminal of every project of the window's server, grouped by project. Each project group SHALL name its project with that project's colour and SHALL offer a new terminal for that project. Each terminal row SHALL name its terminal and SHALL activate that terminal when pressed, selecting that terminal's project first when it is not the active one. The switcher SHALL show no connection heading and SHALL NOT name a server on a group or a row. The switcher SHALL offer New terminal for the project in front, New project, and Add connection alongside the per-group new terminal, so every create action absorbed from the collapsed chrome remains reachable. New terminal SHALL be absent when no project is in front rather than acting on an arbitrary one. On Terminay Desktop the switcher SHALL also list every remembered server beneath the project groups, with **Local** first and the window's server marked, and choosing another SHALL switch the window to it. The switcher SHALL open from the breadcrumb and from the connection control, presenting the same content from both.

#### Scenario: Grouped by project
- **WHEN** the switcher opens on a server holding projects with terminals
- **THEN** rows appear under a group for each project, and no heading names a connection

#### Scenario: Activating a terminal in a background project
- **WHEN** a user presses a terminal row belonging to a project that is not active
- **THEN** that project becomes active and that terminal becomes the active terminal

#### Scenario: Connection control opens the same switcher
- **WHEN** a user presses the connection control on a compact workspace
- **THEN** the unified switcher opens with the same grouped content the breadcrumb opens

#### Scenario: Switching servers at phone width
- **WHEN** a Desktop user presses another remembered server in the compact switcher
- **THEN** the window switches to that server

#### Scenario: Create actions survive the collapse
- **WHEN** the switcher is open with a project in front
- **THEN** it offers a new terminal for each project group, New terminal, New project, and Add connection

#### Scenario: No project in front
- **WHEN** the switcher is open while the dashboard is selected
- **THEN** New terminal is absent and the other create actions remain

#### Scenario: Only the window's server
- **WHEN** the device remembers several servers and the switcher opens
- **THEN** it lists the projects and terminals of the window's server and nothing of any other

### Requirement: Activity dot on project tabs

Each project tab SHALL present a single activity dot immediately before the tab title. The dot SHALL be the same indicator a terminal tab shows for its own status: the same size, the same colours, and the same breathing effect while working. The dot SHALL carry no number. It SHALL reflect that project's terminals that currently have a visible activity indicator, using the same per-terminal items that feed the header Notifications list, so the **Show indicator for active tabs** and **Show indicator for finished tabs** settings govern it without a separate setting. The dot SHALL reflect only terminals of that tab's own project. The dot SHALL take the highest-priority state present in the project: red when any terminal needs attention, otherwise amber and breathing when any terminal is working, otherwise green when any terminal has finished unviewed activity. The dot SHALL be hidden when no terminal in the project has a visible indicator, SHALL appear on the active project tab as well as background tabs, and SHALL NOT be a separate control; pressing it activates the project like the rest of the tab. Its accessible name SHALL state the project's state and how many terminals are in it.

#### Scenario: One working terminal

- **WHEN** a project has exactly one working terminal and no other indicators
- **THEN** its tab shows an amber breathing dot before the title, the same size as the dot on that terminal's tab, and no number

#### Scenario: One finished terminal in a background project

- **WHEN** a background project has exactly one terminal with a finished unviewed indicator and no other indicators
- **THEN** its tab shows a steady green dot before the title

#### Scenario: Mixed states resolve to the highest priority

- **WHEN** a project has one terminal needing attention, one working terminal, and one finished unviewed terminal
- **THEN** its tab shows a single red dot

#### Scenario: Active project shows the dot too

- **WHEN** the active project has a terminal whose structured completion produced a finished indicator
- **THEN** the active project tab shows a green dot

#### Scenario: Dot hidden with nothing to show

- **WHEN** every terminal in a project has been viewed and none is working or needs attention
- **THEN** the project tab shows no dot and the title sits where it would without one

#### Scenario: Pressing the dot

- **WHEN** a user presses the dot on a background project tab
- **THEN** that project becomes active and no other action occurs

#### Scenario: Activity in another project

- **WHEN** one project has a working terminal
- **THEN** only that project's tab shows a dot and every other tab is unaffected

#### Scenario: Activity on a server the window does not show

- **WHEN** a terminal is working on a server other than the window's
- **THEN** no tab in the window shows a dot for it

#### Scenario: Reduced motion

- **WHEN** the system requests reduced motion and a project has a working terminal
- **THEN** its tab shows a steady amber dot

### Requirement: Project activity dot clears as terminals are viewed

The project-tab activity dot SHALL reflect the same terminals that currently show a visible activity indicator, resolved by the tab's project. Clicking a terminal tab, clicking into the terminal, typing, dismissing its notification, or already interacting with it when finished or attention activity arrives, SHALL remove that terminal from the dot's state. Activating the project SHALL NOT remove a terminal from it. A working terminal SHALL keep contributing while it is working, including when its tab is focused. The dot SHALL hide when no terminal contributes.

#### Scenario: Activating the project keeps the dot

- **WHEN** a project shows a green dot because a single terminal has finished unviewed activity, and the user activates that project without clicking the terminal
- **THEN** the project tab dot remains green

#### Scenario: Focusing the last finished terminal

- **WHEN** a project shows a green dot because a single terminal has finished unviewed activity, and the user clicks that terminal tab
- **THEN** the project tab dot hides

#### Scenario: Completion on the focused terminal

- **WHEN** the only activity in a project is structured or agent completion on the terminal the user is already viewing
- **THEN** the project tab dot stays hidden

#### Scenario: Working on the focused terminal

- **WHEN** the focused terminal in a project is working and no other terminal in that project has an indicator
- **THEN** the project tab keeps an amber breathing dot

#### Scenario: Identical project ids in windows showing different servers

- **WHEN** two windows show different servers that each hold a project with the same id, and only one server has an unviewed finished terminal in it
- **THEN** only the window showing that server shows the dot on its tab

### Requirement: Switcher rows show the project activity dot

Each project row in the project switcher menu and in the compact switcher SHALL show the same activity dot as that project's tab, before the project name, with the same state, colour, breathing effect, and hiding behaviour, so projects that have overflowed out of the strip or are hidden behind the compact switcher remain covered. A row's dot SHALL reflect only terminals of that row's own project.

#### Scenario: Overflowed project with activity

- **WHEN** a project has overflowed out of the tab strip and has two working terminals
- **THEN** its row in the project switcher menu shows one amber breathing dot before its name

#### Scenario: Activity in one of two projects

- **WHEN** the switcher lists two projects and one of them has a working terminal
- **THEN** only that project's row shows the dot

### Requirement: Dropping a terminal tab onto a project tab

A terminal tab SHALL be droppable on a visible project tab in the project bar, and that drop SHALL move the terminal into that project with the same outcome as choosing that project from the tab's **Move to project** context action: the terminal keeps its session identity, scrollback, title, colour, emoji, note, and recording state, the target project becomes the active project, and the moved terminal is the focused terminal there.

A project tab SHALL accept the drop only when it is a project the context action would offer for that terminal: a ready project of the window's server, other than the terminal's own project. The terminal's own project tab, a pending or failed project tab, a project tab in a window showing a different server, the Home control, and every other project bar control SHALL NOT accept the drop, and releasing a terminal tab over one of them SHALL leave the terminal where it was.

While a terminal tab is dragged over a project tab that accepts it, that project tab SHALL be visibly marked as the drop target, and the mark SHALL clear when the pointer leaves the tab or the drag ends. A project tab that does not accept the drop SHALL show no drop affordance. Dragging a terminal tab over the project bar SHALL NOT activate, reorder, or tear off any project tab.

Only a dragged terminal tab SHALL be moved this way. A dragged file tab, folder tab, or whole panel group SHALL NOT be accepted by a project tab. Dropping a terminal tab on a project tab SHALL NOT also pop the terminal out into its own window.

#### Scenario: Dropping a terminal on another project
- **WHEN** a user drags a terminal tab from the active project and releases it on another project's tab
- **THEN** the terminal leaves its project, appears in the target project with its session, scrollback, and tab presentation intact, the target project becomes active, and the moved terminal is focused

#### Scenario: Same result as the context action
- **WHEN** one terminal is moved by dropping it on a project tab and another is moved to the same project through **Move to project**
- **THEN** both terminals end in the target project in the same state, and no second terminal or session is created for either

#### Scenario: Hovering an eligible project tab
- **WHEN** a dragged terminal tab is held over a project tab that accepts it
- **THEN** that project tab is marked as the drop target, and the mark clears when the pointer leaves it

#### Scenario: Releasing on the terminal's own project
- **WHEN** a terminal tab is released on the tab of the project it already belongs to
- **THEN** no drop affordance is shown and the terminal stays where it was

#### Scenario: A project tab in a window showing another server
- **WHEN** a terminal tab is dragged over a project tab in a native window showing a different server
- **THEN** that tab shows no drop affordance and releasing there moves nothing

#### Scenario: Pending or failed project tab
- **WHEN** a terminal tab is dragged over a project tab that is still being created or failed creation
- **THEN** that tab shows no drop affordance and releasing there moves nothing

#### Scenario: Home control and bar chrome
- **WHEN** a terminal tab is released on the Home control, the `+` control, or empty project bar space
- **THEN** nothing is moved and the terminal stays in its project

#### Scenario: Dragging something other than a terminal tab
- **WHEN** a file tab, a folder tab, or a whole panel group is dragged over a project tab
- **THEN** the project tab shows no drop affordance and releasing there moves nothing

#### Scenario: Project bar is undisturbed by the drag
- **WHEN** a terminal tab is dragged across the project bar and released without an eligible target
- **THEN** the active project, the project tab order, and the set of native windows are unchanged

## REMOVED Requirements

### Requirement: One workspace view per attached server per window

**Reason**: A window shows one server, so there is no attached server to hold a second view.

**Migration**: "One workspace view per window" keeps the tear-off contract for the window's one server.

### Requirement: Tabs of an unavailable or incompatible server stay in the strip

**Reason**: A window's tabs all belong to one server, so an unavailable or incompatible server is a state of the whole window rather than of some of its tabs.

**Migration**: See "Connection failure behaviour" and "The bundle's client negotiates server compatibility" in `connections-and-client-hosts`.

### Requirement: Project split button

**Reason**: Its text and scenarios describe choosing among attached servers or attaching a server to a window. A window shows one server.

**Migration**: Restated for one server per window as "New-project control creates on the window's server".

### Requirement: New-project placement

**Reason**: Its text and scenarios describe choosing among attached servers or attaching a server to a window. A window shows one server.

**Migration**: Restated for one server per window as "New-project control placement".

### Requirement: Workspace views as native windows

**Reason**: Its text and scenarios describe choosing among attached servers or attaching a server to a window. A window shows one server.

**Migration**: Restated for one server per window as "Workspace views are native windows on one server".

### Requirement: Torn-off window activation

**Reason**: Its text and scenarios describe choosing among attached servers or attaching a server to a window. A window shows one server.

**Migration**: Restated for one server per window as "Torn-off windows activate on the same server".

### Requirement: Project composition

**Reason**: Its text and scenarios describe one strip interleaving the projects of several attached servers. A window shows one server.

**Migration**: Restated for one server per window as "Project attributes and the tab strip".

### Requirement: Project tab management

**Reason**: Its scenario "Editing a tab of an attached server" describes several servers sharing one window. A window shows one server.

**Migration**: Restated for one server per window as "Managing project tabs".

### Requirement: Project overflow switcher

**Reason**: Its menu lists the projects of every attached connection and its rows name their server. A window shows one server.

**Migration**: Restated for one server per window as "Project overflow switcher menu".

### Requirement: Reordering projects

**Reason**: It makes tab order a client-owned composition interleaving several servers' tabs. A window's tab order is the server-owned project order of its workspace view.

**Migration**: Restated for one server per window as "Reordering project tabs".

### Requirement: Pending project tab during creation

**Reason**: Its pending tab is bound to a chosen server and names it when several connections are attached. A window shows one server.

**Migration**: Restated for one server per window as "Pending project tab while a project is created".

### Requirement: New project roots

**Reason**: Its scenario browses a root after choosing among attached servers. New projects are created on the window's server.

**Migration**: Restated for one server per window as "Roots of new projects".

### Requirement: Panel creation, splitting, and movement

**Reason**: Its scenario describes another attached server's project sharing the window as a refused drop target. A window shows one server.

**Migration**: Restated for one server per window as "Creating, splitting, and moving panels".

### Requirement: Window closing and application shutdown

**Reason**: Its scenario describes closing a window that holds attached connections. A window holds one connection.

**Migration**: Restated for one server per window as "Closing windows and application shutdown".

### Requirement: Canonical workspace state and presentation-local selection

**Reason**: It keeps a window's composition of primary and attached connections as presentation-local state. A window shows one server and has no composition.

**Migration**: Restated for one server per window as "Canonical workspace state and local selection".

### Requirement: Authorization derives from server identities

**Reason**: Its scenario "Composition is not authority" describes a window attaching several servers. A window shows one server.

**Migration**: Restated for one server per window as "Authorization derives from authenticated identities".

### Requirement: Unified compact switcher

**Reason**: It groups rows by connection and then by project and requires a connection heading. A window shows one server, so the switcher groups by project only.

**Migration**: Restated for one server per window as "Compact switcher groups by project".

### Requirement: Project tab activity dot

**Reason**: Its scenario "Activity on another attached server" describes several servers' tabs in one strip. A window shows one server.

**Migration**: Restated for one server per window as "Activity dot on project tabs".

### Requirement: Project activity dot follows viewed terminals

**Reason**: It resolves the dot by the pair of a tab's server and project, for two attached servers holding the same project id. Inside a window a project is identified by the project alone.

**Migration**: Restated for one server per window as "Project activity dot clears as terminals are viewed".

### Requirement: Project switcher rows show the activity dot

**Reason**: Its scenario describes two attached servers holding the same project id in one switcher. A window shows one server.

**Migration**: Restated for one server per window as "Switcher rows show the project activity dot".

### Requirement: Dropping a terminal tab on a project tab

**Reason**: Its text and scenarios describe project tabs of another attached server and inert tabs of an unreachable one. A window shows one server.

**Migration**: Restated for one server per window as "Dropping a terminal tab onto a project tab".
