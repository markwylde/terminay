# workspace-and-project-tabs Specification

## Purpose

Define how Terminay organises work as project tabs — creation, editing, ordering, overflow chrome, panel layout, cross-view and cross-window movement, and close protection — over server-owned workspace state and immutable project environments.

## Requirements

### Requirement: Project composition

A project SHALL have one immutable project environment, an optional root folder interpreted by that environment, a name, colour, icon, default shell-profile override, per-project navigation state, and a Dockview layout holding terminal, file, and folder panels. Projects and panels SHALL be movable where environment boundaries permit, and a terminal title SHALL NEVER be an identity boundary.

#### Scenario: Project attributes
- **WHEN** a project exists in a workspace view
- **THEN** it carries one immutable environment, an optional environment-interpreted root, name, colour, icon, shell-profile override, navigation state, and a Dockview layout of panels

#### Scenario: Title is not identity
- **WHEN** a terminal's title changes
- **THEN** no identity or authorization boundary changes

### Requirement: Documentation presentation within a file panel

Markdown and MDX files SHALL be able to use the rich Documentation presentation within a canonical file panel, and changing presentation SHALL NOT change panel or file identity.

#### Scenario: Switching presentation
- **WHEN** a canonical file panel switches to or from the Documentation presentation
- **THEN** the panel and file identity are unchanged

### Requirement: Project tab management

Users SHALL be able to create, rename, reorder, close, and colour or icon project tabs.

#### Scenario: Editing tab appearance
- **WHEN** a user renames a project or changes its colour or icon
- **THEN** the change is applied to the server-owned project

### Requirement: Joined chrome band

The active project tab's colour SHALL continue into the panel tab strip and the sidebar group tab bar so that chrome reads as one band. Sidebar pane titles SHALL use the dark project-bar surface with white labels, and pane bodies SHALL share the terminal background. Sidebar pane titles SHALL stay quiet on hover; only title actions such as refresh, explorer file rows, and the 4px resize rail SHALL highlight. The sidebar toggle SHALL be an icon on the dark project bar that highlights slightly on hover. The new-project `+` and environment-chooser arrow SHALL be separate icon buttons with the same even pacing as the panel-strip add controls rather than a joined chip. Panel tabs on that strip SHALL use a 4px corner, the active panel tab SHALL be the solid chip, and inactive tabs SHALL stay quiet until hover.

#### Scenario: Active project colour
- **WHEN** a project tab is active
- **THEN** its colour continues into the panel tab strip and the sidebar group tab bar as one band

#### Scenario: Hovering sidebar chrome
- **WHEN** a user hovers a sidebar pane title
- **THEN** the title stays quiet while title actions, explorer file rows, and the 4px resize rail highlight

#### Scenario: Panel tab states
- **WHEN** panel tabs are shown
- **THEN** the active tab is a solid 4px-cornered chip and inactive tabs stay quiet until hover

### Requirement: Trailing chrome is never displaced

The project tab bar SHALL NEVER steal trailing chrome. The sidebar toggle, new-project control, activity, and the Local connection pill SHALL stay fully visible. Opening the environment chooser SHALL NOT grow or shift the tab bar.

#### Scenario: Crowded tab bar
- **WHEN** many project tabs are open
- **THEN** the sidebar toggle, new-project control, activity, and the Local connection pill remain fully visible

#### Scenario: Opening the environment chooser
- **WHEN** the environment chooser opens
- **THEN** the tab bar neither grows nor shifts

### Requirement: Project overflow switcher

When project tabs no longer fit, overflowed tabs SHALL leave the strip and remain reachable from a Local-matching project switcher presenting a colour swatch, label, numeric badge, and chevron opening a shared menu of every project in the view.

#### Scenario: Tabs overflow
- **WHEN** the strip cannot fit every project tab
- **THEN** overflowed tabs leave the strip and remain reachable from the switcher's shared menu of every project in the view

### Requirement: Compact bar presentation

