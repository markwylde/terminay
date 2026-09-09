## ADDED Requirements

### Requirement: New-project placement

The new-project `+` SHALL sit immediately after the last visible tab, or after the overflow switcher when the strip is filling the bar. Activity and Local SHALL stay trailing.

#### Scenario: Control placement with overflow
- **WHEN** the strip is filling the bar
- **THEN** `+` sits after the overflow switcher, with activity and Local trailing

### Requirement: Project split button

The project-bar split button's primary `+` SHALL create a project on the server immediately.

#### Scenario: Primary create
- **WHEN** a user activates the primary `+`
- **THEN** a project is created on the server immediately

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

## MODIFIED Requirements

### Requirement: Project composition

A project SHALL have an optional root folder on its server, a name, colour, icon, default shell-profile override, per-project navigation state, and a Dockview layout holding terminal, file, and folder panels. Projects and panels SHALL be movable between the projects and workspace views of that server, and a terminal title SHALL NEVER be an identity boundary.

#### Scenario: Project attributes
- **WHEN** a project exists in a workspace view
- **THEN** it carries an optional root folder on its server, name, colour, icon, shell-profile override, navigation state, and a Dockview layout of panels

#### Scenario: Title is not identity
- **WHEN** a terminal's title changes
- **THEN** no identity or authorization boundary changes

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

### Requirement: New project roots

New projects SHALL use the server's default root or verified account home and SHALL NEVER copy an active project's root. Target and root validation SHALL complete before the pending tab becomes a normal project tab.

#### Scenario: Root selection for a new project
- **WHEN** a project is created
- **THEN** it uses the server's default root or verified account home and does not inherit another project's root

#### Scenario: Validation ordering
- **WHEN** target and root validation is still running
- **THEN** the tab remains pending until validation completes

### Requirement: Project root selection sources

A project root SHALL be selectable directly or derivable from the active terminal's working directory.

#### Scenario: Deriving from terminal cwd
- **WHEN** a user sets the project root from the active terminal's working directory
- **THEN** that working directory becomes the project root

### Requirement: Panel creation, splitting, and movement

New terminals SHALL open in the active project of that presentation. Tabs SHALL be able to split the active layout horizontally or vertically, be reordered, be moved to another project, or be moved into another workspace view.

#### Scenario: Splitting a layout
- **WHEN** a user splits the active layout horizontally or vertically
- **THEN** the panel layout updates in the active project

#### Scenario: Moving a panel to another project
- **WHEN** a panel is moved to another project or workspace view on the same server
- **THEN** it moves without losing its identity

### Requirement: Canonical workspace state and presentation-local selection

Project identity, layout, panel membership, project-local sidebar layout, and logical workspace views SHALL be canonical server state. The ordered project list in a view and the ordered panels in a project SHALL be broadcast to every connected presentation. Which view is selected — the Home dashboard or a project — and which terminal or panel is active inside a selected project SHALL be local to that presentation, so a desktop window and a web client on the same server can show different selected views. Desktop windows and browser views SHALL also retain their own per-project sidebar visibility.

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

## REMOVED Requirements

### Requirement: Trailing chrome is never displaced

**Reason:** Its rule that opening the environment chooser must not grow or shift the tab bar has no subject: the environment chooser is removed with the project environment concept.

**Migration:** None. The surviving chrome rules are stated in "Trailing chrome stays visible".

### Requirement: Initial terminal for a project

**Reason:** It seeds a replacement terminal through a live project environment and exempts remote SSH and Puzed roots from the missing-folder rule, and every project's root is a folder on its own server.

**Migration:** None. Terminal seeding is kept as "Initial terminal in every project".

### Requirement: New-project and environment-chooser placement

**Reason:** The environment chooser is removed with the project environment concept, so only the new-project `+` needs placement rules.

**Migration:** None. The surviving placement rules are stated in "New-project placement".

### Requirement: Project split button and environment chooser

**Reason:** The environment chooser is removed with the project environment concept; a project is always created on the server that owns the workspace.

**Migration:** None. The surviving creation behaviour is stated in "Project split button".

### Requirement: Project editing shows immutable environment

**Reason:** A project has no environment identity to display, and its root is a folder on its server's filesystem.

**Migration:** None. Root selection during editing is covered by "Project root selection sources".

### Requirement: Environment boundaries on moves

**Reason:** Every project of one server executes on that server, so a panel move between two of its projects crosses no machine boundary and needs no rejection rule.

**Migration:** None. Panel movement between projects and workspace views is covered by "Panel creation, splitting, and movement".

### Requirement: Mixed environments in one view

**Reason:** A workspace view holds projects of one server, all of which execute on that server, so there are no mixed environments to describe.

**Migration:** None.
