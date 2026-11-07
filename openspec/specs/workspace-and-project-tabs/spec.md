# workspace-and-project-tabs Specification

## Purpose

Define how Terminay organises work as project tabs — creation, editing, ordering, overflow chrome, panel layout, cross-view and cross-window movement, and close protection — over server-owned workspace state.

## Requirements

### Requirement: Project composition

A project SHALL have an optional root folder on its server, a name, colour, icon, default shell-profile override, per-project navigation state, and a Dockview layout holding terminal, file, and folder panels. Projects and panels SHALL be movable between the projects and workspace views of that server, and a terminal title SHALL NEVER be an identity boundary. A window's tab strip SHALL present the projects of every attached connection interleaved in one strip, each tab bound to its owning server; that order SHALL be client-owned presentation state and SHALL NEVER be sent to a server.

#### Scenario: Project attributes
- **WHEN** a project exists in a workspace view
- **THEN** it carries an optional root folder on its server, name, colour, icon, shell-profile override, navigation state, and a Dockview layout of panels

#### Scenario: Title is not identity
- **WHEN** a terminal's title changes
- **THEN** no identity or authorization boundary changes

#### Scenario: Tabs from several servers
- **WHEN** a window attaches two servers that each hold projects
- **THEN** one strip shows every project of both, each tab bound to the server that owns it, in an order the client holds

### Requirement: Documentation presentation within a file panel

Markdown and MDX files SHALL be able to use the rich Documentation presentation within a canonical file panel, and changing presentation SHALL NOT change panel or file identity.

#### Scenario: Switching presentation
- **WHEN** a canonical file panel switches to or from the Documentation presentation
- **THEN** the panel and file identity are unchanged

### Requirement: Project tab management

Users SHALL be able to create, rename, reorder, close, and colour or icon project tabs. Renaming, closing, and colour or icon changes SHALL be applied on the server that owns the tab's project and SHALL NOT reach any other attached server.

#### Scenario: Editing tab appearance
- **WHEN** a user renames a project or changes its colour or icon
- **THEN** the change is applied to the server-owned project

#### Scenario: Editing a tab of an attached server
- **WHEN** a user renames or closes a tab whose project belongs to an attached server
- **THEN** the command is sent only to that server and no other attached server's projects change

### Requirement: Joined chrome band

The active project tab's colour SHALL continue into the panel tab strip and the sidebar group tab bar so that chrome reads as one band. When the active project shows no panel tab strip, such as while it awaits its start choice, the active project tab SHALL be a closed rounded shape within the project bar rather than running down into the workspace. Sidebar pane titles SHALL use the dark project-bar surface with white labels, and pane bodies SHALL share the terminal background. Sidebar pane titles SHALL stay quiet on hover; only title actions such as refresh, explorer file rows, and the 4px resize rail SHALL highlight. The sidebar toggle SHALL be an icon on the dark project bar that highlights slightly on hover. The new-project `+` SHALL be an icon button with the same even pacing as the panel-strip add controls rather than a joined chip. Panel tabs on that strip SHALL use a 4px corner, the active panel tab SHALL be the solid chip, and inactive tabs SHALL stay quiet until hover.

#### Scenario: Active project colour
- **WHEN** a project tab is active
- **THEN** its colour continues into the panel tab strip and the sidebar group tab bar as one band

#### Scenario: Active project awaiting its start
- **WHEN** the active project shows its start chooser and no panel tab strip
- **THEN** its project tab is a closed rounded shape within the project bar and does not run into the chooser

#### Scenario: Hovering sidebar chrome
- **WHEN** a user hovers a sidebar pane title
- **THEN** the title stays quiet while title actions, explorer file rows, and the 4px resize rail highlight

#### Scenario: Panel tab states
- **WHEN** panel tabs are shown
- **THEN** the active tab is a solid 4px-cornered chip and inactive tabs stay quiet until hover

### Requirement: Home control placement

The project bar SHALL carry a Home control between the sidebar toggle and the first project tab. It SHALL be leading chrome rather than a project tab: it SHALL NEVER scroll, overflow, reorder, or be dragged, SHALL NEVER be closeable, and SHALL NEVER participate in project drag-and-drop as either a dragged item or a drop target. Dragging a project tab across it SHALL NOT displace it.

#### Scenario: Home sits after the sidebar toggle

- **WHEN** the project bar renders
- **THEN** the Home control sits immediately after the sidebar toggle and before the first project tab

#### Scenario: Dragging a project tab

- **WHEN** a project tab is dragged across the Home control
- **THEN** the Home control is neither a drop target nor displaced, and no project is reordered into its position

### Requirement: Project overflow switcher

When project tabs no longer fit, overflowed tabs SHALL leave the strip and remain reachable from a project switcher presenting a colour swatch, label, numeric badge, and chevron opening a shared menu of every project of every attached connection. When more than one connection is attached, each row SHALL name the server that owns its project.

#### Scenario: Tabs overflow
- **WHEN** the strip cannot fit every project tab
- **THEN** overflowed tabs leave the strip and remain reachable from the switcher's shared menu of every project of every attached connection

#### Scenario: Rows name their server
- **WHEN** more than one connection is attached and the switcher menu opens
- **THEN** each project row names the server that owns that project

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

### Requirement: Wide overflowing bar presentation

On a wider bar the overflowing strip SHALL fill the space before `+` and Local, the switcher SHALL stay pinned to that right edge, and at least one extra tab SHALL continue behind it with the pill covering about half of that last tab, rather than leaving a hole or looking like a last tab-like button. The wide-bar switcher menu SHALL stay an anchored dropdown, and the active tab SHALL stay among the real tabs. When every tab fits, `+` SHALL still sit immediately after the last tab and Local SHALL stay trailing.

#### Scenario: Wide bar overflowing
- **WHEN** a wide project bar overflows
- **THEN** the strip fills through to `+` and Local, the switcher stays on the right edge, at least one extra tab continues behind the pill covering about half of it, and the active project remains a real tab

#### Scenario: Every tab fits
- **WHEN** all project tabs fit the bar
- **THEN** `+` sits immediately after the last tab and Local stays trailing

### Requirement: Reordering projects

