# connections-and-client-hosts Specification

## Purpose

Terminay Desktop and browser clients share one server identity, device enrollment, and connection model, so that a user can add, remember, open, switch, inspect, expose, and forget Terminay Server connections from either host while each host shell stays a thin, capability-gated presenter of the selected server's bundled workspace.

## Requirements

### Requirement: Connection vocabulary

A **server connection** SHALL be an authenticated relationship with one stable Terminay Server identity. A **connection profile** SHALL be host-local metadata such as label, session origin, server identity or fingerprint, last-opened time, and status. A **connection window** SHALL be an Electron window or browser view bound to one server and optionally one logical workspace view. A **host shell** SHALL own connection bootstrap, protected credentials, verified bundle installation, and native or browser presentation, and SHALL NOT implement workspace features or interpret the application protocol. A **host capability** SHALL be one optional, versioned presentation or OS action supplied by a trusted shell to a bound server-bundled renderer.

#### Scenario: Host shell stays out of the application protocol

- **WHEN** a host shell carries application traffic for a bound renderer
- **THEN** it provides bootstrap, credentials, bundle installation, and presentation only
- **AND** it does not implement workspace features or interpret the application protocol

#### Scenario: Capabilities are negotiated, not assumed

- **WHEN** a server-bundled renderer needs a native action
- **THEN** it uses an individually negotiated, versioned host capability

### Requirement: Server connections are distinct from project environments

A server connection SHALL be the client-to-Terminay-Server transport selected by the host. A project environment SHALL be a server-owned outbound binding from that Terminay Server to a project machine. The header server selector SHALL never list SSH servers or Puzed VMs; project creation and **Project Environments…** SHALL list them. Desktop and web SHALL never install environment extensions, make those outbound connections, or hold their secrets.

#### Scenario: Selector excludes project environments

- **WHEN** the user opens the header server selector
- **THEN** it lists Terminay Server connections only, and no SSH servers or Puzed VMs

#### Scenario: Clients hold no environment secrets

- **WHEN** a project environment connects outbound
- **THEN** the Terminay Server makes that connection and the Desktop or web client holds none of its secrets

### Requirement: Header server control presentation

The header SHALL display the current server label rather than the transport. Left of the label, an exposure control icon SHALL use the same colour as the label, showing a stop icon while the server is exposed and a play icon while it is not. Right of the label, a blue pill SHALL show the number of active remote connections, and SHALL show nothing when that count is zero. The header SHALL report the selected profile label and status, including Local failure or offline state, and SHALL never show a transport name or the opaque session-id hostname. Browser sessions SHALL use the saved connection title, falling back to the pairing `hostName`.

#### Scenario: Exposure icon reflects state

- **WHEN** the current server is exposed
- **THEN** the control left of the label is a stop icon in the label colour

#### Scenario: Connection pill hidden at zero

- **WHEN** there are no active remote connections
- **THEN** no count pill is shown

#### Scenario: Label never shows the session hostname

- **WHEN** a browser session is connected to a remote server
- **THEN** the header shows the saved connection title, or the pairing `hostName`, and never the opaque session-id hostname

### Requirement: Connection menu contents

The connection menu SHALL contain, on Desktop, every remembered connection as a single-line list with **Local** first, where selecting another profile focuses an existing window for that connection or opens a new sandboxed window. On a framed `app.terminay.com` session it SHALL contain only the current connection and SHALL NOT be a switcher list, because the manager owns the saved-profile list outside the iframe. The menu SHALL contain a manage control on the Connections heading that opens the same **Remote Control** surface as File → Remote Control; **Expose this server…** when the current device is allowed to manage exposure; **Create pairing link** while the server is exposed; live **Active Connections** for every connected browser or Desktop peer, with empty copy using the same inset as other menu rows; retry and forget or revoke actions with distinct language inside Remote Control; and **Switch connections** only when the browser session can return to the `app.terminay.com` manager.

#### Scenario: Desktop menu lists remembered profiles

- **WHEN** a Desktop user opens the connection menu
- **THEN** every remembered connection is listed with **Local** first and **Switch connections** is absent

#### Scenario: Framed menu shows only the current connection

- **WHEN** a framed `app.terminay.com` workspace opens its connection menu
- **THEN** it shows the current connection and **Switch connections**, and not the manager's other saved profiles

#### Scenario: Exposure actions are capability-gated

- **WHEN** the current device is not allowed to manage exposure
- **THEN** **Expose this server…** is not offered

### Requirement: Connection diagnostics in the menu

The connection menu SHALL provide diagnostics that distinguish server offline, relay unavailable, WebRTC route failure, missing device identity, revoked device, invalid contract, and failed switch actions. A failed switch action SHALL keep the selector visible and show the host-provided failure reason rather than logging only to the native terminal. The primary exposure control SHALL represent server-owned WebRTC availability; an unavailable route SHALL remain visible for diagnosis, link to its configuration or build requirement, and have its start action disabled.

#### Scenario: Failed switch is visible in the UI

- **WHEN** switching to another connection fails
- **THEN** the selector stays visible and shows the host-provided failure reason

#### Scenario: Unavailable route stays diagnosable

- **WHEN** the WebRTC route is unavailable
- **THEN** the control remains visible with a disabled start action and a link to its configuration or build requirement

### Requirement: Accessible connection menu semantics

The shared browser-safe UI package SHALL project the connection model into an accessible `menuitemradio` list with stable ordering, position and set-size metadata, and keyboard and touch focus behaviour including arrow wrapping, Home and End, Escape, and explicit activation. Host capabilities SHALL gate administrative actions such as exposure, and the menu SHALL never invoke a native operation directly.

#### Scenario: Keyboard navigation is complete

- **WHEN** a keyboard user focuses the connection menu
- **THEN** arrow wrapping, Home, End, Escape, and explicit activation all work over a `menuitemradio` list with position and set-size metadata

#### Scenario: Menu does not call native operations

- **WHEN** an administrative menu action is activated
- **THEN** it goes through a gated host capability rather than a direct native operation

### Requirement: Shared route registry

The shared UI package SHALL expose a route registry for workspace, connections, settings including Extensions, project environments, recordings, macros, file, and Git surfaces. Browser hosts SHALL keep every route in-page. Desktop MAY present eligible secondary routes in native auxiliary windows only when its `nativeWindows` capability is declared.

#### Scenario: Browser keeps routes in-page

