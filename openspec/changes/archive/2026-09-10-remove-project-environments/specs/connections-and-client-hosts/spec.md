## MODIFIED Requirements

### Requirement: Shared route registry

The shared UI package SHALL expose a route registry for workspace, connections, settings including Extensions, recordings, macros, file, and Git surfaces. Browser hosts SHALL keep every route in-page. Desktop MAY present eligible secondary routes in native auxiliary windows only when its `nativeWindows` capability is declared.

#### Scenario: Browser keeps routes in-page

- **WHEN** a browser host opens a secondary route
- **THEN** it is presented in-page

#### Scenario: Native windows require the capability

- **WHEN** the `nativeWindows` capability is not declared
- **THEN** Desktop does not present secondary routes in native auxiliary windows

### Requirement: File menu grouping

File SHALL group workspace creation separately from management surfaces: **Create a new terminal tab** and **Create a new project** first, then **Remote Control**, **Extensions**, **Macros**, **Recordings**, and **Settings**.

#### Scenario: Creation actions precede management surfaces

- **WHEN** the user opens the File menu
- **THEN** terminal and project creation appear first, followed by the management surfaces

### Requirement: Remote Control management surface

**Remote Control** SHALL open the shared connections route as a first-class management window in the same presentation family as Settings, Macros, and Recordings, using that family's sidebar-and-content chrome. Title, subtitle, and **Add connection…** SHALL live in the left sidebar with **Exposure** first, then the saved-server list. Title, action, group labels, rows, and empty sidebar copy SHALL share one inset, matching Settings. The main pane SHALL show only the selected sidebar item: Exposure SHALL use the Settings remote-access cards for status header, WebRTC summary, pending approvals, trusted browsers, and live connections, while saved-server details and pairing SHALL appear there when those items are selected. Desktop SHALL open or focus a native auxiliary window; the browser host SHALL present the same route in-page. The window SHALL NOT be an Edit Tab sheet. Remote Control SHALL be the single management surface for pairing, approvals, trusted devices, live connections, and server identity reset, while Settings keeps signaling configuration.

#### Scenario: Both entry points open the same surface

- **WHEN** the user chooses File → Remote Control or the header connection-menu manage control
- **THEN** the same Remote Control management window opens with the Settings-family sidebar-and-content chrome

#### Scenario: Empty saved-server list lands on Exposure

- **WHEN** there are no saved servers
- **THEN** the window lands on Exposure with a quiet sidebar note, and empty-server copy is hidden while Exposure is selected or the pairing form is open

#### Scenario: Settings retains policy configuration

- **WHEN** the user needs signaling configuration
- **THEN** it remains in Settings rather than Remote Control

### Requirement: Desktop user-data namespace isolation

Source-development Desktop SHALL use a dedicated `Terminay Development` user-data namespace by default and SHALL NOT read, mutate, or silently attach to an installed Terminay release's persistence or embedded server authority. Tests and migration tooling MAY select an explicit isolated namespace with `TERMINAY_USER_DATA_DIR`; packaged releases SHALL retain the normal `Terminay` namespace. Each selected namespace SHALL own its durable opaque Local identity, Local profile route, server-UI partition, workspace, and recording stores, and bundle cache. Historical embedded records using the former canonical Local id SHALL migrate only within their own namespace before normal server, project, and session validation, and a foreign server identity SHALL never be adopted or rewritten.

#### Scenario: Development does not touch the release namespace

- **WHEN** Desktop runs from source
- **THEN** it uses the `Terminay Development` namespace and does not read or mutate an installed release's persistence

#### Scenario: Foreign identity is never adopted

- **WHEN** an embedded record carries a server identity from another namespace
- **THEN** it is neither adopted nor rewritten

### Requirement: Shared management routes across hosts

Settings including Extensions, macros, recordings, remote control, and edit-tab surfaces SHALL use shared routes and components. Electron SHALL present Remote Control as a first-class native management window consistent with Settings, Macros, and Recordings, while edit-tab routes MAY use modal project-editor chrome. The web host SHALL present the same routes in-page with equivalent open, focus, save, cancel, and close semantics.

#### Scenario: Web presents the same routes in-page

- **WHEN** a web user opens Remote Control
- **THEN** the same route is presented in-page with equivalent open, focus, save, cancel, and close semantics

## REMOVED Requirements

### Requirement: Server connections are distinct from project environments

**Reason:** The project environment concept is removed. Every project executes on the Terminay Server that owns it, so a server connection is the only relationship a client has with a machine and there is no second, server-owned outbound binding to distinguish it from.

**Migration:** None. Reaching another machine means running a Terminay Server on it and adding a server connection, which the existing connection model already covers.