The strip SHALL be click-and-drag to reorder for visible tabs only. The shared menu SHALL list every project, SHALL be able to activate or close one, and SHALL reorder via its grips so portrait web clients are not limited to a drag-to-reorder strip they cannot scroll. Dragging along the visible strip SHALL reorder there; native tear-off SHALL start only after the pointer leaves the bar. Tab order SHALL be the window's client-owned composition. A drop that changes the relative order of two tabs of the same server SHALL commit through `project.move` in that server's current view so a later snapshot cannot snap the tab back; a drop that only changes a tab's position relative to another server's tabs SHALL change presentation order alone and SHALL send no command to any server. Menu grips SHALL track the pointer rather than being HTML5 drag sources so they work inside the desktop title-bar drag region, and the menu SHALL stay open through the drop.

#### Scenario: Dragging a visible tab
- **WHEN** a user drags a visible project tab along the strip
- **THEN** the strip reorders and the new order commits through `project.move` in the current view

#### Scenario: Pointer leaves the bar
- **WHEN** a drag continues past the edge of the project bar
- **THEN** native tear-off begins

#### Scenario: Reordering from the menu
- **WHEN** a user drags a grip in the shared project menu
- **THEN** the grip tracks the pointer, the menu stays open through the drop, and the order commits through `project.move`

#### Scenario: Dropping a tab between another server's tabs
- **WHEN** a user drags a tab of one server between two tabs of another server
- **THEN** the strip shows the new order, the window's composition records it, and no server receives a command

### Requirement: Focus after creation

A user-created terminal, or a project's first terminal launched from its start choice, SHALL receive keyboard focus in that xterm so typing starts immediately. A user-created project awaiting a start choice SHALL focus the chooser's first start action. Creation chrome such as the project and terminal `+` controls SHALL NOT keep focus after the new project or session is ready.

#### Scenario: Creating a terminal
- **WHEN** a user creates a terminal and its session becomes ready
- **THEN** keyboard focus moves into that xterm and does not remain on the `+` control

#### Scenario: Creating a project
- **WHEN** a user creates a project and it becomes ready awaiting a start choice
- **THEN** keyboard focus moves to the chooser's first start action and does not remain on the `+` control

#### Scenario: Choosing a start
- **WHEN** a user makes a start choice and the project's first terminal becomes ready
- **THEN** keyboard focus moves into that xterm

### Requirement: Pending project tab during creation

Creating a project SHALL immediately add a non-active pending tab with the future project label and a spinning project icon, bound to the server chosen to own it and showing that server when more than one connection is attached. Validation, canonical project creation, terminal launch, and terminal hydration SHALL happen behind that tab without covering or replacing the active project, which SHALL remain usable. The project is ready when its terminal is ready or, for a project awaiting a start choice, when the server has committed it. When the project is ready, Terminay SHALL activate and focus the new project only if the user has not selected another project since creation began; if the user has moved elsewhere, the ready project SHALL remain in the background. A creation failure SHALL activate the pending tab and present its error there.

A creation interrupted by loss of the connection SHALL NOT fail. The pending tab SHALL keep its spinning icon while the connection recovers; once the workspace has resynchronised, Terminay SHALL continue with the project if the server has it and SHALL send the creation again if it does not. Creation SHALL fail only when the server refuses it or when recovery itself gives up, and SHALL never yield two projects for one request.

A failed pending tab SHALL NOT hold the rest of the window. Every other project tab and Home SHALL remain selectable and usable while it exists, and selecting one SHALL show that project. The `+` control SHALL remain usable, and starting another creation SHALL replace the failed pending tab. The failed pending tab SHALL offer a retry action, which starts the same creation again in place, and SHALL be dismissible by its close control.

#### Scenario: Creation begins
- **WHEN** a user starts creating a project
- **THEN** a non-active pending tab with the future label and a spinning icon appears while the active project stays usable

#### Scenario: Creation completes with no user navigation
- **WHEN** the new project becomes ready and the user has not selected another project
- **THEN** the new project is activated and focused

#### Scenario: User moved elsewhere
- **WHEN** the new project becomes ready but the user has since selected another project
- **THEN** the ready project stays in the background

#### Scenario: Creation fails
- **WHEN** project creation fails
- **THEN** the pending tab is activated and the error is presented there

#### Scenario: Pending tab names its server
- **WHEN** a project is created on an attached server while more than one connection is attached
- **THEN** the pending tab shows that server

#### Scenario: Connection lost before the server created the project
- **WHEN** the connection is lost while a project is being created, the workspace reconnects, and the server does not have the project
- **THEN** the pending tab keeps spinning, the creation is sent again, and exactly one project results

#### Scenario: Connection lost after the server created the project
- **WHEN** the connection is lost while a project is being created, the workspace reconnects, and the server already has the project
- **THEN** the pending tab keeps spinning, the creation is not sent again, and the project continues from the state the server holds

#### Scenario: Selecting another project while a creation has failed
- **WHEN** a pending tab shows a failed creation and the user selects another project tab
- **THEN** that project is shown and is usable, and the failed pending tab stays in the tab bar

#### Scenario: Creating again while a creation has failed
- **WHEN** a pending tab shows a failed creation and the user uses the `+` control
- **THEN** a new creation starts and its pending tab replaces the failed one

#### Scenario: Retrying a failed creation
- **WHEN** the user chooses retry on a failed pending tab
- **THEN** the tab returns to its spinning state and the same creation runs again

#### Scenario: A project awaiting a start choice becomes ready
- **WHEN** a project created with no root is committed by the server and the user has not selected another project
- **THEN** the pending tab becomes a normal tab, is activated, and shows the start chooser without waiting for any terminal

### Requirement: New project roots

New projects SHALL NEVER copy another project's root, whether from the active project, the first project in the view, or any other project. A project created from the UI without a root SHALL be created awaiting a start choice and SHALL receive its root, or no root, only from that choice. A project created with an explicit root SHALL use that root once the owning server has validated it. A root chosen for a new project SHALL be browsed and validated on the server that will own it. Target and root validation SHALL complete before the pending tab becomes a normal project tab.

#### Scenario: Root selection for a new project
- **WHEN** a user creates a project from the UI while other projects with roots are open
- **THEN** the creation sends no root, and the project awaits a start choice instead of inheriting another project's root

#### Scenario: Explicit root at creation
- **WHEN** a project is created with an explicit root, for example through MCP or by creating a terminal in an unknown project
- **THEN** the server validates that root, the project uses it, and no start chooser is shown

