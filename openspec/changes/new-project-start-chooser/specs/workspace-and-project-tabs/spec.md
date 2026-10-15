## MODIFIED Requirements

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

### Requirement: Project root selection sources

A project root SHALL be selectable from the server-side folder browser, from the owning server's recent project folders, or by deriving it from the active terminal's working directory. Selecting a root for a project with no root folder SHALL give it that root, and the project SHALL leave no-root mode.

#### Scenario: Deriving from terminal cwd
- **WHEN** a user sets the project root from the active terminal's working directory
- **THEN** that working directory becomes the project root

#### Scenario: A no-root project gains a root
- **WHEN** a user sets a root for a project that has no root folder
- **THEN** the project takes that root, and its Explorer, Git, and Documentation panes present it

### Requirement: Initial terminal in every project

A started user-created project SHALL receive one terminal through the server's normal terminal-launch resolver as an explicit creation flow, never a renderer repair for an empty workspace. A project awaiting a start choice SHALL have no terminal, and its first terminal SHALL be launched by its start choice. After a Local Desktop restart, each restored started project SHALL receive one fresh terminal so a started project is never shown empty, and each restored project awaiting a start choice SHALL show its chooser and receive no terminal. The project tab SHALL show a spinner while a user-created project is still loading.

#### Scenario: Restart restores projects
- **WHEN** Local Desktop restarts with saved started projects
- **THEN** each restored started project receives one fresh terminal

#### Scenario: Restart restores a project awaiting a choice
- **WHEN** Local Desktop restarts with a saved project that awaits a start choice
- **THEN** the project shows its start chooser and no terminal is launched for it

#### Scenario: Loading indication
- **WHEN** a project's creation is still loading
- **THEN** its tab shows a spinner