- **WHEN** a browser host opens a secondary route
- **THEN** it is presented in-page

#### Scenario: Native windows require the capability

- **WHEN** the `nativeWindows` capability is not declared
- **THEN** Desktop does not present secondary routes in native auxiliary windows

### Requirement: File menu grouping

File SHALL group workspace creation separately from management surfaces: **Create a new terminal tab** and **Create a new project** first, then **Remote Control**, **Project Environments**, **Extensions**, **Macros**, **Recordings**, and **Settings**.

#### Scenario: Creation actions precede management surfaces

- **WHEN** the user opens the File menu
- **THEN** terminal and project creation appear first, followed by the management surfaces

### Requirement: Remote Control management surface

**Remote Control** SHALL open the shared connections route as a first-class management window in the same presentation family as Settings, Macros, Recordings, and Project Environments, using that family's sidebar-and-content chrome. Title, subtitle, and **Add connection…** SHALL live in the left sidebar with **This server → Exposure** first, then the saved-server list. Title, action, group labels, rows, and empty sidebar copy SHALL share one inset, matching Settings. The main pane SHALL show only the selected sidebar item: Exposure SHALL use the Settings remote-access cards for status header, WebRTC summary, trusted browsers, and live connections, while saved-server details and pairing SHALL appear there when those items are selected. Desktop SHALL open or focus a native auxiliary window; the browser host SHALL present the same route in-page. The window SHALL NOT be an Edit Tab sheet. Remote Control SHALL be the single management surface for pairing, trusted devices, and live connections, while Settings keeps PIN limits and signaling configuration.

#### Scenario: Both entry points open the same surface

- **WHEN** the user chooses File → Remote Control or the header connection-menu manage control
- **THEN** the same Remote Control management window opens with the Settings-family sidebar-and-content chrome

#### Scenario: Empty saved-server list lands on Exposure

- **WHEN** there are no saved servers
- **THEN** the window lands on Exposure with a quiet sidebar note, and empty-server copy is hidden while Exposure is selected or the pairing form is open

#### Scenario: Settings retains policy configuration

- **WHEN** the user needs PIN limits or signaling configuration
- **THEN** those remain in Settings rather than Remote Control

### Requirement: Pair Device dialog

**Create pairing link** from the connection menu and from Remote Control SHALL open the same Pair Device dialog. Remote Control's Exposure header SHALL show that action next to **Stop exposure** while the server is exposed. The dialog SHALL show the one-time pairing link and a copy control, and SHALL NOT show the session-origin hostname. Pairing URL and PIN fields SHALL stack at full width above continue and cancel actions.

#### Scenario: Dialog hides the session hostname

- **WHEN** the Pair Device dialog is open
- **THEN** it shows the one-time pairing link and copy control and not the session-origin hostname

#### Scenario: Same dialog from both entry points

- **WHEN** **Create pairing link** is chosen from the connection menu or from Remote Control
- **THEN** the same Pair Device dialog opens

### Requirement: One workspace renderer per selected server

Desktop development, packaged Desktop, and auxiliary routes SHALL execute the same server-bundled route bodies against the authenticated selected-server client. That selected-server bundle SHALL be the sole workspace renderer for connections, Git, agents, folders, and terminals. Desktop SHALL use the same production server-UI window composition for normal Local and remote startup, with no second workspace-window owner.

#### Scenario: Auxiliary routes use the server bundle

- **WHEN** Desktop opens an auxiliary route
- **THEN** it executes the selected server's bundled route body against the authenticated client

#### Scenario: Development and packaged builds render identically

- **WHEN** Desktop runs in development or packaged form
- **THEN** the same server-bundled workspace renders

### Requirement: Connection status is separate from activity

The existing activity and notification indicator SHALL remain separate from connection status. Connection status SHALL NOT be conflated with terminal or agent attention.

#### Scenario: Indicators stay distinct

- **WHEN** a terminal requires attention while the connection is healthy
- **THEN** the activity indicator changes and the connection status does not

### Requirement: Desktop startup and Local binding

Desktop startup SHALL supervise the embedded server and open or focus a window bound to its **Local** profile. The initial native window SHALL be explicitly bound to immutable Local. Local SHALL use the private authenticated Desktop host transport and SHALL NOT require a network listener, internet access, hosted signaling, or WebRTC; remote profiles SHALL require their own selected transport. The embedded server SHALL create one immutable `Local` profile from its stable identity before the first workspace client is opened.

#### Scenario: Desktop opens to Local

- **WHEN** Desktop starts
- **THEN** it supervises the embedded server and opens or focuses a window bound to the immutable **Local** profile

#### Scenario: Local needs no network

- **WHEN** the machine has no internet access
- **THEN** the Local connection still works over the private Desktop host transport

### Requirement: Desktop launches the selected server's bundle

Desktop SHALL launch the exact verified workspace bundle owned by the selected server for every Local and remote connection window. Local SHALL obtain the bytes from its pinned embedded-server artifact; remote SHALL obtain them through the authenticated server asset channel. Desktop SHALL never run its independently packaged Local workspace renderer against a different remote server.

#### Scenario: Remote window runs the remote server's bundle

- **WHEN** a Desktop window binds to a remote profile
- **THEN** it launches that server's verified bundle obtained through the authenticated asset channel

#### Scenario: Same bundle id across hosts

- **WHEN** Local Desktop, remote Desktop, and browser sessions are launched against one server
- **THEN** they report the same verified bundle id and differ only in transport and declared host capabilities

### Requirement: Desktop user-data identity

A Desktop user-data root SHALL have one embedded Local server identity and MAY remember any number of remote profiles. On first use Desktop SHALL create an opaque random identity in that root and retain it across restart, and SHALL never derive authority from the application name, project name, path, window, or process. Two Desktop profiles, development or packaged installations, or test roots SHALL therefore remain separate even when their restored project and terminal ids are identical.

#### Scenario: Identity survives restart

- **WHEN** Desktop restarts
- **THEN** it reuses the opaque random identity stored in its user-data root

#### Scenario: Identical ids do not merge roots

- **WHEN** two Desktop roots hold identical restored project and terminal ids
- **THEN** they remain separate installations

### Requirement: Native window server binding

A native window SHALL be bound to exactly one server at a time, and its title and security scope SHALL make the connection clear. Multiple windows MAY target the same server and different logical workspace views, and other windows MAY simultaneously target other servers. Selecting a profile SHALL focus an existing window for that connection or view when appropriate, or open a new sandboxed window; rebinding the current window SHALL be an explicit action rather than a side effect of menu selection. Native window identity and server logical-view identity SHALL remain separate bindings, so focus or close does not mutate a logical view without a typed server command.