#### Scenario: Validation ordering
- **WHEN** target and root validation is still running
- **THEN** the tab remains pending until validation completes

#### Scenario: Browsing a root on the chosen server
- **WHEN** the user browses for a root after choosing an attached server
- **THEN** the folders offered come from that server's filesystem alone

### Requirement: Atomic colour and icon commit

Project creation SHALL commit its initial colour and icon atomically with the server-owned project so rapid creation cannot reuse an uncommitted colour.

#### Scenario: Rapid successive creation
- **WHEN** several projects are created in quick succession
- **THEN** each commits its own colour and icon atomically and no colour is reused from an uncommitted project

### Requirement: Project root selection sources

A project root SHALL be selectable from the server-side folder browser, from the owning server's recent project folders, or by deriving it from the active terminal's working directory. Selecting a root for a project with no root folder SHALL give it that root, and the project SHALL leave no-root mode.

#### Scenario: Deriving from terminal cwd
- **WHEN** a user sets the project root from the active terminal's working directory
- **THEN** that working directory becomes the project root

#### Scenario: A no-root project gains a root
- **WHEN** a user sets a root for a project that has no root folder
- **THEN** the project takes that root, and its Explorer, Git, and Documentation panes present it

### Requirement: Closing the final panel

Closing the final panel SHALL close the project, and closing the first project SHALL NOT unexpectedly quit the app.

#### Scenario: Last panel closed
- **WHEN** the final panel in a project is closed
- **THEN** the project closes

#### Scenario: First project closed
- **WHEN** the first project is closed while others remain
- **THEN** the application does not quit

### Requirement: Panel creation, splitting, and movement

New terminals SHALL open in the active project of that presentation. Tabs SHALL be able to split the active layout horizontally or vertically, be reordered, be moved to another project, or be moved into another workspace view. A panel SHALL only move within its own server: a project or workspace view owned by another server SHALL NOT be offered as a drop target, and no panel or terminal SHALL be recreated on another server.

#### Scenario: Splitting a layout
- **WHEN** a user splits the active layout horizontally or vertically
- **THEN** the panel layout updates in the active project

#### Scenario: Moving a panel to another project
- **WHEN** a panel is moved to another project or workspace view on the same server
- **THEN** it moves without losing its identity

#### Scenario: Dragging a panel toward another server's project
- **WHEN** a user drags a panel over a project owned by a different attached server
- **THEN** that project is not offered as a drop target and no move is attempted

### Requirement: Moving a terminal to another project is committed by the server

Moving a terminal tab to another project, from **Move to project** or by dropping the tab on a project tab, SHALL be committed through the `panel.move` workspace command. The terminal SHALL be presented in the target project only once the server has committed the move, and from then on SHALL be presented in the target project and in no other project. The moved terminal SHALL keep its session id, scrollback, title, colour, emoji, note, and recording state, and its process SHALL keep running throughout. On the client that requested the move, the target project SHALL become active and the moved terminal SHALL be focused.

A move the server refuses or that fails SHALL leave the terminal presented in its original project, attached and running, and SHALL report the reason.

#### Scenario: Terminal moved from the context menu

- **WHEN** a user chooses **Move to project** and a project for a terminal tab
- **THEN** the move commits through `panel.move`, the target project becomes active, and the terminal is focused there with the same session id and scrollback

#### Scenario: Workspace changes after a move

- **WHEN** a terminal has been moved to another project and the workspace then changes in any way, such as a terminal being created
- **THEN** the moved terminal is presented in its new project only, and its tab does not reappear in the project it left

#### Scenario: Output continues after a move

- **WHEN** a terminal running a long-lived command is moved to another project and projects are switched back and forth
- **THEN** the terminal keeps printing that command's output in its new project and shows no connection error

#### Scenario: Moving a terminal back

- **WHEN** a terminal that was moved to another project is moved back to the project it came from
- **THEN** it is presented once, in the project it came from, and keeps running

#### Scenario: Restart or another client after a move

- **WHEN** a terminal has been moved to another project and the workspace is then opened after a restart or from another client
- **THEN** the terminal is presented in the project it was moved to

#### Scenario: Move refused

- **WHEN** the server refuses a terminal move or the move fails
- **THEN** the terminal stays in its original project, attached and running, and the reason is shown

### Requirement: Panel order is canonical

Dropping a terminal, file, or folder tab at a new position SHALL commit that panel order to canonical workspace state in both desktop and web clients, and a later workspace refresh or reconnect SHALL preserve the dropped order.

#### Scenario: Reordering panels
- **WHEN** a panel tab is dropped at a new position and the workspace later refreshes or reconnects
- **THEN** the dropped order is preserved

### Requirement: Project shell-profile default

A project SHALL be able to use the server's default shell profile or select a project default under the canonical shell profiles and terminal launch policy. That selection SHALL affect future sessions only.

#### Scenario: Changing a project shell profile
- **WHEN** a project's default shell profile changes
- **THEN** existing sessions are unaffected and only future sessions use the new profile

### Requirement: Workspace views as native windows

Desktop SHALL present workspace views as native windows. Project tabs SHALL be draggable between them, while web clients manage the same views in-page. Dragging a tab into another native window SHALL attach that tab's server to the destination window if it is not attached already. Moving a project SHALL preserve its panels, live PTYs, scrollback, and service identities.

While a torn-off project tab is held over another native window's project bar, that window SHALL show the tab in its strip at the pointer's position with its other tabs making room, and the floating drag preview SHALL be hidden for as long as a strip shows the tab. Moving the pointer along the bar SHALL move the shown tab with it; moving off the bar SHALL remove it from the strip and restore the floating preview. Releasing over the bar SHALL place the project at the shown position, SHALL make it that window's active project, and SHALL bring that window to the front with keyboard focus. The shown position SHALL be a position in that window's client-owned tab order.

#### Scenario: Dragging a project between windows
- **WHEN** a project tab is dragged into another native window
- **THEN** its panels, live PTYs, scrollback, and service identities are preserved

#### Scenario: Destination window has not attached that server
- **WHEN** a project tab is dragged into a native window that has not attached its server
- **THEN** the destination window attaches that server and the project moves within its own server's views

#### Scenario: Holding a tab over another window's bar
- **WHEN** a torn-off project tab is held over another native window's project bar
- **THEN** that window shows the tab in its strip at the pointer and the floating drag preview is hidden

