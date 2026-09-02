## ADDED Requirements

### Requirement: One responsive workspace implementation

The product SHALL have one full responsive workspace UI implementation. Each server SHALL bundle it; local Desktop SHALL load it from the embedded server; remote Desktop and browser clients SHALL load it through the selected server session origin and the verified asset flow; and it SHALL work standalone when the session URL is opened directly. There SHALL be no separate terminal-only remote workspace application and no second client state library.

#### Scenario: Direct session URL renders the workspace

- **WHEN** a session URL is opened directly
- **THEN** the server's bundled responsive UI runs standalone

#### Scenario: Every host loads the same implementation

- **WHEN** local Desktop, remote Desktop, and a browser connect to one server
- **THEN** each loads that server's bundled workspace UI

#### Scenario: One feature fix changes one implementation

- **WHEN** a workspace feature is changed
- **THEN** it is changed in the one shared implementation rather than in a per-host renderer

### Requirement: One workspace renderer per selected server

Desktop development, packaged Desktop, browser sessions, and auxiliary routes SHALL execute the same server-bundled component tree against the authenticated selected-server client. That selected-server bundle SHALL be the sole workspace renderer for connections, Git, agents, folders, files, and terminals. There SHALL be no second workspace-window owner, route-marker wrapper, or legacy fallback renderer for normal Local and remote startup.

#### Scenario: Auxiliary routes use the server bundle

- **WHEN** Desktop opens an auxiliary route
- **THEN** it executes the selected server's bundled route body against the authenticated client

#### Scenario: Development and packaged builds render identically

- **WHEN** Desktop runs in development or packaged form
- **THEN** the same server-bundled workspace renders

### Requirement: Renderer-neutral shared UI boundary

Shared workspace UI components SHALL be renderer-neutral: their source SHALL import only shared UI modules and SHALL NOT reach Electron, IPC, a browser or WebRTC transport, Node process APIs, or host globals. Canonical renderer feature code SHALL NOT issue raw client query, command, or subscribe calls or broad host-preload calls; connection-independent server operations SHALL go through bounded feature clients, and native operations SHALL go through narrow, versioned, validated host capabilities. Shared route and panel models SHALL be deeply frozen, data-only state, and the React rendering boundary SHALL reject mutable or accessor-backed models before any panel is rendered.

#### Scenario: Shared component reaches a host primitive

- **WHEN** a shared UI component imports Electron, IPC, a transport, Node process APIs, or a host global
- **THEN** the boundary check fails

#### Scenario: Substituted model is rejected

- **WHEN** a host supplies a mutable or accessor-backed route model between composition and render
- **THEN** the shared React surface rejects it before rendering any panel

#### Scenario: Native operation without a capability

- **WHEN** a shared route requests a native operation whose host capability is not declared
- **THEN** the route uses its in-page equivalent or shows a clear unavailable action rather than falling through to a native call

### Requirement: Shared route registry

The shared UI package SHALL expose a route registry for workspace, connections, settings, recordings, macros, file, and Git surfaces. Every registered route SHALL declare its complete canonical panel set at its ready boundary and SHALL fail closed rather than rendering a partial host-specific surface; loading and error sub-surfaces MAY remain explicitly partial. Browser hosts SHALL keep every route in-page. Desktop MAY present eligible secondary routes in native auxiliary windows only when its `nativeWindows` capability is declared, and SHALL request presentation through the canonical auxiliary route controller rather than probing ambient native-window globals.

#### Scenario: Browser keeps routes in-page

- **WHEN** a browser host opens a secondary route
- **THEN** it is presented in-page

#### Scenario: Native windows require the capability

- **WHEN** the `nativeWindows` capability is not declared
- **THEN** Desktop does not present secondary routes in native auxiliary windows

#### Scenario: Incomplete ready route fails closed

- **WHEN** a registered route reaches its ready boundary without its complete canonical panel set
- **THEN** it fails closed instead of rendering an incomplete surface

### Requirement: Parity of Desktop and web workspace surfaces

Desktop and web SHALL render the same projects, panels, files, terminals, settings, recordings, macros, agents, Git state, and connection state from one server model. Host adapters SHALL resolve every registered route to the identical frozen component and region contract; only the in-page versus native-auxiliary presentation policy MAY differ. Wide layouts SHALL resemble the Electron workspace. The medium layout SHALL reuse the canonical wide panel contracts inside a compact route shell rather than introducing a third panel density. Narrow layouts SHALL replace wide tab strips and sidebars with accessible selectors, drawers, stacked surfaces, and touch controls while retaining the same server object ids, and web clients SHALL manage server-owned logical workspace views through in-page navigation rather than popup windows.

#### Scenario: Narrow layout keeps server object ids

- **WHEN** the workspace renders at a narrow width
- **THEN** selectors, drawers, and stacked surfaces are used while server object ids stay the same

#### Scenario: Routes cannot drift between hosts

- **WHEN** the Desktop and browser adapters resolve the same registered route
- **THEN** they produce the identical shared component and region contract

#### Scenario: No horizontal page overflow

