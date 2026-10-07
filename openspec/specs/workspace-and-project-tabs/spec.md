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

The active project tab's colour SHALL continue into the panel tab strip and the sidebar group tab bar so that chrome reads as one band. Sidebar pane titles SHALL use the dark project-bar surface with white labels, and pane bodies SHALL share the terminal background. Sidebar pane titles SHALL stay quiet on hover; only title actions such as refresh, explorer file rows, and the 4px resize rail SHALL highlight. The sidebar toggle SHALL be an icon on the dark project bar that highlights slightly on hover. The new-project `+` SHALL be an icon button with the same even pacing as the panel-strip add controls rather than a joined chip. Panel tabs on that strip SHALL use a 4px corner, the active panel tab SHALL be the solid chip, and inactive tabs SHALL stay quiet until hover.

#### Scenario: Active project colour
- **WHEN** a project tab is active
- **THEN** its colour continues into the panel tab strip and the sidebar group tab bar as one band

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
- **THEN** it spans the window with compact rows listing every project of every attached connection, and offers New project instead of header `+` chrome

#### Scenario: A pending update stays visible
- **WHEN** an application update is pending on a compact bar
- **THEN** its control stays on the row, between the breadcrumb and the connection control

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

A user-created project or terminal SHALL receive keyboard focus in that xterm so typing starts immediately. Creation chrome such as the project and terminal `+` controls SHALL NOT keep focus after the new session is ready.

#### Scenario: Creating a terminal
- **WHEN** a user creates a project or terminal and its session becomes ready
- **THEN** keyboard focus moves into that xterm and does not remain on the `+` control

### Requirement: Pending project tab during creation

Creating a project SHALL immediately add a non-active pending tab with the future project label and a spinning project icon, bound to the server chosen to own it and showing that server when more than one connection is attached. Validation, canonical project creation, terminal launch, and terminal hydration SHALL happen behind that tab without covering or replacing the active project, which SHALL remain usable. When the terminal is ready, Terminay SHALL activate and focus the new project only if the user has not selected another project since creation began; if the user has moved elsewhere, the ready project SHALL remain in the background. A creation failure SHALL activate the pending tab and present its error there.

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

#### Scenario: Pending tab names its server
- **WHEN** a project is created on an attached server while more than one connection is attached
- **THEN** the pending tab shows that server

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

### Requirement: New project roots

New projects SHALL use the owning server's default root or verified account home and SHALL NEVER copy an active project's root. A root chosen for a new project SHALL be browsed and validated on the server that will own it. Target and root validation SHALL complete before the pending tab becomes a normal project tab.

#### Scenario: Root selection for a new project
- **WHEN** a project is created
- **THEN** it uses the server's default root or verified account home and does not inherit another project's root

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

A project root SHALL be selectable directly or derivable from the active terminal's working directory.

#### Scenario: Deriving from terminal cwd
- **WHEN** a user sets the project root from the active terminal's working directory
- **THEN** that working directory becomes the project root

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

#### Scenario: Dragging a project between windows
- **WHEN** a project tab is dragged into another native window
- **THEN** its panels, live PTYs, scrollback, and service identities are preserved

#### Scenario: Destination window has not attached that server
- **WHEN** a project tab is dragged into a native window that has not attached its server
- **THEN** the destination window attaches that server and the project moves within its own server's views

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

A successful user-created project SHALL receive one terminal through the server's normal terminal-launch resolver as an explicit creation flow, never a renderer repair for an empty workspace. After a Local Desktop restart, each restored project SHALL likewise receive one fresh terminal so a project is never shown empty. The project tab SHALL show a spinner while a user-created project is still loading.

#### Scenario: Restart restores projects
- **WHEN** Local Desktop restarts with saved projects
- **THEN** each restored project receives one fresh terminal

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

### Requirement: Compact breadcrumb disclosure placement

The compact breadcrumb's disclosure chevron SHALL sit on the trailing edge of
the pill, after every label segment and after any free space the pill holds, so
it reads as the control's dropdown affordance rather than as another crumb
after the terminal title. The chevron SHALL keep its position as titles change
length, and the label segments SHALL absorb the remaining width, truncating the
project name before the terminal title as they already do.