On a compact bar at phone width or 640px and below, the strip SHALL collapse to the switcher showing the active project name, with the count badge and chevron trailing at the right of the pill. Its All projects menu SHALL span the window so names stay readable, with compact rows matching the rest of the chrome, and New project SHALL live in that menu instead of as header `+` chrome.

#### Scenario: Phone-width chrome
- **WHEN** the project bar is at 640px or narrower
- **THEN** the strip collapses to a switcher showing the active project name with the count badge and chevron on the trailing edge of the pill

#### Scenario: Compact All projects menu
- **WHEN** the compact switcher menu opens
- **THEN** it spans the window with compact rows and offers New project instead of header `+` chrome

### Requirement: Wide overflowing bar presentation

On a wider bar the overflowing strip SHALL fill the space before `+` and Local, the switcher SHALL stay pinned to that right edge, and at least one extra tab SHALL continue behind it with the pill covering about half of that last tab, rather than leaving a hole or looking like a last tab-like button. The wide-bar switcher menu SHALL stay an anchored dropdown, and the active tab SHALL stay among the real tabs. When every tab fits, `+` SHALL still sit immediately after the last tab and Local SHALL stay trailing.

#### Scenario: Wide bar overflowing
- **WHEN** a wide project bar overflows
- **THEN** the strip fills through to `+` and Local, the switcher stays on the right edge, at least one extra tab continues behind the pill covering about half of it, and the active project remains a real tab

#### Scenario: Every tab fits
- **WHEN** all project tabs fit the bar
- **THEN** `+` sits immediately after the last tab and Local stays trailing

### Requirement: Reordering projects

The strip SHALL be click-and-drag to reorder for visible tabs only. The shared menu SHALL list every project, SHALL be able to activate or close one, and SHALL reorder via its grips so portrait web clients are not limited to a drag-to-reorder strip they cannot scroll. Dragging along the visible strip SHALL reorder there; native tear-off SHALL start only after the pointer leaves the bar. A dropped visible-tab or switcher-row order SHALL commit through `project.move` in the current view so a later snapshot cannot snap the tab back. Menu grips SHALL track the pointer rather than being HTML5 drag sources so they work inside the desktop title-bar drag region, and the menu SHALL stay open through the drop.

#### Scenario: Dragging a visible tab
- **WHEN** a user drags a visible project tab along the strip
- **THEN** the strip reorders and the new order commits through `project.move` in the current view

#### Scenario: Pointer leaves the bar
- **WHEN** a drag continues past the edge of the project bar
- **THEN** native tear-off begins

#### Scenario: Reordering from the menu
- **WHEN** a user drags a grip in the shared project menu
- **THEN** the grip tracks the pointer, the menu stays open through the drop, and the order commits through `project.move`

### Requirement: New-project and environment-chooser placement

The new-project `+` and environment chooser SHALL sit immediately after the last visible tab, or after the overflow switcher when the strip is filling the bar. Activity and Local SHALL stay trailing.

#### Scenario: Control placement with overflow
- **WHEN** the strip is filling the bar
- **THEN** `+` and the environment chooser sit after the overflow switcher, with activity and Local trailing

### Requirement: Focus after creation

A user-created project or terminal SHALL receive keyboard focus in that xterm so typing starts immediately. Creation chrome such as the project and terminal `+` controls SHALL NOT keep focus after the new session is ready.

#### Scenario: Creating a terminal
- **WHEN** a user creates a project or terminal and its session becomes ready
- **THEN** keyboard focus moves into that xterm and does not remain on the `+` control

### Requirement: Pending project tab during creation

Creating a project SHALL immediately add a non-active pending tab with the future project label and a spinning project icon. Validation, canonical project creation, terminal launch, and terminal hydration SHALL happen behind that tab without covering or replacing the active project, which SHALL remain usable. When the terminal is ready, Terminay SHALL activate and focus the new project only if the user has not selected another project since creation began; if the user has moved elsewhere, the ready project SHALL remain in the background. A creation failure SHALL activate the pending tab and present its error there.

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