- **WHEN** any registered route renders at wide, medium, or narrow width
- **THEN** the document, shell, and terminal region create no horizontal page overflow

### Requirement: Mobile viewport and keyboard behaviour

On mobile browsers, the workspace SHALL follow the visual viewport and resize the active terminal and surrounding content when the software keyboard appears. The focused terminal SHALL remain visible and interactive without trapping the page, and its previous geometry SHALL return when the keyboard is dismissed. A touch terminal accessory SHALL expose an allowlisted Escape, Tab, modifier, and navigation key set with a minimum 44px target while physical desktop keyboard input remains unrestricted. Terminal geometry derived from viewport measurement SHALL be bounded.

#### Scenario: Keyboard appearance resizes the terminal

- **WHEN** the software keyboard appears on a mobile browser
- **THEN** the active terminal and surrounding content resize, the focused terminal stays visible and interactive, and the page is not trapped

#### Scenario: Accessory input is allowlisted

- **WHEN** the touch terminal accessory sends a key
- **THEN** it is drawn from the allowlisted key set and desktop physical keyboard input is unaffected

### Requirement: Responsive accessibility policy

Host-provided reduced-motion, colour-scheme, forced-colours, and screen-reader hints SHALL resolve into one immutable policy. Reduced motion SHALL remove shell animation and transition timing without removing keyboard route access. Status announcements SHALL be polite and terminal byte output SHALL carry `aria-live="off"` so it is never announced as a live stream. Drawers SHALL model an initial focus target and a trigger restoration target, and a missing target SHALL leave focus unchanged rather than causing a focus jump. The route rail SHALL be a roving tablist whose arrow navigation selects an enabled route, skips disabled routes, moves real DOM focus, and preserves 44px targets. One keyboard skip link SHALL move focus from the shell chrome to the active route's canonical tabpanel.

#### Scenario: Reduced motion keeps keyboard access

- **WHEN** the host reports a reduced-motion preference
- **THEN** shell animation and transition timing are removed while keyboard route access is unchanged

#### Scenario: Terminal output is not announced

- **WHEN** a terminal produces output
- **THEN** the output region is `aria-live="off"` and is not announced as a live stream

#### Scenario: Disabled route is skipped

- **WHEN** arrow navigation reaches a disabled route tab
- **THEN** the tab is exposed as `aria-disabled`, kept out of the roving tab order, and its activation is rejected

### Requirement: Content-addressed workspace bundle manifest

The build SHALL produce one content-hashed manifest containing the complete UI inventory with each file's hash, path, size, and content type, the declared entry point, the required content security policy, and the server and protocol compatibility metadata. The bundle id SHALL derive from the complete canonical inventory. Executable and stylesheet references from the declared HTML entry SHALL resolve only to assets declared in that manifest; external, empty, and undeclared references SHALL fail closed. Root-relative application asset requests SHALL resolve into the active verified content-addressed namespace for unpacked Local bundles and remotely installed commits alike, and undeclared root-relative requests SHALL return 404. Superseded content-addressed bundles SHALL be removed only after the current-bundle pointer has been atomically replaced, and a failed verification or install SHALL retain the prior launchable bundle and pointer.

#### Scenario: Undeclared reference fails closed

- **WHEN** the entry document references an executable or stylesheet not declared in the manifest
- **THEN** the bundle is rejected

#### Scenario: Failed install retains the prior bundle

- **WHEN** a bundle replacement fails verification
- **THEN** the prior verified bundle and its pointer remain launchable and are not pruned

#### Scenario: Same manifest launches every path

- **WHEN** one generated manifest is launched through Local, embedded, and remotely installed paths
- **THEN** each serves the same verified entry document and root-relative asset shape without filesystem fallback

### Requirement: Browser reconnect recovery and status atomicity

A connected browser workspace SHALL keep its connected presentation when the protocol or event stream is lost, show an unreachable or reconnecting state, and retry with bounded backoff until the server returns or the user cancels, then restore the server-owned workspace and terminal state. A valid persisted reconnect grant SHALL complete its challenge and proof flow after a server restart. A permanent authorization failure SHALL transition to one stable fresh-pairing or error state, clear stale reconnect state where appropriate, and stop repeated protocol requests until the user supplies a new pairing URL or selects a valid saved profile. Connection status messages SHALL be mutually exclusive: a profile SHALL NOT report connected beside a reconnect error or retain stale success text. Loopback host forms of the same server SHALL resolve to one profile and credential identity and SHALL use the same bounded protocol authorization path.

#### Scenario: Server restart is recovered without repairing

- **WHEN** the server restarts while a browser workspace is connected
- **THEN** the workspace stays presented, retries with bounded backoff, completes its saved reconnect proof, and restores server-owned state without asking for a fresh pairing URL

#### Scenario: Permanent authorization failure stops retrying

- **WHEN** a handshake, reconnect, or protocol request fails permanently
- **THEN** one stable fresh-pairing or error state is shown and repeated protocol requests stop until the user acts

#### Scenario: Loopback forms are one identity

- **WHEN** the same server is reached through either loopback host form
- **THEN** one profile and credential identity is used and neither form is shown as unreachable while the other is connected