#### Scenario: Leaving the bar without dropping
- **WHEN** the pointer leaves that bar while the tab is still held
- **THEN** the strip no longer shows the tab and the floating drag preview returns

#### Scenario: Dropping at a position
- **WHEN** the tab is released over that bar before one of its tabs
- **THEN** the project sits immediately before that tab, is the window's active project, and the window has keyboard focus

#### Scenario: Dropping after the last tab
- **WHEN** the tab is released over that bar to the right of every tab
- **THEN** the project is the last tab and is the window's active project

### Requirement: Torn-off window activation

A newly torn-off native window SHALL become the active window once its workspace is ready, and the first interaction with its terminal controls SHALL be delivered to that control rather than being consumed only to activate the window. A torn-off window SHALL keep the source window's primary connection and SHALL attach the torn project's server.

#### Scenario: First click in a new window
- **WHEN** a user clicks a terminal control in a newly torn-off window
- **THEN** the click reaches that control instead of only activating the window

#### Scenario: Composition of a torn-off window
- **WHEN** a project owned by an attached server is torn into a new native window
- **THEN** the new window keeps the source window's primary connection and attaches that project's server

### Requirement: Window closing and application shutdown

Closing a native project-host window SHALL close only that window and detach its workspace-view presentation while another project-host window remains. Closing a window SHALL detach its connections and SHALL close, delete, or terminate nothing on any server. Application shutdown SHALL begin only when the final project-host window closes or the user explicitly invokes Quit.

#### Scenario: Closing one of several windows
- **WHEN** a project-host window closes while others remain
- **THEN** only that window closes and its workspace-view presentation detaches

#### Scenario: Closing the last window
- **WHEN** the final project-host window closes or Quit is invoked
- **THEN** application shutdown begins

#### Scenario: Closing a window with attached servers
- **WHEN** a window with attached connections closes
- **THEN** those connections detach and every project, panel, and terminal on those servers is unchanged

### Requirement: Project tab editing surface

Double-clicking a project tab SHALL open project-tab editing in the current host's auxiliary-route presentation: Desktop MAY use a native modal window and web SHALL use an in-page edit-tab surface. Saving SHALL update the server-owned project name, root, colour, and icon; cancel SHALL leave project state unchanged.

#### Scenario: Saving an edit
- **WHEN** a user saves project-tab editing
- **THEN** the server-owned project name, root, colour, and icon are updated

#### Scenario: Cancelling an edit
- **WHEN** a user cancels project-tab editing
- **THEN** project state is unchanged

### Requirement: Long-press editing from the switcher

Long-pressing the project switcher pill SHALL edit the active project, and long-pressing a project row in that menu SHALL edit that project. A short press SHALL still open the menu or activate the project. Long-press SHALL NOT toggle the menu, switch projects, or start a reorder.

#### Scenario: Long-pressing the pill
- **WHEN** a user long-presses the project switcher pill
- **THEN** the active project opens for editing without the menu toggling or a reorder starting

#### Scenario: Short press
- **WHEN** a user short-presses the pill or a project row
- **THEN** the menu opens or the project activates

### Requirement: File and folder panels

Files and folders opened from project navigation SHALL become dockable panels in the relevant project. Closing a panel SHALL dispose only that panel's resources; terminal termination SHALL be explicit terminal lifecycle behaviour.

#### Scenario: Closing a file panel
- **WHEN** a file or folder panel is closed
- **THEN** only that panel's resources are disposed

### Requirement: Absent active selection remains a valid snapshot

Closing or moving the final canonical panel or project in a container SHALL leave its active selection absent rather than serializing an undefined optional field. The resulting workspace revision SHALL remain a valid snapshot or delta that every connected presentation can reconcile, including when local file panels remain.

#### Scenario: Last canonical panel removed
- **WHEN** the final canonical panel or project in a container is closed or moved
- **THEN** the active selection is absent and the workspace revision remains a valid reconcilable snapshot or delta

### Requirement: Terminal close protection

Closing an idle terminal SHALL proceed immediately. Closing a terminal SHALL evaluate foreground-process state only for that terminal's exact session; activity, output, agent work, or process observation in another terminal SHALL NOT delay it. Closing a terminal whose PTY has a non-shell foreground process SHALL ask whether to **Close Terminal** or **Keep Running** before terminating it. A silent interactive process SHALL remain busy even when it has helper children, and a unique running command SHALL NOT be required. Close protection SHALL obtain a bounded fresh observation for that session. If the sample cannot complete, Terminay SHALL still close immediately unless a committed or partial sample already identified a non-shell foreground process; missing observation SHALL NOT be treated as a running process.

#### Scenario: Idle terminal
- **WHEN** a terminal at its shell prompt is closed
- **THEN** it closes immediately

#### Scenario: Busy terminal
- **WHEN** a terminal with a non-shell foreground process is closed
- **THEN** Terminay asks whether to Close Terminal or Keep Running before terminating it

#### Scenario: Silent interactive process with helper children
- **WHEN** a silent interactive foreground process has helper children
- **THEN** it still counts as busy and triggers the warning

#### Scenario: Observation sample cannot complete
- **WHEN** the bounded fresh observation does not complete and no committed or partial sample identified a non-shell foreground process
- **THEN** the terminal closes immediately

#### Scenario: Busy sibling terminal
- **WHEN** another terminal is producing sustained output or has slow foreground observation
- **THEN** the close of the target terminal is not delayed

### Requirement: Project close protection

Closing a project SHALL proceed immediately when all of its terminals are at their shell prompts. If one or more project terminals have non-shell foreground processes, Terminay SHALL report the affected terminal count and ask whether to **Close Project** or **Keep Running**. Moving a project or terminal between views SHALL NOT be a close and SHALL NEVER trigger this warning.

#### Scenario: All terminals idle
- **WHEN** a project whose terminals are all at their shell prompts is closed
- **THEN** it closes immediately

#### Scenario: Busy project terminals
- **WHEN** one or more of a project's terminals have non-shell foreground processes
- **THEN** the affected terminal count is reported and Close Project or Keep Running is offered

#### Scenario: Moving instead of closing
- **WHEN** a project or terminal moves between views
- **THEN** no close warning is triggered

### Requirement: Window close protection

