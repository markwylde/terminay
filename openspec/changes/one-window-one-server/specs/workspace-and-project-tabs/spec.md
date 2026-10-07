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

A newly torn-off native window SHALL become the active window once its workspace is ready, and the first interaction with its terminal controls SHALL be delivered to that control rather than being consumed only to activate the window. A torn-off window SHALL show the same server as the window it was torn from.

#### Scenario: First click in a new window
- **WHEN** a user clicks a terminal control in a newly torn-off window
- **THEN** the click reaches that control instead of only activating the window

#### Scenario: Server of a torn-off window
- **WHEN** a project is torn out of a window showing a remote server
- **THEN** the new window shows that same server

### Requirement: Workspace views are native windows on one server

Desktop SHALL present workspace views as native windows. Project tabs SHALL be draggable between native windows that show the same server, while web clients manage the same views in-page. A native window showing a different server SHALL NOT be a drop target. Moving a project SHALL preserve its panels, live PTYs, scrollback, and service identities.

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

## REMOVED Requirements

### Requirement: One workspace view per attached server per window

**Reason**: A window shows one server, so there is no attached server to hold a second view.

**Migration**: "One workspace view per window" keeps the tear-off contract for the window's one server.

### Requirement: Tabs of an unavailable or incompatible server stay in the strip

**Reason**: A window's tabs all belong to one server, so an unavailable or incompatible server is a state of the whole window rather than of some of its tabs.

**Migration**: See "Connection failure behaviour" and "Server compatibility is negotiated by the bundle's client" in `connections-and-client-hosts`.

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