#### Scenario: Four windows across four servers

- **WHEN** four Electron windows show one Local and three remote servers
- **THEN** no server, project, or credential state crosses between them

#### Scenario: Menu selection does not rebind silently

- **WHEN** the user selects another profile from the connection menu
- **THEN** an existing window is focused or a new sandboxed window opens, and the current window is not rebound

### Requirement: Native window reload preserves binding

Reloading a native window SHALL preserve that exact server binding. Desktop SHALL discard the document-scoped byte channel, reconnect the remembered remote profile with its OS-protected credential, and transfer a fresh channel to the new document. A reload SHALL never attach Local merely because the remote renderer transport was destroyed with the previous document.

#### Scenario: Remote window reload stays remote

- **WHEN** a window bound to a remote profile is reloaded
- **THEN** the remote profile reconnects with its OS-protected credential and a fresh channel is transferred to the new document

### Requirement: Connection window loading state

A newly opened Desktop connection window SHALL remain in the normal loading state until its own local or remote server connection is ready. The loading state SHALL centre the Terminay mark in the window above a looping five-dot loading indicator, with five fixed, contrasting colours from the tab hue palette entering in sequence. Desktop packaging, browser metadata, and visible web surfaces SHALL use the same square mark geometry: a pure-black background with even horizontal and vertical padding around the white glyph. Local embedded-server startup SHALL show no text, while remote connections SHALL also show a short status message. Native window controls SHALL never overlap it.

#### Scenario: Remote loading shows a status message

- **WHEN** a remote connection window is loading
- **THEN** the mark, five-dot indicator, and a short status message are shown

#### Scenario: Local loading shows no text

- **WHEN** the Local embedded server is starting
- **THEN** the loading state shows the mark and dots without text

### Requirement: Startup paint sequence

At local Desktop startup, a self-contained native loading document SHALL paint the loading state immediately after Electron is ready, before workspace restoration, extension setup, or server initialization begins. The loading document SHALL finish painting and the native window SHALL be shown before that restoration starts. The verified server UI SHALL replace the loading document once its session is ready, and its initial document SHALL paint the same loading state before the renderer bundle evaluates, keeping the dot animation in phase through that handoff so startup never presents an empty window or a visibly restarted loader. The originating window SHALL keep its existing server binding during that handoff.

#### Scenario: No empty window at startup

- **WHEN** Desktop starts and hands off from the native loading document to the server UI
- **THEN** the dot animation stays in phase and no empty window or restarted loader is shown

#### Scenario: Window is shown before restoration

- **WHEN** Electron becomes ready
- **THEN** the loading document paints and the window is shown before workspace restoration begins

### Requirement: Startup failure recovery

If workspace persistence cannot be read, validated, or first-run committed, Desktop SHALL stop any in-flight loading navigation and replace the loader with a host-owned recovery document rather than leaving Chromium pending or the window unpainted. If the renderer cannot bootstrap, it SHALL replace the loading state with a visible reload action.

#### Scenario: Unreadable persistence shows recovery

- **WHEN** workspace persistence cannot be read or validated
- **THEN** in-flight loading navigation stops and a host-owned recovery document is shown

#### Scenario: Failed bootstrap offers reload

- **WHEN** the renderer cannot bootstrap
- **THEN** the loading state is replaced with a visible reload action

### Requirement: Local server lifecycle is a host action

Local server startup, shutdown, crash recovery, and update SHALL be host actions. Remote server shutdown or update SHALL never be implied by closing its window. A Local crash, restart, or stopped state SHALL detach the active client and mark the profile unavailable until an explicit recovery connects again; the host SHALL never present a stale connected workspace. A failed identity check SHALL mark that profile as an explicit identity-mismatch failure and SHALL never switch to Local or another remembered profile implicitly.

#### Scenario: Closing a remote window does not stop that server

- **WHEN** the user closes a window bound to a remote profile
- **THEN** the remote server is not shut down or updated

#### Scenario: Local crash marks the profile unavailable

- **WHEN** the Local server crashes or is stopped
- **THEN** the active client detaches and the profile is marked unavailable until explicit recovery

#### Scenario: Identity mismatch never falls back

- **WHEN** a profile's identity check fails
- **THEN** it is marked an identity-mismatch failure and no implicit switch to Local or another profile occurs

### Requirement: Desktop connection persistence

Desktop SHALL store non-secret profiles locally and credentials through OS-backed secure storage where available. A Desktop connection created from a pairing URL SHALL enrol a protected device key and save only the stable session origin as switchable profile metadata; one-time URLs SHALL never be stored or reused. A profile record SHALL contain only its stable server identity, exact session origin, display metadata, timestamps, and a diagnostic status; pairing fragments, device keys, terminal data, and filesystem paths SHALL NOT be profile fields.

#### Scenario: Pairing URL is not persisted

- **WHEN** Desktop creates a connection from a pairing URL
- **THEN** only the stable session origin and sanitized metadata are saved, and the one-time URL is not stored

#### Scenario: Credentials use OS-backed storage

- **WHEN** Desktop enrols a device key
- **THEN** it is held through OS-backed secure storage where available and not in the profile record

### Requirement: Desktop keeps application traffic opaque

Desktop SHALL keep application traffic opaque after bootstrap. Its local and remote adapters SHALL provide bounded byte transports to the server-bundled client and SHALL NOT decode, translate, persist, or synthesize feature commands, results, workspace snapshots, or events.

#### Scenario: Adapters do not decode frames

- **WHEN** application frames pass through a Desktop adapter
- **THEN** they are carried as bounded bytes and are neither decoded, translated, persisted, nor synthesized

### Requirement: Distinct connection management actions

Rename SHALL change only remote display metadata. Archive SHALL hide a remote profile without deleting its saved origin. Forget SHALL remove host-local metadata and credentials only after confirmation. Revoke SHALL change server authorization and close affected connections, only after separate confirmation. Forget and revoke SHALL require confirmation explaining their different scopes, and forgetting a profile SHALL NOT claim to revoke server access. None of these actions SHALL rename, archive, forget, or revoke the immutable Local profile.

#### Scenario: Local profile is immutable

- **WHEN** the user attempts to rename, archive, forget, or revoke Local
- **THEN** the action is not available