Closing a native project-host window SHALL use the same bounded fresh foreground-process observation for terminals in that window's workspace view. Activity snapshots SHALL NOT be sufficient, because a command that has already started may not yet be committed as `foregroundBusy`. If one or more of those terminals have a non-shell foreground process, Terminay SHALL ask whether to **Close Window** or **Keep Running**; the final project-host window SHALL use **Quit Terminay** instead. If the sample cannot complete, the window SHALL close immediately unless a committed or partial sample already identified a non-shell foreground process.

#### Scenario: Busy terminal in a window
- **WHEN** a project-host window with a busy terminal is closed while other windows remain
- **THEN** Terminay asks whether to Close Window or Keep Running, and confirming closes only that window

#### Scenario: Final window
- **WHEN** the final project-host window with a busy terminal is closed
- **THEN** the Quit Terminay warning and graceful shutdown path are used

#### Scenario: Recently started command
- **WHEN** a command has started but is not yet committed as `foregroundBusy`
- **THEN** the bounded fresh observation, not an activity snapshot, determines whether to warn

### Requirement: Canonical workspace state and presentation-local selection

Project identity, layout, panel membership, project-local sidebar layout, and logical workspace views SHALL be canonical state of the server that owns them. The ordered project list in a view and the ordered panels in a project SHALL be broadcast to every presentation connected to that server. Which view is selected — the Home dashboard or a project — which terminal or panel is active inside a selected project, and the window's composition of primary and attached connections with their tab order SHALL be local to that presentation, so a desktop window and a web client on the same server can show different selected views and different compositions. Desktop windows and browser views SHALL also retain their own per-project sidebar visibility.

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

#### Scenario: Two windows attach different servers
- **WHEN** two windows of the same client attach different sets of servers
- **THEN** each keeps its own composition, and no server records either one

### Requirement: Authorization derives from server identities

A project SHALL be a navigation and authorization boundary, while the immutable server terminal session id SHALL remain the identity used by services. Every request SHALL be authorized by the connection whose server owns its target. Remote and MCP scopes SHALL derive from authenticated server, project, and session identities and SHALL NEVER derive from tab labels, tab order, the window's composition, or client focus.

#### Scenario: Scoping a remote or MCP request
- **WHEN** a remote or MCP operation is authorized
- **THEN** its scope comes from authenticated server, project, and session identities rather than tab labels or client focus

#### Scenario: Composition is not authority
- **WHEN** a window attaches several servers and reorders its tabs
- **THEN** each server authorizes only its own objects, and the attached set and tab order grant no scope on any server

### Requirement: Independent multi-project state and sidebar restoration

Multi-project work SHALL remain independent when roots, tabs, layouts, or sidebar state change. Reloading SHALL restore the current device's sidebar visibility and selected sidebar group for each project. Reconnecting SHALL restore each project's pane order, dimensions, collapse choices, and supported pane navigation state without changing a different device's visibility, selected group, or active project tab.

#### Scenario: Reloading a client
- **WHEN** a client reloads
- **THEN** its own sidebar visibility and selected sidebar group are restored per project

#### Scenario: Reconnecting
- **WHEN** a client reconnects
- **THEN** pane order, dimensions, collapse choices, and supported pane navigation state are restored without affecting another device's visibility, group, or active tab

### Requirement: Sidebar resizing and pane layout

Resizing a project sidebar SHALL preview locally and commit once when the interaction finishes. The sidebar tab bar SHALL switch Explorer, Documentation, and Agents. Every visible pane title in the active group SHALL remain on-screen, the sidebar itself SHALL NOT scroll vertically, and overflowing pane content SHALL scroll inside its own pane.

#### Scenario: Dragging the sidebar rail
- **WHEN** a user resizes the project sidebar
- **THEN** the change previews locally and commits once when the interaction finishes

#### Scenario: Overflowing pane content
- **WHEN** a pane's content exceeds its height
- **THEN** the content scrolls inside that pane, every visible pane title stays on-screen, and the sidebar does not scroll vertically

### Requirement: Session continuity across moves

Moving or popping a project SHALL NOT duplicate a terminal session or lose its connection to activity, agent, recording, or remote services. Reconnecting from a fresh client SHALL restore project and panel identity from server state without recreating live terminals.

#### Scenario: Popping a project out
- **WHEN** a project is moved or popped into another window
- **THEN** no terminal session is duplicated and its activity, agent, recording, and remote service connections persist

#### Scenario: Fresh client connects
- **WHEN** a fresh client connects to the server
- **THEN** project and panel identity are restored from server state without recreating live terminals

### Requirement: Commands operate on the active target

Keyboard and menu commands SHALL operate on the active project or panel and SHALL fail clearly when their required target is absent.

#### Scenario: Command without a target
- **WHEN** a keyboard or menu command requires a target that is absent
- **THEN** it fails with a clear message

### Requirement: Terminal removal and reconciliation

Sequentially closing every canonical terminal while another local panel stays visible SHALL remove each terminal exactly once and SHALL leave workspace reconciliation current; the final removal SHALL NOT strand an exited terminal presentation. Closing an already-exited terminal tab SHALL succeed while another live terminal remains, SHALL NOT wait on killing a finished PTY, SHALL NOT offer a connection retry that replaces the workspace transport, and SHALL NOT stall sibling terminals.

#### Scenario: Closing every terminal in sequence
- **WHEN** every canonical terminal is closed one after another while a local file panel remains visible
- **THEN** each is removed exactly once, reconciliation stays current, and no exited terminal presentation is stranded

#### Scenario: Closing an exited terminal
- **WHEN** an already-exited terminal tab is closed while another live terminal remains
- **THEN** the close succeeds without waiting on the finished PTY, without offering a transport-replacing retry, and without stalling siblings

### Requirement: Renderer detachment is not a panel close

Reloading or closing a renderer SHALL detach its presentation and SHALL NOT turn Dockview disposal into canonical panel-close commands. Restored renderers SHALL hydrate the same panels and terminal sessions and SHALL be able to type into still-running shells.

#### Scenario: Renderer reload
- **WHEN** a renderer reloads or closes
- **THEN** its presentation detaches, no canonical panel-close commands are issued, and a restored renderer hydrates the same panels and can type into still-running shells

### Requirement: Close warnings depend only on canonical PTY state

Terminal and project close warnings SHALL depend on canonical PTY foreground-process state and SHALL NOT depend on recent output, agent status, tab attention, or display settings.