#### Scenario: Chevron on the trailing edge

- **WHEN** a compact workspace draws the project-and-terminal breadcrumb
- **THEN** the chevron sits against the pill's trailing edge with the label
  segments taking the space before it

#### Scenario: Short titles leave the chevron where it is

- **WHEN** the active terminal's title is short enough that the breadcrumb has
  free space
- **THEN** the free space falls between the terminal title and the chevron, and
  the chevron stays on the trailing edge

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

A terminal created from the compact switcher SHALL become the active terminal of its project: it SHALL be the terminal shown on screen, it SHALL receive terminal focus, and the switcher SHALL mark it as current the next time it opens. This SHALL hold for **New terminal**, which creates in the project in front, and for a project group's new-terminal control, which SHALL select that group's project on its own server first when it is not the project in front. The switcher SHALL dismiss when either create action is pressed. The terminal on screen and the switcher's current row SHALL never name different terminals after a create.

#### Scenario: New terminal in the project in front
- **WHEN** a user opens the compact switcher and presses New terminal
- **THEN** the switcher dismisses, a terminal is created in the project in front, and that terminal replaces the previous one on screen and takes terminal focus

#### Scenario: New terminal in a background project
- **WHEN** a user presses the new-terminal control of a project group that is not the project in front
- **THEN** that project becomes active on its own server and the created terminal is the terminal shown on screen

#### Scenario: Switcher agrees with the screen
- **WHEN** a user reopens the compact switcher after creating a terminal from it
- **THEN** the row marked current is the created terminal, which is also the terminal on screen

### Requirement: Unified compact switcher

A compact workspace SHALL provide one switcher that presents every terminal of every project of every attached connection, grouped by connection and then by project. Each project group SHALL name its project with that project's colour and SHALL offer a new terminal for that project. Each terminal row SHALL name its terminal and SHALL activate that terminal on its own server when pressed, selecting that terminal's project first when it is not the active one. A connection heading SHALL appear for every attached connection, including when only one is attached, so a row's owning server is never ambiguous. The switcher SHALL offer New terminal for the project in front, New project, and Add connection alongside the per-group new terminal, so every create action absorbed from the collapsed chrome remains reachable. New terminal SHALL be absent when no project is in front rather than acting on an arbitrary one. The switcher SHALL open from the breadcrumb and from the connection control, presenting the same content from both.

#### Scenario: Grouped by connection and project
- **WHEN** the switcher opens with two attached connections holding projects with terminals
- **THEN** rows appear under a heading for each connection and a group for each project of that connection

#### Scenario: Activating a terminal in a background project
- **WHEN** a user presses a terminal row belonging to a project that is not active
- **THEN** that project becomes active on its own server and that terminal becomes the active terminal

#### Scenario: Connection control opens the same switcher
- **WHEN** a user presses the connection control on a compact workspace
- **THEN** the unified switcher opens with the same grouped content the breadcrumb opens

#### Scenario: Create actions survive the collapse
- **WHEN** the switcher is open with a project in front
- **THEN** it offers a new terminal for each project group, New terminal, New project, and Add connection

#### Scenario: No project in front
- **WHEN** the switcher is open while the dashboard is selected
- **THEN** New terminal is absent and the other create actions remain

#### Scenario: Single connection still names its server
- **WHEN** exactly one connection is attached
- **THEN** its heading still appears above its project groups

### Requirement: Compact project editing survives the collapse

A project group heading in the switcher SHALL open that project's editor on a
long press, the same gesture a project switcher row carries, so editing a
project stays reachable at a width where no project tab is rendered. A short
press on a heading SHALL do nothing, leaving activation to the terminal rows
beneath it.

#### Scenario: Long-pressing a project heading
- **WHEN** a user long-presses a project group heading in the switcher
- **THEN** that project's editor opens

#### Scenario: A short press on a heading is inert
- **WHEN** a user taps a project group heading without holding
- **THEN** nothing is activated and the switcher stays open