#### Scenario: Forget and revoke have distinct copy

- **WHEN** the user chooses forget or revoke
- **THEN** confirmation copy explains that forget removes host-local metadata and revoke closes server-side access

### Requirement: Unrelated profile changes do not disturb the current window

Forgetting or revoking a remote profile that is not bound to the current window SHALL NOT replace, reconnect, or resynchronize that window's Local client. Its projects, terminal attachments, and in-flight protocol operations SHALL continue without interruption.

#### Scenario: Local workspace survives an unrelated forget

- **WHEN** an unrelated remote profile is forgotten or revoked
- **THEN** the active Local workspace stays connected and its terminals remain usable without a retry

### Requirement: Versioned source-bound host bridge

Native actions SHALL be exposed through a versioned, source-bound host bridge. The host SHALL inject a frozen context containing the bridge version, host kind, exact bound server and profile identity, and individually negotiated capabilities. A renderer SHALL NOT enable Desktop behaviour with a URL or query parameter, server payload, local setting, or claimed mode. Each request SHALL be checked against its bound window and current connection, SHALL reject unknown payload fields, and SHALL require a user gesture for actions that can read or change native state.

#### Scenario: No renderer-selected privilege switch

- **WHEN** a renderer supplies a query parameter, server payload, local setting, or claimed mode requesting Desktop privileges
- **THEN** no Desktop behaviour is enabled

#### Scenario: Unknown fields are rejected

- **WHEN** a bridge request carries unknown payload fields
- **THEN** the request is rejected

#### Scenario: Native state changes need a gesture

- **WHEN** a bridge action can read or change native state
- **THEN** it requires a user gesture

### Requirement: Bounded host bridge surface

The bridge surface SHALL be limited to semantic window and view focus, route presentation and close, menu commands, clipboard write, approved file selection, credential-free HTTP and HTTPS external links, server-owned reveal tokens, update status, notifications, and explicitly declared OS integration. The bridge SHALL never expose `BrowserWindow`, arbitrary paths, raw transport handles, generic IPC, or server application commands. Server-bundled renderers SHALL receive a `TerminayClient` byte endpoint and capability provider rather than Electron APIs. Its bridge SHALL contain no terminal data, pairing secrets, device keys, arbitrary filesystem paths, or generic Electron IPC.

#### Scenario: Bridge exposes no Electron internals

- **WHEN** a server-bundled renderer inspects its injected context
- **THEN** it finds a byte endpoint and capability provider, and no `BrowserWindow`, raw transport handle, generic IPC, or arbitrary path

#### Scenario: Malicious bundle gains nothing

- **WHEN** a malicious or compromised server bundle exercises the host bridge
- **THEN** it cannot obtain Electron Node access or another session origin's credentials

### Requirement: Canonical auxiliary route presentation

A shared UI SHALL request a route with a presentation disposition; Desktop MAY open or focus a native window while a browser uses an in-page route or browser tab. Settings, recordings, and project or terminal editors SHALL request the canonical auxiliary route controller exclusively and SHALL never probe ambient native-window globals; the presenter SHALL choose an in-page or native disposition from the negotiated host context. Project and terminal tab editors SHALL use the canonical in-page auxiliary dialog, whose shared route body owns the single visible heading and Save or Cancel journey; opening a separate Electron child window SHALL NOT be part of this contract.

#### Scenario: Editors use the canonical controller

- **WHEN** a project or terminal tab editor opens
- **THEN** it requests the canonical auxiliary route controller and does not probe ambient native-window globals

#### Scenario: Disposition comes from host context

- **WHEN** a route is requested with a presentation disposition
- **THEN** the presenter selects in-page or native presentation from the negotiated host context

### Requirement: Shared Connections route contract

The production shared Connections route SHALL accept the host-local `ConnectionProfileStore` and narrow callbacks for switching, server revocation, exposure, pairing, and rename. It SHALL keep forget explicitly separate from revoke with different confirmation copy and SHALL never write a pairing URL into profile metadata. Unsupported actions SHALL stay absent or disabled. The production Desktop server-UI bridge SHALL supply a sanitized profile snapshot and source-bound actions, SHALL reject profiles outside the window's host context, SHALL allow exposure only for the current connection, and SHALL consume pairing credentials without retaining them. Final persisted profile and window-registry callbacks SHALL use the exact `openProfileWindow` selection, flush host-local writes before returning, and separate disconnect and forget from server revocation. The connected shared workspace SHALL enable the Connections route for the authenticated selected server.

#### Scenario: Foreign profile is rejected

- **WHEN** the bridge receives a profile outside the window's host context
- **THEN** it rejects that profile

#### Scenario: Exposure limited to the current connection

- **WHEN** exposure is requested for a connection other than the current one
- **THEN** it is not allowed

#### Scenario: Host-local writes flush before return

- **WHEN** a profile or window-registry callback completes
- **THEN** host-local writes are flushed before it returns

### Requirement: Web connection host scope

`app.terminay.com` SHALL have no Local server option and SHALL never claim browser filesystem or PTY authority. Its disconnected state SHALL be a connection picker: a saved-profile list with **Add new connection**, which opens a dedicated page to scan a pairing QR or paste a pairing URL, plus rename, open, and forget actions. Selecting a profile SHALL frame it in the current PWA view, and an explicit action MAY open a first-party session tab. The PWA SHALL contain connection-profile management, the framed session host, and the origin-keyed credential vault, SHALL NOT run the workspace, and SHALL show at most one framed session at a time.

#### Scenario: Web host offers no Local option

- **WHEN** a browser user opens the connection manager
- **THEN** the same add, manage, and switch journey is available with no Local option

#### Scenario: One framed session at a time

- **WHEN** the user opens another saved profile
- **THEN** it replaces the currently framed session

### Requirement: Web host offline and reachability behaviour

The web host's installable application shell and saved profile list SHALL remain available offline; opening a profile SHALL require the selected session origin to be reachable. The exact session-origin shell SHALL own one replaceable transport generation for its mounted workspace, device authentication, WebRTC and signaling, bundle installation, and connection errors. Live connection, pairing, offline, and revocation states SHALL be presented by the session origin and SHALL NOT be inferred by the manager.

#### Scenario: Offline manager does not claim connectivity

- **WHEN** the installed PWA is opened offline
- **THEN** the manager and saved profile list appear without claiming that an unreachable session origin is connected

#### Scenario: Session origin owns connection state