#### Scenario: Noisy but idle terminal
- **WHEN** a terminal has recent output or agent attention but no non-shell foreground process
- **THEN** closing it produces no warning

### Requirement: Visually distinct default project colours

A newly created project SHALL receive a default colour drawn from the project
colour palette that is as far as the palette allows from every colour already in
use by projects in the same workspace view, including colours reserved by
projects whose creation is still in flight. Selection SHALL maximise the
smallest hue distance to those in-use colours rather than take the first unused
palette entry. Where several palette entries are equally distant, the choice
SHALL be derived from the project's identity so that the same project in the
same workspace state always receives the same colour. When a project is being
created and no colour is in use at all, every palette entry is equally distant
and the project SHALL take a random palette colour, so that a fresh workspace
does not always start on the same hue. Deriving a colour for a project that
already exists SHALL NEVER be random: a project the server holds without a stored
colour SHALL show the same colour every time its presentation is re-derived. A
colour a user has chosen explicitly, and a colour already persisted
on a project, SHALL NEVER be reassigned by this selection.

#### Scenario: Second project takes a far-apart hue
- **WHEN** a workspace view holds one project coloured red and the user creates a second project
- **THEN** the new project's default colour is the palette hue furthest from that red, not a neighbouring red or pink

#### Scenario: Colours spread as projects accumulate
- **WHEN** projects are created one after another in the same view
- **THEN** each new default colour is the palette hue whose smallest distance to the colours already in use is the largest available

#### Scenario: Palette exhausted
- **WHEN** every palette colour is already in use in the view and another project is created
- **THEN** the new project still receives the palette colour furthest from the colours in use, and creation succeeds

#### Scenario: Explicit colour is preserved
- **WHEN** a user sets a project's colour explicitly and later creates another project
- **THEN** the existing project keeps the colour the user chose and only the new project is assigned a default

#### Scenario: First project in an empty view
- **WHEN** the first project in a workspace view is created and no colours are in use
- **THEN** its default colour is a random palette colour, so two fresh workspaces do not reliably start on the same hue

#### Scenario: Re-deriving the colour of a project stored without one
- **WHEN** the workspace reconciles a server project that has no stored colour, repeatedly and after unrelated workspace updates
- **THEN** the project shows the same colour every time and does not change as other parts of the workspace change

#### Scenario: Spread stays reproducible after the first colour
- **WHEN** the same project is assigned a colour twice against the same non-empty set of in-use colours
- **THEN** it receives the same colour both times

### Requirement: Unique default project names

A newly created project SHALL receive a default name that no existing project on
the server already holds. The default SHALL be `Project N` for the lowest
positive integer N not currently in use, so a number freed by closing a project
is reused before a higher one. The workspace's seeded default project, named
plain `Project`, SHALL hold the first number, so the first project a user creates
is `Project 2`. A name supplied explicitly by a user SHALL be honoured as given,
including when it duplicates another project's name.

#### Scenario: First user-created project alongside the seeded default
- **WHEN** a workspace holds only its seeded default project named "Project" and the user creates a project
- **THEN** the new project is named "Project 2"

#### Scenario: Creating after closing a project
- **WHEN** a workspace holds "Project 1", "Project 2", and "Project 3", the user closes "Project 2", and then creates a project
- **THEN** the new project is named "Project 2" and no two projects share a name

#### Scenario: Rapid successive creation
- **WHEN** several projects are created in quick succession
- **THEN** each receives a distinct default name

#### Scenario: Creation across different entry points
- **WHEN** projects are created from the project-bar new-project button and from the File menu in the same workspace
- **THEN** their default names come from one numbering sequence and do not collide

#### Scenario: A user-chosen name is not rewritten
- **WHEN** a user renames a project to a name another project already uses
- **THEN** the name is stored as typed

### Requirement: New-project placement

The new-project `+` SHALL sit immediately after the last visible tab, or after the overflow switcher when the strip is filling the bar. Its server chooser SHALL open from the same control and SHALL NOT grow or shift the tab bar. Activity and Local SHALL stay trailing.

#### Scenario: Control placement with overflow
- **WHEN** the strip is filling the bar
- **THEN** `+` sits after the overflow switcher, with activity and Local trailing

#### Scenario: Opening the server chooser
- **WHEN** the server chooser opens from the new-project control
- **THEN** the tab bar neither grows nor shifts

### Requirement: Project split button

The project-bar split button's primary `+` SHALL create a project on the active tab's server immediately. Its arrow SHALL open an accessible chooser listing every attached connection so the user selects which server owns the new project; the active tab's server SHALL be the default. A connection that is unavailable or incompatible SHALL be listed as unselectable.

#### Scenario: Primary create
- **WHEN** a user activates the primary `+`
- **THEN** a project is created on the active tab's server immediately

#### Scenario: Choosing another attached server
- **WHEN** a user opens the arrow and selects another attached connection
- **THEN** the new project is created on that server and its tab joins the strip

#### Scenario: Unavailable connection in the chooser
- **WHEN** an attached connection is offline or incompatible
- **THEN** the chooser lists it as unselectable and no create command is sent to it

### Requirement: Trailing chrome stays visible

The project tab bar SHALL NEVER steal leading or trailing chrome. The sidebar toggle, the Home control, the new-project control, activity, and the Local connection pill SHALL stay fully visible.

#### Scenario: Crowded tab bar
- **WHEN** many project tabs are open
- **THEN** the sidebar toggle, the Home control, the new-project control, activity, and the Local connection pill remain fully visible

### Requirement: Initial terminal in every project

A started user-created project SHALL receive one terminal through the server's normal terminal-launch resolver as an explicit creation flow, never a renderer repair for an empty workspace. A project awaiting a start choice SHALL have no terminal, and its first terminal SHALL be launched by its start choice. After a Local Desktop restart, each restored started project SHALL keep its terminal panels and SHALL receive no additional terminal when it already has one. A restored started project without a terminal panel SHALL receive one fresh terminal. Each restored project awaiting a start choice SHALL show its chooser and receive no terminal. The project tab SHALL show a spinner while a user-created project is still loading.

#### Scenario: Restart restores projects
- **WHEN** Local Desktop restarts with saved started projects
- **THEN** each restored started project keeps its terminal panels and receives no additional terminal when it already has one

