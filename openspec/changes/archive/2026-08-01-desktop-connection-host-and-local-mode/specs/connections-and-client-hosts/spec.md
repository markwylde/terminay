## ADDED Requirements

### Requirement: Desktop startup and Local binding
Terminay Desktop SHALL start its embedded server before presenting the default workspace and
SHALL create an immutable built-in **Local** connection profile from that server's stable
identity. The first native window SHALL bind to Local, and the header SHALL name Local rather
than a generic remote label. Local SHALL function with no internet access, hosted signaling,
or WebRTC.

#### Scenario: Offline launch into Local
- **WHEN** Desktop starts with no network access
- **THEN** the embedded server starts, the Local profile is created from its stable identity, and the first window opens a sandboxed Local workspace

#### Scenario: Server not yet connected
- **WHEN** the embedded server is starting, migrating, failed, crashed, restarting, or stopped
- **THEN** the window presents that state and does not present a connected workspace

### Requirement: Desktop launches the selected server's bundle
Desktop SHALL load the workspace UI from the authenticated current connection's server bundle.
It SHALL prove the final URL is same-origin with that connection and SHALL reject a stale or
oversized bundle response before rendering it.

#### Scenario: Same-origin bundle load
- **WHEN** a connection window loads its server bundle
- **THEN** the final URL is verified same-origin with the authenticated current connection

#### Scenario: Stale or oversized response
- **WHEN** the bundle response is stale or exceeds its size bound
- **THEN** it is rejected before rendering and a failure state is shown

### Requirement: Remote code containment in Electron
The server bundle SHALL run in a sandboxed context with Node integration disabled, context
isolation enabled, web security enabled, and webviews disabled. The host SHALL deny new
windows, arbitrary navigation, downloads, permission requests, and protocol handlers unless
explicitly allowed. Bundle code SHALL NOT reach Node, arbitrary Electron IPC, another
profile's credentials, or an unrelated native window.

#### Scenario: Sandbox escape attempts are denied
- **WHEN** a test server bundle attempts to open a window, navigate away, start a download, or request a permission
- **THEN** the attempt is denied by the host

#### Scenario: No ambient authority
- **WHEN** a test server bundle attempts to reach Node, arbitrary Electron IPC, another profile's credentials, or an unrelated native window
- **THEN** every attempt fails

### Requirement: Versioned source-bound host bridge
Native capabilities SHALL be exposed to the workspace only as narrow versioned host bridges.
For every bridge action the host SHALL validate the trusted top-level sender, the exact
versioned request envelope, the current connection, bounded payload fields, and where required
a user gesture, before acting. Subframes SHALL be denied.

#### Scenario: Envelope validation
- **WHEN** a bridge action arrives with a wrong version, an unexpected field, or an out-of-bounds value
- **THEN** the host rejects it without performing the native action

#### Scenario: Subframe denial
- **WHEN** a subframe of the server bundle invokes a host bridge action
- **THEN** the request is denied

### Requirement: Bounded host bridge surface
The preload SHALL project only the API shape of each bridge, never its implementation object.
For the main-frame server bundle it SHALL expose exactly `version`, `getContext`, and
`requestAction`. Broad ambient renderer APIs and application-service IPC routes SHALL NOT exist.

#### Scenario: Exact exposed shape
- **WHEN** the main-frame server bundle inspects the host bridge
- **THEN** it finds exactly `version`, `getContext`, and `requestAction`, and no implementation object

#### Scenario: No broad preload API
- **WHEN** the renderer attempts a broad ambient preload call or an application-service IPC channel
- **THEN** neither the method nor the channel exists

### Requirement: Native window server binding
Each native window SHALL bind to exactly one server connection. Selecting a profile SHALL
focus an existing suitable window or open a new one, and rebinding the current window SHALL be
an explicit action. Server workspace views SHALL map to native windows without treating the
native window id as canonical identity.

#### Scenario: Rebinding to a remote server
- **WHEN** a pairing URL for a standalone server is accepted in the connection menu
- **THEN** the same native window projects that remote connection rather than retaining Local authority

#### Scenario: Window id is not canonical
- **WHEN** a server workspace view is presented in a native window
- **THEN** the mapping is held in the host-local registry and the native window id is not used as the view's identity

### Requirement: Distinct connection management actions
Project popout, adoption, merge, and logical-view closure SHALL be performed through
authenticated server commands. Popout SHALL create a server-owned logical view and move the
project through an authenticated command, storing only native presentation locally. A rejected
command SHALL roll back the native binding and any empty created view and SHALL preserve the
existing native presentation.

#### Scenario: Popout preserves identity
- **WHEN** a project is popped out to a new native window
- **THEN** a server-owned logical view is created, the project is moved through an authenticated command, panel and session identity are preserved, and exactly one native binding is opened

#### Scenario: Rejected move rolls back
- **WHEN** the server rejects the project move
- **THEN** both the native binding and the empty created view are rolled back

#### Scenario: Rejected close preserves presentation
- **WHEN** the server rejects an explicit logical-view closure
- **THEN** the native presentation is preserved and no host view binding is detached

### Requirement: Allowed and forbidden host-local profile data
The Desktop connection profile store SHALL keep profile metadata separate from device and
reconnect credentials. Credentials SHALL use OS-backed secure storage when available, with
explicit degraded behaviour when it is not. The store SHALL record the server fingerprint or
identity and SHALL detect an unexpected identity change at a remembered origin. Native window
geometry and the `(connection, workspaceView)` mapping SHALL be host-local presentation, never
server workspace state.

#### Scenario: Unexpected identity at a remembered origin
- **WHEN** a remembered origin presents a server identity that differs from the recorded fingerprint
- **THEN** the change is detected and surfaced rather than silently accepted

#### Scenario: Secure storage unavailable
- **WHEN** OS-backed secure storage is unavailable
- **THEN** the host reports explicit degraded behaviour rather than storing credentials as if protected

### Requirement: Local server lifecycle is a host action
Embedded server supervision SHALL be owned by the Desktop host and SHALL be independent of any
renderer's lifetime. Reloading or closing a workspace view SHALL NOT terminate Local terminal
sessions, and two Local workspace views SHALL be able to occupy separate native windows without
duplicating sessions.

#### Scenario: Reload leaves sessions alive
- **WHEN** a Local workspace view is reloaded or closed
- **THEN** the embedded server continues running and its terminal sessions survive

#### Scenario: Two Local windows
- **WHEN** two Local workspace views are opened in separate native windows
- **THEN** each renders the same server's sessions without duplicating them