- **WHEN** a connection changes state
- **THEN** the session origin presents that state rather than the manager inferring it

### Requirement: Web host storage split

The web host SHALL store bookmark metadata in `localStorage` or an equivalent browser store, and framed-session device credentials in manager-origin IndexedDB. The non-extractable browser device key for a framed PWA session SHALL live in that manager vault, while a first-party session document SHALL store its key in IndexedDB and WebCrypto on the exact server session origin. The connection host SHALL NOT read terminal output, project names, paths, PINs, or workspace data, and MAY clone a vaulted device key only into the session iframe whose origin matches the vault slot.

#### Scenario: Vault clone is origin-matched

- **WHEN** a session iframe requests its device key
- **THEN** the manager clones it only when the iframe origin matches the vault slot

#### Scenario: Host cannot read workspace content

- **WHEN** the connection host mediates a session
- **THEN** it reads no terminal output, project names, paths, PINs, or workspace data

### Requirement: PWA profile store record

The PWA SHALL use a Local-disabled `ConnectionProfileStore` and a versioned `terminay.web.connection-profiles.v1` metadata record. It SHALL restore malformed records defensively and SHALL require explicit confirmation for forget. Opening a profile SHALL frame that exact HTTPS origin in the current PWA view; an explicit new-tab action SHALL be host-controlled and open a first-party session document. Pairing fragments SHALL be handed to the stable session origin without being persisted or copied into the saved profile. A profile SHALL retain only a label, canonical origin, and local created and last-opened timestamps; the default label SHALL come from the pairing URL's non-secret `hostName`, the session id in the origin SHALL remain the stable identifier, and the user MAY rename that local label. Pairing URL paths and fragments SHALL be discarded when the manager derives that profile. Queries, origin userinfo, pairing material, and other credentials SHALL never become bookmark state. Framed-session device credentials SHALL be vault state rather than profile metadata. The PWA manager SHALL persist its bookmark list only at the exact manager origin.

#### Scenario: Malformed record is restored defensively

- **WHEN** the stored `terminay.web.connection-profiles.v1` record is malformed
- **THEN** the manager restores defensively rather than failing open with unsanitized data

#### Scenario: Profile keeps only sanitized fields

- **WHEN** the manager derives a profile from a pairing URL
- **THEN** it retains only label, canonical origin, and created and last-opened timestamps

#### Scenario: Fragment never enters bookmark state

- **WHEN** a pairing fragment is handed to the stable session origin
- **THEN** it is not persisted, copied into the profile, or written to manager storage

### Requirement: Bundle content stays out of the manager origin

The stable session origin SHALL install the selected server's bounded workspace bundle after authentication. Bundle bytes, feature frames, pairing fragments, PINs, and connection tickets SHALL never enter the manager origin. Framed-session device credentials SHALL enter only the origin-keyed vault. `app.terminay.com` SHALL be the stable connection manager, and the selected server's verified bundle SHALL render the workspace at its stable session origin.

#### Scenario: Manager origin holds no bundle bytes

- **WHEN** a framed session installs a server bundle
- **THEN** the bytes are handled at the session origin and never enter the manager origin

### Requirement: One responsive workspace implementation

The product SHALL have one full responsive workspace UI implementation: each server bundles it; local Desktop loads it from the embedded server; remote Desktop and browser clients load it through the selected server session origin and the existing verified asset flow; and it works standalone when the session URL is opened directly. Stable session origins SHALL run the server's exact bundled responsive UI.

#### Scenario: Direct session URL renders the workspace

- **WHEN** a session URL is opened directly
- **THEN** the server's bundled responsive UI runs standalone

#### Scenario: Every host loads the same implementation

- **WHEN** local Desktop, remote Desktop, and a browser connect to one server
- **THEN** each loads that server's bundled workspace UI

### Requirement: Mobile viewport and keyboard behaviour

On mobile browsers, the workspace SHALL follow the visual viewport and resize the active terminal and surrounding content when the software keyboard appears. The focused terminal SHALL remain visible and interactive without trapping the page, and its previous geometry SHALL return when the keyboard is dismissed. Browser-chrome expansion and collapse SHALL relayout the complete terminal panel in both dimensions, and taking over an existing terminal SHALL NOT retain a stale compact viewport height after more vertical space becomes available.

#### Scenario: Keyboard appearance resizes the terminal

- **WHEN** the software keyboard appears on a mobile browser
- **THEN** the active terminal and surrounding content resize, the focused terminal stays visible and interactive, and the page is not trapped

#### Scenario: Takeover uses current viewport height

- **WHEN** an existing terminal is taken over after more vertical space becomes available
- **THEN** it relayouts to the current height rather than retaining a stale compact height

### Requirement: Remote code containment in Electron

Remote server-provided code inside Electron SHALL run with sandboxing, context isolation, Node integration disabled, and no ambient privileged preload. A minimal host bridge SHALL validate every native action. The Desktop shell SHALL resolve the selected server bundle manifest and assets only on that profile's exact session origin. Same-origin bundle navigation SHALL be allowed; arbitrary origins, URL credentials or query state, new windows, downloads, permission prompts, and custom protocol handlers SHALL be denied by default. A privileged host MAY explicitly allow one guarded request through the native policy boundary.

#### Scenario: Off-origin navigation is denied

- **WHEN** a bundle attempts to navigate to an arbitrary origin
- **THEN** the navigation is denied

#### Scenario: Downloads and permission prompts are denied by default

- **WHEN** a remote bundle triggers a download, new window, permission prompt, or custom protocol handler
- **THEN** it is denied unless a privileged host explicitly allows that one guarded request

### Requirement: Bundle manifest compatibility

The bundle manifest SHALL declare compatible bootstrap, bundle-format, and host-bridge revisions plus required and optional host capabilities. Missing optional capabilities SHALL use browser-equivalent in-page behaviour or a clear unavailable action. Missing required compatibility SHALL block launch before committing connection state and SHALL identify whether the host or the server must be upgraded. A Desktop shell SHALL connect only when the selected bundle's declared bootstrap, bundle format, byte transport, execution runtime, and required bridge contracts validate successfully.

#### Scenario: Incompatible bundle blocks launch

- **WHEN** required compatibility is missing
- **THEN** launch is blocked before connection state is committed and the message identifies whether the host or the server must be upgraded

#### Scenario: Missing optional capability degrades gracefully

