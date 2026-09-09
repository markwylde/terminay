## ADDED Requirements

### Requirement: Home control placement

The project bar SHALL carry a Home control between the sidebar toggle and the first project tab. It SHALL be leading chrome rather than a project tab: it SHALL NEVER scroll, overflow, reorder, or be dragged, SHALL NEVER be closeable, and SHALL NEVER participate in project drag-and-drop as either a dragged item or a drop target. Dragging a project tab across it SHALL NOT displace it.

#### Scenario: Home sits after the sidebar toggle

- **WHEN** the project bar renders
- **THEN** the Home control sits immediately after the sidebar toggle and before the first project tab

#### Scenario: Dragging a project tab

- **WHEN** a project tab is dragged across the Home control
- **THEN** the Home control is neither a drop target nor displaced, and no project is reordered into its position

## MODIFIED Requirements

### Requirement: Trailing chrome is never displaced

The project tab bar SHALL NEVER steal leading or trailing chrome. The sidebar toggle, the Home control, the new-project control, activity, and the Local connection pill SHALL stay fully visible. Opening the environment chooser SHALL NOT grow or shift the tab bar.

#### Scenario: Crowded tab bar
- **WHEN** many project tabs are open
- **THEN** the sidebar toggle, the Home control, the new-project control, activity, and the Local connection pill remain fully visible

#### Scenario: Opening the environment chooser
- **WHEN** the environment chooser opens
- **THEN** the tab bar neither grows nor shifts

### Requirement: Canonical workspace state and presentation-local selection

Project identity, immutable environment binding, layout, panel membership, project-local sidebar layout, and logical workspace views SHALL be canonical server state. The ordered project list in a view and the ordered panels in a project SHALL be broadcast to every connected presentation. Which view is selected — the Home dashboard or a project — and which terminal or panel is active inside a selected project SHALL be local to that presentation, so a desktop window and a web client on the same server can show different selected views. Desktop windows and browser views SHALL also retain their own per-project sidebar visibility.

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