#### Scenario: Restart restores a project awaiting a choice
- **WHEN** Local Desktop restarts with a saved project that awaits a start choice
- **THEN** the project shows its start chooser and no terminal is launched for it

#### Scenario: Loading indication
- **WHEN** a project's creation is still loading
- **THEN** its tab shows a spinner

### Requirement: One workspace view per attached server per window

Each native project-host window SHALL present exactly one server-owned workspace
view on its primary connection and exactly one on each attached connection.
Tearing a project into a new native window SHALL create a destination view on
that project's own server and canonically move the existing project into it; it
SHALL NOT copy the project into renderer state and SHALL NOT close the source
project.

#### Scenario: Tearing off a project

- **WHEN** a project is torn into a new native window
- **THEN** a destination view is created on that project's server, the project
  moves canonically into it, and it is neither copied into renderer state nor
  closed in the source

#### Scenario: After a tear-off

- **WHEN** the workspace later refreshes
- **THEN** the source window shows the source view's remaining projects and the
  destination shows only the destination view's projects

#### Scenario: A window with two attached servers

- **WHEN** a window attaches two servers
- **THEN** it presents exactly one workspace view on each, and its tab strip
  draws only from those two views

### Requirement: Tabs of an unavailable or incompatible server stay in the strip

Tabs of an attached connection that is offline, reconnecting, unauthenticated, or
incompatible SHALL keep their position in the tab strip and SHALL render greyed
and inert: activating, editing, closing, reordering into another server's run, or
opening a panel inside them SHALL be unavailable, and no operation SHALL be sent
to that connection. Each such tab SHALL show the connection's state, and an
incompatible connection SHALL name which side needs upgrading, the client or the
server. Detaching the connection SHALL remove its tabs from the strip and SHALL
close nothing on that server.

#### Scenario: An attached server goes offline

- **WHEN** an attached connection drops
- **THEN** its tabs stay in place, render greyed and inert, show the connection's
  state, and every other server's tabs stay fully usable

#### Scenario: An incompatible server

- **WHEN** an attached connection is incompatible
- **THEN** its tabs are greyed and inert, name which side needs upgrading, and
  receive no operations

#### Scenario: Detaching a server

- **WHEN** the user detaches an attached connection
- **THEN** its tabs leave the strip and its projects, panels, and terminals on
  that server are unchanged

### Requirement: Panel tab close control placement

A panel tab's close control SHALL sit at the trailing edge of that tab, after
the title, with its trailing inset matching the inset the title has at the
leading edge so that the `×` is optically balanced with the label. The control
SHALL keep its own hit target rather than shrinking to the glyph.

#### Scenario: Close sits opposite the title

- **WHEN** a panel tab is drawn
- **THEN** its close control sits at the trailing edge with the same inset the
  title has at the leading edge

#### Scenario: Active tab is not a special case

- **WHEN** a panel tab is the active, solid chip
- **THEN** its close control sits at the same trailing inset as an inactive
  tab's, so the chip shows no extra gap after the `×`

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

### Requirement: Compact connection control presentation

On a compact workspace the connection control SHALL present as a glyph without the server name, SHALL keep the exposure tone it carries on a wide bar, and SHALL carry a reachability indicator for its connection. Its accessible name SHALL still name the current server so the control is identifiable without the visible label.

#### Scenario: Name gives way to the glyph
- **WHEN** the workspace is 640px or narrower
- **THEN** the connection control shows a glyph with its exposure tone and a reachability indicator, and no server name

#### Scenario: Accessible name keeps the server
- **WHEN** assistive technology reads the compact connection control
- **THEN** its accessible name includes the current server

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

### Requirement: Project tab activity dot

Each project tab SHALL present a single activity dot immediately before the tab title. The dot SHALL be the same indicator a terminal tab shows for its own status: the same size, the same colours, and the same breathing effect while working. The dot SHALL carry no number. It SHALL reflect that project's terminals that currently have a visible activity indicator, using the same per-terminal items that feed the header Notifications list, so the **Show indicator for active tabs** and **Show indicator for finished tabs** settings govern it without a separate setting. The dot SHALL reflect only terminals of that tab's own project on its own server. The dot SHALL take the highest-priority state present in the project: red when any terminal needs attention, otherwise amber and breathing when any terminal is working, otherwise green when any terminal has finished unviewed activity. The dot SHALL be hidden when no terminal in the project has a visible indicator, SHALL appear on the active project tab as well as background tabs, and SHALL NOT be a separate control; pressing it activates the project like the rest of the tab. Its accessible name SHALL state the project's state and how many terminals are in it.

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

#### Scenario: Activity on another attached server

- **WHEN** a project on one attached server has a working terminal
- **THEN** only that project's tab shows a dot and tabs of every other server are unaffected

#### Scenario: Reduced motion

- **WHEN** the system requests reduced motion and a project has a working terminal
- **THEN** its tab shows a steady amber dot

### Requirement: Project activity dot follows viewed terminals

The project-tab activity dot SHALL reflect the same terminals that currently show a visible activity indicator, resolved by the pair of the tab's server and its project. Clicking a terminal tab, clicking into the terminal, typing, dismissing its notification, or already interacting with it when finished or attention activity arrives, SHALL remove that terminal from the dot's state. Activating the project SHALL NOT remove a terminal from it. A working terminal SHALL keep contributing while it is working, including when its tab is focused. The dot SHALL hide when no terminal contributes.

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

#### Scenario: Identical project ids on two servers

- **WHEN** two attached servers each hold a project with the same id and only one of them has an unviewed finished terminal
- **THEN** only that server's tab shows the dot

### Requirement: Project switcher rows show the activity dot

Each project row in the project switcher menu SHALL show the same activity dot as that project's tab, before the project name, with the same state, colour, breathing effect, and hiding behaviour, so projects that have overflowed out of the strip remain covered. A row's dot SHALL reflect only terminals of that row's own project on its own server. A project header in the compact switcher SHALL NOT show the activity dot; it presents the project's status summary.

#### Scenario: Overflowed project with activity

- **WHEN** a project has overflowed out of the tab strip and has two working terminals
- **THEN** its row in the project switcher menu shows one amber breathing dot before its name

#### Scenario: Same project id on two servers

- **WHEN** two attached servers each hold a project with the same id and one of them has a working terminal
- **THEN** only that project's row shows the dot

#### Scenario: Compact switcher header carries no dot