- **WHEN** an optional host capability is absent
- **THEN** the route uses browser-equivalent in-page behaviour or shows a clear unavailable action

### Requirement: Verified bundle cache

Desktop SHALL commit a native window only after the bundle inventory has been verified, its host compatibility requirements accepted, and an exact profile, server, and bundle binding reserved. Local SHALL read the pinned bundle directly from the embedded artifact and SHALL NOT download it through a public listener. Remote SHALL read through its authenticated asset lane into an atomic, content-addressed cache rooted beneath a digest of the exact server identity. An interrupted or invalid replacement SHALL retain the last complete verified bundle for that server. Every cache entry SHALL remain bound to its exact server identity.

#### Scenario: Interrupted download keeps the last good bundle

- **WHEN** a bundle replacement is interrupted or invalid
- **THEN** the last complete verified bundle for that server is retained

#### Scenario: Cache is partitioned by server identity

- **WHEN** two servers publish bundles
- **THEN** each cache entry stays rooted beneath a digest of its exact server identity

### Requirement: Renderer context contents

The resulting renderer context SHALL contain only non-secret identity, negotiated versions and capabilities, and an opaque byte-endpoint handle. Bootstrap credentials, signaling state, transport objects, protected keys, and raw cache paths SHALL remain in Desktop main.

#### Scenario: Renderer holds no secrets

- **WHEN** a renderer inspects its context
- **THEN** it finds non-secret identity, negotiated versions and capabilities, and an opaque byte-endpoint handle only

### Requirement: Browser connection journeys

Terminay SHALL support two browser entry journeys — opening the hosted pairing link and the `app.terminay.com` PWA add flow — and both SHALL use the same session-origin pairing, credential, server-bundle, and reconnect contracts. Opening the advertised hosted URL SHALL land on the manager, which consumes the fragment in memory, strips query and hash from the visible URL, and asks **Save and connect** with an optional title prefilled from `hostName` or the session id; Cancel SHALL discard the material and Confirm SHALL write the bookmark and frame `https://<session-id>.terminay.com/v1/#<secret>` without storing the fragment. The framed session origin SHALL establish WebRTC, verify and launch the selected server bundle, obtain the PIN or approval, create the device key, and complete enrollment, storing that key in the manager vault for `event.origin` when framed. A later visit to the saved profile or the stable session origin SHALL reconnect without reuse of the pairing URL. A first-party visit to a session-origin `/v1/` pairing URL SHALL enrol at the session origin with session-origin IndexedDB.

#### Scenario: Both journeys share one prompt

- **WHEN** the user opens a hosted pairing link in a browser or scans or pastes it inside the PWA
- **THEN** the same **Save and connect** prompt appears and enrollment is framed at the session origin

#### Scenario: Returning to the manager restores the profile

- **WHEN** the user returns to the manager after a framed session
- **THEN** the iframe unloads and the saved profile is restored from local browser storage

#### Scenario: Saved connection reconnects from the vault

- **WHEN** the user selects the saved connection later
- **THEN** its stable session origin is framed, receives its device credential from the manager vault, and reconnects without a pairing URL

### Requirement: Manager is not part of the credential path

The manager SHALL NOT participate in PIN entry and SHALL never receive the connection ticket, terminal data, or workspace data. A missing or revoked device identity SHALL request a newly generated pairing URL. The saved manager profile SHALL remain until the user chooses **Forget**.

#### Scenario: Manager never sees the PIN or ticket

- **WHEN** enrollment or reconnect runs in a framed session
- **THEN** the manager receives no PIN, connection ticket, terminal data, or workspace data

#### Scenario: Revoked identity requests re-pairing

- **WHEN** the device identity is missing or revoked
- **THEN** a newly generated pairing URL is requested and the saved profile is retained

### Requirement: Browser enrollment prompt behaviour

Browser connection and device-enrollment prompts SHALL use the same centered, responsive modal surface and form controls as the rest of the disconnected browser host. Enrollment SHALL explain where to find the PIN, SHALL require a non-empty device name and six digits before enabling its primary action, and SHALL remain fully inset from the viewport at narrow sizes. Starting a fresh pairing flow SHALL NOT show a missing-saved-credential warning; enrollment errors SHALL appear only after an enrollment attempt fails.

#### Scenario: Primary action gated on valid input

- **WHEN** the device name is empty or fewer than six PIN digits are entered
- **THEN** the primary enrollment action stays disabled

#### Scenario: Fresh pairing shows no credential warning

- **WHEN** the user starts a fresh pairing flow
- **THEN** no missing-saved-credential warning is shown and errors appear only after a failed enrollment attempt

### Requirement: Desktop add-connection parity

Desktop **Add connection** SHALL accept the same pairing URL, including hosted `app.terminay.com` links, even when that URL would otherwise open a browser. It SHALL never pair against the manager origin. Browser and Desktop flows SHALL produce the same server-side device and audit semantics. The Desktop connection host SHALL consume the pairing fragment in memory; hosted links MAY carry non-secret `s`, `hostName`, and `pairingExpiresAt` query fields while pairing secrets stay in the fragment. It SHALL persist only the exact session origin plus sanitized profile metadata with a default label from `hostName`. The fragment and complete pairing URL SHALL never be returned by the host profile API or serialized into the connection menu store. Enrollment SHALL run against the reconstructed session origin.

#### Scenario: Desktop enrols against the session origin

- **WHEN** Desktop accepts a hosted pairing URL
- **THEN** enrollment runs against the reconstructed session origin and never against `app.terminay.com`

#### Scenario: Fragment is not exposed by the profile API

- **WHEN** the host profile API returns a profile
- **THEN** it contains neither the pairing fragment nor the complete pairing URL

#### Scenario: Same server-side semantics from either host

- **WHEN** a device is enrolled from a browser or from Desktop
- **THEN** the server-side device and audit semantics are the same

### Requirement: Desktop enrollment is a closed host action

On Desktop, device enrollment SHALL be a closed host action: Electron SHALL perform device enrollment, store the device private key in its credential compartment, verify the selected server bundle, and replace the current document's byte lane only after the authenticated remote transport is ready. The renderer SHALL receive no pairing fragment and no private key.

#### Scenario: Byte lane swaps only when ready

- **WHEN** Desktop enrols a new remote connection
- **THEN** the current document's byte lane is replaced only after the authenticated remote transport is ready

#### Scenario: Renderer never sees the private key

- **WHEN** enrollment completes
- **THEN** the device private key stays in the Electron credential compartment