### Requirement: Project split button and environment chooser

The project-bar split button's primary `+` SHALL create a project on **This server** immediately. Its arrow SHALL open an accessible environment chooser offering This server, recent SSH and Puzed targets, provider create and browse actions, and **Project Environments…**, which SHALL open or focus its first-class management window or route. **This server** SHALL identify the selected Terminay Server because it may be remote from the client.

#### Scenario: Primary create
- **WHEN** a user activates the primary `+`
- **THEN** a project is created on This server immediately

#### Scenario: Environment chooser contents
- **WHEN** a user opens the split button arrow
- **THEN** an accessible chooser lists This server, recent SSH and Puzed targets, provider create/browse actions, and Project Environments…

### Requirement: New project roots

New projects SHALL use the selected environment profile's default root or verified account home and SHALL NEVER copy an active project root from another environment. Target and root validation SHALL complete before the pending tab becomes a normal project tab.

#### Scenario: Root selection for a new project
- **WHEN** a project is created on a selected environment
- **THEN** it uses that environment's default root or verified account home and does not inherit another environment's root

#### Scenario: Validation ordering
- **WHEN** target and root validation is still running
- **THEN** the tab remains pending until validation completes

### Requirement: Initial terminal for a project

A successful user-created project SHALL receive one terminal through the selected server's normal terminal-launch resolver as an explicit creation flow, never a renderer repair for an empty workspace. After a Local Desktop restart, each restored project SHALL likewise receive one fresh terminal so a project is never shown empty. Remote SSH and Puzed roots SHALL NOT be treated as missing local folders; their replacement PTY SHALL be seeded through the live environment. The project tab SHALL show a spinner while that connection or a user-created project is still loading. Explorer SHALL NOT open SFTP until that replacement terminal exists.

#### Scenario: Restart restores projects
- **WHEN** Local Desktop restarts with saved projects
- **THEN** each restored project receives one fresh terminal seeded through its live environment

#### Scenario: Remote root after restart
- **WHEN** a restored project has a remote SSH or Puzed root
- **THEN** the root is not treated as a missing local folder and Explorer does not open SFTP until the replacement terminal exists

#### Scenario: Loading indication
- **WHEN** a project's connection or creation is still loading
- **THEN** its tab shows a spinner

### Requirement: Atomic colour and icon commit

Project creation SHALL commit its initial colour and icon atomically with the server-owned project so rapid creation cannot reuse an uncommitted colour.

#### Scenario: Rapid successive creation
- **WHEN** several projects are created in quick succession
- **THEN** each commits its own colour and icon atomically and no colour is reused from an uncommitted project

### Requirement: Project root selection sources

A project root SHALL be selectable directly or derivable from the active terminal's working directory, including terminals on SSH and Puzed environments.

#### Scenario: Deriving from terminal cwd
- **WHEN** a user sets the project root from the active terminal's working directory on any environment
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

New terminals SHALL open in the active project of that presentation. Tabs SHALL be able to split the active layout horizontally or vertically, be reordered, be moved to another project, or be moved into another workspace view.

#### Scenario: Splitting a layout
- **WHEN** a user splits the active layout horizontally or vertically
- **THEN** the panel layout updates in the active project

#### Scenario: Moving a panel to another project
- **WHEN** a panel is moved to another project or workspace view within environment boundaries
- **THEN** it moves without losing its identity

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

### Requirement: Project editing shows immutable environment

Project editing SHALL show the immutable environment identity and status and SHALL let the user select a canonical root inside it or restore the environment default. Retargeting a project to another environment SHALL NOT be an edit operation.

#### Scenario: Editing a project
- **WHEN** a user opens project editing
- **THEN** the environment identity and status are shown as immutable and only a root inside that environment can be selected or reset to the environment default

### Requirement: Environment boundaries on moves

Moving a whole project between views SHALL preserve its environment. Moving a panel between unequal environments SHALL be rejected atomically and a terminal SHALL NOT be recreated on another machine. Same-environment moves SHALL remain unavailable until every dependent identity can be rebound atomically.