- **WHEN** the compact switcher lists a project that has a working terminal
- **THEN** that project's header shows its colour swatch and its status summary, and no activity dot

### Requirement: Overflow layout accounts for the activity dot

The tab bar overflow layout SHALL re-evaluate when any project's activity dot appears or disappears, so that tabs never spill past the trailing chrome and the switcher always accounts for the current tab widths.

#### Scenario: Dot appears on a strip that just fits

- **WHEN** the strip exactly fits and a dot appears on one tab
- **THEN** the overflow layout re-runs and the trailing chrome remains fully visible, with a tab overflowing into the switcher if required

### Requirement: Dropping a terminal tab on a project tab

A terminal tab SHALL be droppable on a visible project tab in the project bar, and that drop SHALL move the terminal into that project with the same outcome as choosing that project from the tab's **Move to project** context action: the terminal keeps its session identity, scrollback, title, colour, emoji, note, and recording state, the target project becomes the active project, and the moved terminal is the focused terminal there.

A project tab SHALL accept the drop only when it is a project the context action would offer for that terminal: a ready project owned by the same server as the terminal, other than the terminal's own project. The terminal's own project tab, a project owned by another server, a pending or failed project tab, an inert project tab, the Home control, and every other project bar control SHALL NOT accept the drop, and releasing a terminal tab over one of them SHALL leave the terminal where it was.

While a terminal tab is dragged over a project tab that accepts it, that project tab SHALL be visibly marked as the drop target, and the mark SHALL clear when the pointer leaves the tab or the drag ends. A project tab that does not accept the drop SHALL show no drop affordance. Dragging a terminal tab over the project bar SHALL NOT activate, reorder, or tear off any project tab.

Only a dragged terminal tab SHALL be moved this way. A dragged file tab, folder tab, or whole panel group SHALL NOT be accepted by a project tab. Dropping a terminal tab on a project tab SHALL NOT also pop the terminal out into its own window.

#### Scenario: Dropping a terminal on another project
- **WHEN** a user drags a terminal tab from the active project and releases it on another project's tab on the same server
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

#### Scenario: Another server's project
- **WHEN** a terminal tab is dragged over a project tab owned by a different attached server
- **THEN** that tab shows no drop affordance and releasing there moves nothing

#### Scenario: Pending or inert project tab
- **WHEN** a terminal tab is dragged over a project tab that is still being created, failed creation, or belongs to an unreachable server
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

### Requirement: Dismissible project error banner

A project's error banner SHALL carry a dismiss control, whatever operation
raised the notice it shows. Activating the control SHALL remove the banner from
that project. The control SHALL be operable by pointer and by keyboard and SHALL
have an accessible name. A dismissed notice SHALL stay dismissed until another
failure is reported for that project, at which point the banner SHALL show the
new notice.

#### Scenario: Dismissing a notice

- **WHEN** a project's error banner is showing and the user activates its dismiss control
- **THEN** the banner is removed from that project

#### Scenario: Any failure is dismissible

- **WHEN** the banner shows a notice raised by a Git, Explorer, Agents, Settings, terminal, or other project operation
- **THEN** the same dismiss control is present and removes it

#### Scenario: A later failure after dismissal

- **WHEN** the user has dismissed a notice and another operation in that project then fails
- **THEN** the banner shows the new notice

### Requirement: Tear-off is repeatable

Tearing a project tab off SHALL leave every window involved able to tear off again. A window's torn-off presentation of a dragged tab SHALL last no longer than the drag that caused it: when a project drag ends — by release as a reorder, a merge into another window, or a new window, or because the drag was abandoned — the source window SHALL show none of its tabs as torn off, and the next drag from that window SHALL begin as an in-strip drag. A project tab of any displayed width SHALL be able to start a native tear-off. A native tear-off the host refuses to start SHALL be recorded as a diagnostic and SHALL leave the drag as an in-strip reorder.

#### Scenario: Second tear-off from the same window
- **WHEN** a user tears one project off into a new window and then drags another project tab out of the source window's bar
- **THEN** the second project also opens in a new window

#### Scenario: Out, back in, and out again
- **WHEN** a user tears a project off into a new window, drags it back onto the source window's bar, and then drags it out of that bar again
- **THEN** the project opens in a new window again

#### Scenario: Reorder after a tear-off
- **WHEN** a user drags a tab along the strip in a window that has previously been the source of a tear-off
- **THEN** the dragged tab stays visible in the strip at its full width while it is dragged

#### Scenario: Narrow tab
- **WHEN** a user drags a project tab narrower than the smallest drag preview out of the bar
- **THEN** native tear-off begins with a drag preview of the smallest size

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

### Requirement: Keyboard terminal switcher chord

The keyboard terminal switcher SHALL open on a chord that the operating system leaves to the application. On Windows and Linux Desktop the chord SHALL be Ctrl+Tab to open or move forward and Ctrl+Shift+Tab to move back, and releasing Ctrl SHALL switch to the highlighted terminal. On macOS Desktop and in browser hosts the chord SHALL be Option+Tab (Alt+Tab) and Option+Shift+Tab, and releasing Option SHALL switch. The chord SHALL be claimed only with no other modifier, and it SHALL be claimed even while a terminal has focus, so the terminal never receives it. Escape SHALL close the switcher without switching. The switcher's heading SHALL name the chord and the key to release that the platform uses.

#### Scenario: Ctrl+Tab on Windows

- **WHEN** a user presses Ctrl+Tab in a Windows Desktop project window with a terminal focused
- **THEN** the terminal switcher opens with the next terminal highlighted and its heading reads Ctrl+Tab, release Ctrl to switch

#### Scenario: Release to switch

- **WHEN** the switcher is open on Windows or Linux and the user releases Ctrl
- **THEN** the highlighted terminal becomes active and the switcher closes

#### Scenario: Back with Shift

- **WHEN** the switcher is open on Windows or Linux and the user presses Ctrl+Shift+Tab
- **THEN** the highlight moves to the previous terminal

#### Scenario: macOS keeps Option+Tab

- **WHEN** a user presses Option+Tab on macOS
- **THEN** the switcher opens and its heading reads Alt+Tab, release Alt to switch, and Ctrl+Tab does not open it

#### Scenario: Other modifiers are left alone

- **WHEN** a user presses Ctrl+Alt+Tab on Windows or Linux
- **THEN** the switcher does not open and the chord is not claimed

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