### Requirement: Exposing a server from a client host

Embedded Local servers SHALL accept only the private Desktop transport and SHALL NOT be advertised by default. **Expose this server…** SHALL be available only with server administrative capability. The flow SHALL configure and validate the PIN or approval policy, start WebRTC availability, and show a short-lived pairing URL and QR, expiry, relay state, paired devices, live connections, and revoke and stop controls. **Expose this server** SHALL NOT change which server the current window renders. The current Local MessagePort SHALL remain connected throughout exposure and SHALL never be presented as a selectable exposure route. Standalone server CLI and UI SHALL use the same exposure and trust model.

#### Scenario: No silent exposure

- **WHEN** an embedded Local server runs without an explicit exposure action
- **THEN** it accepts only the private Desktop transport and is not advertised

#### Scenario: Exposure does not switch the rendered server

- **WHEN** the user exposes the current server
- **THEN** the window continues rendering the same server

#### Scenario: Local transport is not an exposure route

- **WHEN** the exposure surface lists routes
- **THEN** the Local MessagePort is not offered as a selectable route and remains connected

### Requirement: Pairing link presentation during exposure

The visible server or session origin SHALL be non-secret metadata. **Copy pairing link** and the QR SHALL contain the complete short-lived fragment credential and expiry, and the UI SHALL NOT present the bare origin as a usable connection URL. Generating a fresh pairing room SHALL NOT disconnect existing clients.

#### Scenario: Bare origin is not offered as a connection URL

- **WHEN** the exposure surface shows the session origin
- **THEN** it is presented as non-secret metadata and not as a usable connection URL

#### Scenario: Fresh pairing room keeps clients connected

- **WHEN** the administrator generates a fresh pairing room
- **THEN** existing clients stay connected

### Requirement: Revoking a trusted browser

**Revoke** on a trusted browser SHALL immediately remove that device from the trusted-browser list and count. Revoked devices SHALL stay stored for reconnect rejection and SHALL NOT be shown as trusted. Stopping WebRTC exposure SHALL prevent new WebRTC reconnect and pairing and SHALL NOT stop the Local server or its private local workspace.

#### Scenario: Revoked device disappears from the trusted list

- **WHEN** a trusted browser is revoked
- **THEN** it is removed from the trusted-browser list and count immediately

#### Scenario: Revoked device is rejected on reconnect

- **WHEN** a revoked device attempts to reconnect
- **THEN** the stored revocation rejects it

#### Scenario: Stopping exposure keeps Local running

- **WHEN** WebRTC exposure is stopped
- **THEN** new pairing and reconnect are prevented while the Local server and its private workspace continue

### Requirement: Parity of Desktop and web workspace surfaces

Desktop and web SHALL render the same projects, panels, files, terminals, settings, recordings, agents, and connection state. Wide layouts SHALL resemble the Electron workspace. Narrow layouts SHALL replace wide tab strips and sidebars with accessible selectors, drawers, stacked surfaces, and touch controls while retaining the same server object ids. Native-only window operations SHALL be capability-gated, and web clients SHALL manage server-owned logical workspace views through in-page navigation rather than requiring popup windows.

#### Scenario: Narrow layout keeps server object ids

- **WHEN** the workspace renders at a narrow width
- **THEN** selectors, drawers, and stacked surfaces are used while server object ids stay the same

#### Scenario: Web needs no popup windows

- **WHEN** a web client manages a logical workspace view
- **THEN** it uses in-page navigation

### Requirement: Development and packaged Desktop parity

Development and packaged Desktop SHALL launch the same server-bundled workspace; development SHALL change only whether those generated assets are restored from the Turbo cache or rebuilt, and SHALL NOT change renderer entry, preload, state hydration, authority, or host-capability behaviour. The launched server-UI inventory SHALL contain only the current build's assets, so leftover hashed files from a previous rebuild cannot be published or launched.

#### Scenario: Stale assets are not published

- **WHEN** a rebuild replaces the server-UI assets
- **THEN** the launched inventory contains only the current build's assets

#### Scenario: Development changes no authority

- **WHEN** Desktop runs from source
- **THEN** renderer entry, preload, state hydration, authority, and host-capability behaviour match the packaged build

### Requirement: Desktop user-data namespace isolation

Source-development Desktop SHALL use a dedicated `Terminay Development` user-data namespace by default and SHALL NOT read, mutate, or silently attach to an installed Terminay release's persistence or embedded server authority. Tests and migration tooling MAY select an explicit isolated namespace with `TERMINAY_USER_DATA_DIR`; packaged releases SHALL retain the normal `Terminay` namespace. Each selected namespace SHALL own its durable opaque Local identity, Local profile route, server-UI partition, workspace, environment, and recording stores, and bundle cache. Historical embedded records using the former canonical Local id SHALL migrate only within their own namespace before normal server, project, and session validation, and a foreign server identity SHALL never be adopted or rewritten.

#### Scenario: Development does not touch the release namespace

- **WHEN** Desktop runs from source
- **THEN** it uses the `Terminay Development` namespace and does not read or mutate an installed release's persistence

#### Scenario: Foreign identity is never adopted

- **WHEN** an embedded record carries a server identity from another namespace
- **THEN** it is neither adopted nor rewritten

### Requirement: Shared management routes across hosts

Settings including Extensions, project environments, macros, recordings, remote control, and edit-tab surfaces SHALL use shared routes and components. Electron SHALL present Remote Control and Project Environments as first-class native management windows consistent with Settings, Macros, and Recordings, while edit-tab routes MAY use modal project-editor chrome. The web host SHALL present the same routes in-page with equivalent open, focus, save, cancel, and close semantics.

#### Scenario: Web presents the same routes in-page

- **WHEN** a web user opens Remote Control or Project Environments
- **THEN** the same route is presented in-page with equivalent open, focus, save, cancel, and close semantics

### Requirement: Shared tab editing command

Project-tab and terminal-tab editing SHALL be a shared command. Double-click and long-press SHALL open the same editor. On Desktop it MAY open the native modal edit window. In web it SHALL open the in-page edit-tab surface and return focus to the edited project or terminal after save or cancel without depending on popup windows.

#### Scenario: Double-click and long-press agree

- **WHEN** the user double-clicks or long-presses a project or terminal tab
- **THEN** the same editor opens

#### Scenario: Web returns focus after save or cancel