### Requirement: Compact switcher filtering

The switcher SHALL offer a text filter that matches terminal titles, project names, and connection names. The filter SHALL start collapsed as a search control and SHALL expand into a field only when a user asks for it; nothing in the switcher SHALL take focus when it opens, so reaching a project or terminal never raises a software keyboard. Collapsing the filter SHALL clear it and restore the full grouped list. A filter SHALL keep a group whose project or connection name matches, keep a terminal row whose title matches, and SHALL hide groups left with no rows. Clearing the filter SHALL restore the full grouped list. The filter SHALL NOT change which terminal is active.

#### Scenario: The switcher opens without taking focus
- **WHEN** the switcher opens
- **THEN** the filter is a collapsed search control, no field holds focus, and no software keyboard is raised

#### Scenario: Collapsing the filter restores the list
- **WHEN** a user collapses an expanded filter that was narrowing the list
- **THEN** the filter clears and every group returns

#### Scenario: Filtering by terminal title
- **WHEN** a user types text matching one terminal's title
- **THEN** only that terminal's row and its enclosing project and connection headings remain

#### Scenario: Filtering by project name
- **WHEN** a user types text matching a project name
- **THEN** that project's group and all of its terminal rows remain

#### Scenario: Filter matches nothing
- **WHEN** the filter matches no terminal, project, or connection
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

The compact switcher SHALL list every terminal, file, and folder panel of every project of every attached connection, grouped by connection and then by project. Each panel row SHALL name that panel and SHALL activate it on its own server when pressed, selecting that panel's project first when it is not the active one. A terminal row SHALL present that terminal's activity state and, where the window holds its live buffer, its most recent non-empty output line. A long press on a panel row SHALL open that panel's editor.

#### Scenario: File and folder panels appear as rows
- **WHEN** a project holds a terminal, a file panel, and a folder panel
- **THEN** the switcher lists a row for each under that project

#### Scenario: Activating a file in a background project
- **WHEN** a user presses a file row belonging to a project that is not active
- **THEN** that project becomes active on its own server and that file panel becomes the active panel

### Requirement: Compact switcher closing

Each panel row in the compact switcher SHALL carry a close control that closes that panel through the same path and close-protection as a panel tab. Each project group heading SHALL carry a close control that closes that project through the same path and close-protection as a project tab. Closing a panel or a project SHALL leave the switcher open. Closing the last panel in a project SHALL close the project. Close protection SHALL still ask whether to **Close Terminal** or **Keep Running** when that terminal's PTY has a non-shell foreground process, and SHALL still ask whether to **Close Project** or **Keep Running** when a project has such a terminal.

#### Scenario: Closing a terminal from the switcher
- **WHEN** a user presses the close control on a terminal row
- **THEN** that terminal closes and the switcher stays open

#### Scenario: Closing a file from the switcher
- **WHEN** a user presses the close control on a file row
- **THEN** that file panel closes and the switcher stays open

#### Scenario: Closing a busy terminal from the switcher
- **WHEN** a user presses the close control on a terminal whose PTY has a non-shell foreground process
- **THEN** Terminay asks whether to Close Terminal or Keep Running before terminating it

#### Scenario: Closing a project from the switcher
- **WHEN** a user presses the close control on a project group heading whose terminals are all at their shell prompts
- **THEN** that project closes and the switcher stays open

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

Each project row in the project switcher menu and in the compact switcher SHALL show the same activity dot as that project's tab, before the project name, with the same state, colour, breathing effect, and hiding behaviour, so projects that have overflowed out of the strip or are hidden behind the compact switcher remain covered. A row's dot SHALL reflect only terminals of that row's own project on its own server.

#### Scenario: Overflowed project with activity

- **WHEN** a project has overflowed out of the tab strip and has two working terminals
- **THEN** its row in the project switcher menu shows one amber breathing dot before its name

#### Scenario: Same project id on two servers

- **WHEN** two attached servers each hold a project with the same id and one of them has a working terminal
- **THEN** only that project's row shows the dot

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
