## ADDED Requirements

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

## MODIFIED Requirements

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

### Requirement: Project tab management

Users SHALL be able to create, rename, reorder, close, and colour or icon project tabs. Renaming, closing, and colour or icon changes SHALL be applied on the server that owns the tab's project and SHALL NOT reach any other attached server.

#### Scenario: Editing tab appearance
- **WHEN** a user renames a project or changes its colour or icon
- **THEN** the change is applied to the server-owned project

#### Scenario: Editing a tab of an attached server
- **WHEN** a user renames or closes a tab whose project belongs to an attached server
- **THEN** the command is sent only to that server and no other attached server's projects change

### Requirement: Project overflow switcher

When project tabs no longer fit, overflowed tabs SHALL leave the strip and remain reachable from a project switcher presenting a colour swatch, label, numeric badge, and chevron opening a shared menu of every project of every attached connection. When more than one connection is attached, each row SHALL name the server that owns its project.

#### Scenario: Tabs overflow
- **WHEN** the strip cannot fit every project tab
- **THEN** overflowed tabs leave the strip and remain reachable from the switcher's shared menu of every project of every attached connection

#### Scenario: Rows name their server
- **WHEN** more than one connection is attached and the switcher menu opens
- **THEN** each project row names the server that owns that project

### Requirement: Project switcher rows show the activity count badge

Each project row in the project switcher menu SHALL show the same activity count badge as that project's tab, with the same count, colour, and zero-hiding behaviour, so projects that have overflowed out of the strip or are hidden behind the compact switcher remain covered. A row's badge SHALL count only terminals of that row's own project on its own server.

#### Scenario: Overflowed project with activity

- **WHEN** a project has overflowed out of the tab strip and has two working terminals
- **THEN** its row in the project switcher menu shows an amber badge reading `2`

#### Scenario: Same project id on two servers

- **WHEN** two attached servers each hold a project with the same id and one of them has a working terminal
- **THEN** only that project's row shows the badge

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

### Requirement: Project tab activity count badge

Each project tab SHALL present a single activity count badge after the tab title and before the close control. The badge SHALL show the number of that project's terminals that currently have a visible activity indicator, using the same per-terminal items that feed the header activity dropdown, so the **Show indicator for active tabs** and **Show indicator for finished tabs** settings govern it without a separate setting. The badge SHALL count only terminals of that tab's own project on its own server, aggregating no other attached server's terminals. The badge SHALL be coloured by the highest-priority state present in the project: red when any terminal needs attention, otherwise amber when any terminal is working, otherwise green when any terminal has finished unviewed activity. The badge SHALL be hidden when the project's count is zero, SHALL appear on the active project tab as well as background tabs, and SHALL NOT be a separate control; pressing it activates the project like the rest of the tab. The badge SHALL use its own element class, distinct from the header activity dropdown badges, so each surface can be located independently.

#### Scenario: One finished terminal in a background project

- **WHEN** a background project has exactly one terminal with a finished unviewed indicator and no other indicators
- **THEN** its tab shows a green badge reading `1` between the title and the close control

#### Scenario: Mixed states resolve to the highest priority

- **WHEN** a project has one terminal needing attention, one working terminal, and one finished unviewed terminal
- **THEN** its tab shows a red badge reading `3`

#### Scenario: Active project counts too

- **WHEN** the active project has a terminal whose structured completion produced a finished indicator
- **THEN** the active project tab shows a green badge including that terminal

#### Scenario: Badge hidden at zero

- **WHEN** every terminal in a project has been viewed and none is working or needs attention
- **THEN** the project tab shows no badge

#### Scenario: Pressing the badge

- **WHEN** a user presses the badge on a background project tab
- **THEN** that project becomes active and no other action occurs

#### Scenario: Activity on another attached server

- **WHEN** a project on one attached server has a working terminal
- **THEN** only that project's tab shows a badge and tabs of every other server are unaffected

### Requirement: Project activity count follows viewed terminals

The project-tab activity count SHALL count the same terminals that currently show a visible activity indicator, resolved by the pair of the tab's server and its project. Clicking a terminal tab, clicking into the terminal, or typing, or already interacting with it when finished or attention activity arrives, SHALL remove that terminal from the count. Activating the project SHALL NOT remove a terminal from the count. A working terminal SHALL remain in the count while it is working, including when its tab is focused. The count SHALL hide when it reaches zero.

#### Scenario: Activating the project keeps the count

- **WHEN** a project shows a green activity count of one because a single terminal has finished unviewed activity, and the user activates that project without clicking the terminal
- **THEN** the project-tab activity count remains `1` and green

#### Scenario: Focusing the last finished terminal

- **WHEN** a project shows a green activity count of one because a single terminal has finished unviewed activity, and the user clicks that terminal tab
- **THEN** the project-tab activity count hides

#### Scenario: Completion on the focused terminal

- **WHEN** the only activity in a project is structured or agent completion on the terminal the user is already viewing
- **THEN** the project-tab activity count stays hidden

#### Scenario: Working on the focused terminal

- **WHEN** the focused terminal in a project is working and no other terminal in that project has an indicator
- **THEN** the project tab keeps an amber activity count of one

#### Scenario: Identical project ids on two servers

- **WHEN** two attached servers each hold a project with the same id and only one of them has an unviewed finished terminal
- **THEN** only that server's tab shows the count

### Requirement: Pending project tab during creation

Creating a project SHALL immediately add a non-active pending tab with the future project label and a spinning project icon, bound to the server chosen to own it and showing that server when more than one connection is attached. Validation, canonical project creation, terminal launch, and terminal hydration SHALL happen behind that tab without covering or replacing the active project, which SHALL remain usable. When the terminal is ready, Terminay SHALL activate and focus the new project only if the user has not selected another project since creation began; if the user has moved elsewhere, the ready project SHALL remain in the background. A creation failure SHALL activate the pending tab and present its error there.

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

## REMOVED Requirements

### Requirement: One workspace view per project-host window

**Reason:** A window presents one workspace view on each of its connections, so a
window-wide count of exactly one workspace view is the wrong rule.

**Migration:** None. The rule is kept, per connection, as "One workspace view per
attached server per window".