- **WHEN** a web user saves or cancels the edit-tab surface
- **THEN** focus returns to the edited project or terminal

### Requirement: Application menu per host

Browser hosts SHALL expose an in-page application menu bar for the shared workspace containing File, Edit, View, and Help menus with the same command vocabulary as the Desktop native menu wherever the browser has an equivalent capability. Native-only entries such as OS window management, Desktop update installation, native file dialogs, and DevTools SHALL remain absent or disabled unless the host capability exists. Desktop hosts SHALL advertise native menus and therefore omit the in-page application menu entirely. macOS native title-bar insets SHALL keep traffic lights separate from project tabs and workspace controls.

#### Scenario: Desktop omits the in-page menu

- **WHEN** a Desktop host renders the workspace
- **THEN** the in-page application menu bar is absent

#### Scenario: Native-only entries are hidden in the browser

- **WHEN** a browser host renders the application menu
- **THEN** OS window management, Desktop update installation, native file dialogs, and DevTools entries are absent or disabled

### Requirement: Disconnect semantics

**Disconnect** SHALL close the client transport and SHALL NOT stop the server or terminate its PTYs. On `app.terminay.com`, **File → Disconnect** and **Switch connections** SHALL return to the manager connection list, using `shell.back` when framed. Desktop SHALL have no Disconnect item; its native File menu SHALL remain Local and remote window management. Closing or reloading the host SHALL preserve server-side sessions.

#### Scenario: Disconnect leaves PTYs running

- **WHEN** a browser user disconnects
- **THEN** the client transport closes while the server and its PTYs continue

#### Scenario: Desktop File menu has no Disconnect

- **WHEN** a Desktop user opens File
- **THEN** there is no Disconnect item

### Requirement: Allowed and forbidden host-local profile data

Allowed host-local profile data SHALL be the stable server id or fingerprint, the exact non-secret session origin, the user label and explicitly shared server display name, created, last-opened, and last-connected timestamps, local window and view mapping and non-secret UI preferences, and known, offline, expired, revoked, archived, or unreachable state. Pairing URL fragments and full unconsumed pairing URLs, PINs, terminal tickets, server secrets, terminal output, command history, project roots, filenames, and recordings SHALL be forbidden in connection-manager `localStorage`, URLs, logs, and bookmark records. Device private keys SHALL never enter bookmark storage, `localStorage`, URLs, or logs; in the framed PWA they SHALL live only in the origin-keyed manager IndexedDB vault and in closed `postMessage` clones to the matching session iframe.

#### Scenario: Bookmark record excludes secrets

- **WHEN** a connection profile is written
- **THEN** it contains no pairing fragment, PIN, ticket, server secret, terminal output, command history, project root, filename, or recording

#### Scenario: Device key stays out of localStorage

- **WHEN** a framed PWA session holds a device key
- **THEN** it lives only in the origin-keyed manager IndexedDB vault and in closed clones to the matching iframe

### Requirement: Desktop persistence allowlist

Desktop persistence SHALL be a closed allowlist of sanitized profiles, protected credential references, native geometry and exact profile and view bindings, verified bundle-cache metadata, update state, OS permission decisions, and explicit device preferences. Workspace snapshots, application DTOs, project roots, panel and terminal state, server settings, and feature capability projections SHALL be forbidden in the host store. Unclassified fields SHALL fail closed.

#### Scenario: Unclassified field is rejected

- **WHEN** a field outside the allowlist is written to the Desktop host store
- **THEN** the write fails closed

#### Scenario: Workspace state stays server-owned

- **WHEN** Desktop persists host state
- **THEN** no workspace snapshot, application DTO, project root, panel or terminal state, server setting, or capability projection is stored

### Requirement: Connection failure behaviour

A failed remote connection SHALL remain bound to its selected server. Offline SHALL preserve the profile and device identity and offer Retry through the session origin's reconnect operation. Connection errors SHALL remain visible and terminal input SHALL remain disabled until the new client, subscriptions, workspace, and mounted terminal attachments have hydrated successfully. Missing or revoked device identity SHALL request a fresh pairing URL. If the host shell cannot safely load the server bundle, it SHALL show a typed diagnostic and leave the connection unopened.

#### Scenario: Failure does not rebind the window

- **WHEN** a remote connection fails
- **THEN** the window stays bound to its selected server

#### Scenario: Input stays disabled until hydration completes

- **WHEN** a replacement client is hydrating
- **THEN** connection errors stay visible and terminal input stays disabled

#### Scenario: Unsafe bundle leaves the connection unopened

- **WHEN** the host shell cannot safely load the server bundle
- **THEN** it shows a typed diagnostic and does not open the connection

### Requirement: Framed session liveness

A framed `app.terminay.com` session that has painted workspace chrome SHALL NOT be treated as connected unless live application events still arrive; later PTY, new projects, and new terminals are those events. Resume from background SHALL use the session origin's reconnect operation rather than a second unmanaged signaling join. While recovery runs, connection chrome SHALL show reconnecting and input SHALL stay disabled. Browser recovery SHALL restore ordered terminal input without duplicate PTYs or workspace mutations.

#### Scenario: Painted chrome is not proof of connection

- **WHEN** workspace chrome is painted but no live application events arrive
- **THEN** the session is not treated as connected

#### Scenario: Returning to a framed session resolves visibly

- **WHEN** the user returns to a framed PWA session
- **THEN** it reconnects or fails visibly and does not remain on the session loading mark with no in-flight generation

#### Scenario: Recovery does not duplicate state

- **WHEN** browser recovery completes
- **THEN** ordered terminal input is restored with no duplicate PTYs or workspace mutations

### Requirement: Connections and client hosts non-goals

There SHALL be no browser-owned Local Terminay server, no cloud account or cloud-synchronized connection list, no silent exposure of an embedded Local server, no arbitrary remote JavaScript with Electron or Node privileges, no requirement that browser UI use native popup windows, no independently versioned full workspace application at `app.terminay.com`, no renderer-selected `mode=electron` or equivalent privilege switch, and no Desktop feature client or persisted workspace mirror used to translate between remote server application versions.

#### Scenario: No cloud-synchronized connection list

- **WHEN** a user adds a connection on one device
- **THEN** it is stored host-locally and is not synchronized through a cloud account

#### Scenario: No translation layer between versions

- **WHEN** a Desktop host connects to a remote server
- **THEN** it uses that server's own bundle and holds no feature client or persisted workspace mirror to translate application versions