#### Scenario: Cross-environment panel move
- **WHEN** a user drags a panel into a project on a different environment
- **THEN** the move is rejected atomically and no terminal is recreated elsewhere

#### Scenario: Moving a whole project
- **WHEN** a project moves between workspace views
- **THEN** its environment binding is preserved

### Requirement: Workspace views as native windows

Desktop SHALL present workspace views as native windows. Project tabs SHALL be draggable between them, while web clients manage the same views in-page. Moving a project SHALL preserve its panels, live PTYs, scrollback, and service identities.

#### Scenario: Dragging a project between windows
- **WHEN** a project tab is dragged into another native window
- **THEN** its panels, live PTYs, scrollback, and service identities are preserved

### Requirement: Torn-off window activation

A newly torn-off native window SHALL become the active window once its workspace is ready, and the first interaction with its terminal controls SHALL be delivered to that control rather than being consumed only to activate the window.

#### Scenario: First click in a new window
- **WHEN** a user clicks a terminal control in a newly torn-off window
- **THEN** the click reaches that control instead of only activating the window

### Requirement: One workspace view per project-host window

Each native project-host window SHALL present exactly one server-owned workspace view. Tearing a project into a new native window SHALL create a destination view and canonically move the existing project into it; it SHALL NOT copy the project into renderer state and SHALL NOT close the source project.

#### Scenario: Tearing off a project
- **WHEN** a project is torn into a new native window
- **THEN** a destination view is created, the project moves canonically into it, and it is neither copied into renderer state nor closed in the source

#### Scenario: After a tear-off
- **WHEN** the workspace later refreshes
- **THEN** the source window shows the source view's remaining projects and the destination shows only the destination view's projects

### Requirement: Window closing and application shutdown

Closing a native project-host window SHALL close only that window and detach its workspace-view presentation while another project-host window remains. Application shutdown SHALL begin only when the final project-host window closes or the user explicitly invokes Quit.

#### Scenario: Closing one of several windows
- **WHEN** a project-host window closes while others remain
- **THEN** only that window closes and its workspace-view presentation detaches

#### Scenario: Closing the last window
- **WHEN** the final project-host window closes or Quit is invoked
- **THEN** application shutdown begins

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

Project identity, immutable environment binding, layout, panel membership, project-local sidebar layout, and logical workspace views SHALL be canonical server state. The ordered project list in a view and the ordered panels in a project SHALL be broadcast to every connected presentation. Which project tab is active, and which terminal or panel is active inside that project, SHALL be local to that presentation, so a desktop window and a web client on the same server can show different active tabs. Desktop windows and browser views SHALL also retain their own per-project sidebar visibility.

#### Scenario: Two presentations of one server
- **WHEN** a desktop window and a web client connect to the same server
- **THEN** they keep independent active project tabs, active terminals, and per-project sidebar visibility while sharing the ordered project and panel lists

#### Scenario: Structural change broadcast
- **WHEN** a project is created, reordered, or closed
- **THEN** the change appears in every connected client's list without changing another client's active selection

#### Scenario: Locally selected item disappears
- **WHEN** a locally selected project or panel is removed
- **THEN** that presentation falls back locally

### Requirement: Authorization derives from server identities

A project SHALL be a navigation and authorization boundary, while the immutable server terminal session id SHALL remain the identity used by services. Remote and MCP scopes SHALL derive from authenticated server, project, and session identities and SHALL NEVER derive from tab labels or client focus.

#### Scenario: Scoping a remote or MCP request
- **WHEN** a remote or MCP operation is authorized
- **THEN** its scope comes from authenticated server, project, and session identities rather than tab labels or client focus

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

### Requirement: Mixed environments in one view

One workspace view SHALL be able to contain This server, SSH, and Puzed projects without clients connecting directly to the target machines.

#### Scenario: Mixed-environment view
- **WHEN** a view contains This server, SSH, and Puzed projects
- **THEN** all render normally and no client connects directly to a target machine

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
