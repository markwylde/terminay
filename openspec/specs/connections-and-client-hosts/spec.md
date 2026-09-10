# connections-and-client-hosts Specification

## Purpose

Terminay Desktop and browser clients share one server identity, device enrollment, and connection model, so that a user can add, remember, open, switch, inspect, expose, and forget Terminay Server connections from either host while each host shell stays a thin, capability-gated presenter of the selected server's bundled workspace.

## Requirements

### Requirement: Connection vocabulary

A **server connection** SHALL be an authenticated relationship with one stable Terminay Server identity. A **connection profile** SHALL be host-local metadata such as label, session origin, server identity or fingerprint, last-opened time, and status. A **connection window** SHALL be an Electron window or browser view bound to one **primary connection**, whose workspace UI bundle it runs, and zero or more **attached connections**, each optionally bound to one logical workspace view on its server. A window's **composition** SHALL be its attached set, the workspace view chosen per attached server, and its tab order, and SHALL be client-owned device-local presentation state. A **host shell** SHALL own connection bootstrap, protected credentials, verified bundle installation, and native or browser presentation, and SHALL NOT implement workspace features or interpret the application protocol. A **host capability** SHALL be one optional, versioned presentation or OS action supplied by a trusted shell to a bound server-bundled renderer.

#### Scenario: Host shell stays out of the application protocol

- **WHEN** a host shell carries application traffic for a bound renderer
- **THEN** it provides bootstrap, credentials, bundle installation, and presentation only
- **AND** it does not implement workspace features or interpret the application protocol

#### Scenario: Capabilities are negotiated, not assumed

- **WHEN** a server-bundled renderer needs a native action
- **THEN** it uses an individually negotiated, versioned host capability

#### Scenario: One primary and many attached connections

- **WHEN** a window holds three server connections
- **THEN** one of them is the primary whose bundle the window runs and the other two are attached connections

### Requirement: Header server control presentation

The header SHALL display a connections control naming the active tab's server label rather than the transport. Left of the label, an exposure control icon SHALL use the same colour as the label, showing a stop icon while that server is exposed and a play icon while it is not. Right of the label, a blue pill SHALL show the number of active remote connections on that server, and SHALL show nothing when that count is zero. The header SHALL report that server's profile label and status, including Local failure or offline state, and SHALL never show a transport name or the opaque session-id hostname. Browser sessions SHALL use the saved connection title, falling back to the pairing `hostName`.

#### Scenario: Exposure icon reflects state

- **WHEN** the active tab's server is exposed
- **THEN** the control left of the label is a stop icon in the label colour

#### Scenario: Connection pill hidden at zero

- **WHEN** there are no active remote connections on the active tab's server
- **THEN** no count pill is shown

#### Scenario: Label never shows the session hostname

- **WHEN** a browser session is connected to a remote server
- **THEN** the header shows the saved connection title, or the pairing `hostName`, and never the opaque session-id hostname

### Requirement: Connection menu contents

The connection menu SHALL list every attached connection with its label and status — connected, offline, reconnecting, unauthenticated, degraded, or incompatible — and SHALL offer **Attach** for a remembered connection that is not attached and **Detach** for one that is. On Desktop it SHALL list every remembered connection as a single line with **Local** first, where **Local** is always the attached primary. On a framed `app.terminay.com` session it SHALL list the framed primary and its attached connections, and SHALL NOT be a switcher for the manager's other saved profiles, because the manager owns the saved-profile list outside the iframe. The menu SHALL contain a manage control on the Connections heading that opens the same **Remote Control** surface as File → Remote Control; **Expose this server…** for a chosen attached server when the current device is allowed to manage that server's exposure; **Create pairing link** while that server is exposed; live **Active Connections** per attached server for every connected browser or Desktop peer, with empty copy using the same inset as other menu rows; retry and forget or revoke actions with distinct language inside Remote Control; and **Switch connections** only when the browser session can return to the `app.terminay.com` manager.

#### Scenario: Desktop menu lists remembered profiles

- **WHEN** a Desktop user opens the connection menu
- **THEN** every remembered connection is listed with **Local** first, each showing its attach state and status, and **Switch connections** is absent

#### Scenario: Framed menu shows only the current connection

- **WHEN** a framed `app.terminay.com` workspace opens its connection menu
- **THEN** it shows the framed primary with its attached connections and **Switch connections**, and not the manager's other saved profiles

#### Scenario: Exposure actions are capability-gated

- **WHEN** the current device is not allowed to manage exposure on the chosen attached server
- **THEN** **Expose this server…** is not offered for that server

#### Scenario: Attaching and detaching a server

- **WHEN** the user chooses **Attach** on a remembered connection and later **Detach** on it
- **THEN** that server's tabs join the window's composition and later leave it, and nothing on that server is stopped

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

### Requirement: Pair Device dialog

**Create pairing link** from the connection menu and from Remote Control SHALL open the same Pair Device dialog. Remote Control's Exposure header SHALL show that action next to **Stop exposure** while the server is exposed. The dialog SHALL show the one-time pairing link and a copy control, and SHALL NOT show the session-origin hostname. When a device requests enrollment, the dialog SHALL replace the QR with that device's name and match code and **Approve** and **Deny**, and SHALL restore a fresh QR after the decision. The pairing URL field SHALL stack at full width above continue and cancel actions.

#### Scenario: Dialog hides the session hostname

- **WHEN** the Pair Device dialog is open
- **THEN** it shows the one-time pairing link and copy control and not the session-origin hostname

#### Scenario: Same dialog from both entry points

- **WHEN** **Create pairing link** is chosen from the connection menu or from Remote Control
- **THEN** the same Pair Device dialog opens

#### Scenario: Request appears in place of the QR

- **WHEN** a device submits an enrollment request while the dialog shows the QR
- **THEN** the QR is replaced by the device name, match code, and Approve and Deny controls

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

### Requirement: Desktop user-data identity

A Desktop user-data root SHALL have one embedded Local server identity and MAY remember any number of remote profiles. On first use Desktop SHALL create an opaque random identity in that root and retain it across restart, and SHALL never derive authority from the application name, project name, path, window, or process. Two Desktop profiles, development or packaged installations, or test roots SHALL therefore remain separate even when their restored project and terminal ids are identical.

#### Scenario: Identity survives restart

- **WHEN** Desktop restarts
- **THEN** it reuses the opaque random identity stored in its user-data root

#### Scenario: Identical ids do not merge roots

- **WHEN** two Desktop roots hold identical restored project and terminal ids
- **THEN** they remain separate installations

### Requirement: Native window server binding

A native window SHALL be bound to exactly one primary connection and to a set of attached connections, and its title and security scope SHALL make those connections clear. Multiple windows MAY hold the same server and different logical workspace views, and other windows MAY simultaneously hold other attached sets. Selecting a remembered profile from the connection menu SHALL attach it to the current window, focus an existing window for that connection or view when appropriate, or open a new sandboxed window; a window SHALL NEVER silently rebind its primary, and rebinding SHALL be an explicit action rather than a side effect of menu selection or of a connection failure. Native window identity and server logical-view identity SHALL remain separate bindings, so focus or close does not mutate a logical view without a typed server command.

#### Scenario: Four windows across four servers

- **WHEN** four Electron windows hold different primary and attached connections
- **THEN** no server, project, or credential state crosses between them

#### Scenario: Menu selection does not rebind silently

- **WHEN** the user selects another profile from the connection menu
- **THEN** it is attached, or an existing window is focused or a new sandboxed window opens, and the window's primary is unchanged

### Requirement: Native window reload preserves binding

Reloading a native window SHALL preserve its exact primary binding and its attached set. Desktop SHALL discard every document-scoped byte channel, reconnect each remembered profile in the composition with its OS-protected credential, and transfer a fresh channel per connection to the new document. A reload SHALL never change which connection is primary merely because a renderer transport was destroyed with the previous document.

#### Scenario: Remote window reload stays remote

- **WHEN** a window with attached remote connections is reloaded
- **THEN** each remote profile reconnects with its OS-protected credential and a fresh channel per connection is transferred to the new document

### Requirement: Connection window loading state and startup phase line

A newly opened Desktop connection window SHALL remain in the normal loading state until its own local or remote server connection is ready. The loading state SHALL centre the Terminay mark in the window above a looping five-dot loading indicator, with five fixed, contrasting colours from the tab hue palette entering in sequence. Desktop packaging, browser metadata, and visible web surfaces SHALL use the same square mark geometry: a pure-black background with even horizontal and vertical padding around the white glyph. Beneath the indicator the loading state SHALL show a single short line: for local embedded-server startup it names the startup phase currently running, and for remote connections it carries that connection's short status message. The line SHALL be a bounded, product-authored string with no path, identifier, host, credential, or error detail, and it SHALL be visually subordinate to the mark and indicator. Native window controls SHALL never overlap the loading state.

#### Scenario: Remote loading shows a status message

- **WHEN** a remote connection window is loading
- **THEN** the mark, five-dot indicator, and a short status message are shown

#### Scenario: Local loading names the current phase

- **WHEN** the Local embedded server is starting
- **THEN** the mark and five-dot indicator are shown with a single short line naming the startup phase currently running
- **AND** that line carries no path, identifier, host, credential, or error detail

#### Scenario: Mark and indicator are unchanged by the line

- **WHEN** the phase line is shown, changes, or is absent
- **THEN** the mark geometry, the five dot colours, and their sequence are unaffected
- **AND** native window controls do not overlap the loading state

### Requirement: Startup paint sequence

At local Desktop startup, a self-contained native loading document SHALL paint the loading state immediately after Electron is ready, before workspace restoration, extension setup, or server initialization begins. The loading document SHALL finish painting and the native window SHALL be shown before that restoration starts. As startup phases advance, Desktop SHALL update the phase line in that document without granting it script execution or network access, and each update SHALL keep the dot animation in phase so the indicator never visibly restarts. Updating the phase line SHALL NOT delay the phase it names, and a failed update SHALL leave the previously painted loading state intact rather than blanking the window. The verified server UI SHALL replace the loading document once its session is ready, and its initial document SHALL paint the same loading state before the renderer bundle evaluates, keeping the dot animation in phase through that handoff so startup never presents an empty window or a visibly restarted loader. The originating window SHALL keep its existing server binding during that handoff.

#### Scenario: No empty window at startup

- **WHEN** Desktop starts and hands off from the native loading document to the server UI
- **THEN** the dot animation stays in phase and no empty window or restarted loader is shown

#### Scenario: Window is shown before restoration

- **WHEN** Electron becomes ready
- **THEN** the loading document paints and the window is shown before workspace restoration begins

#### Scenario: Phase line advances in place

- **WHEN** a startup phase ends and the next begins
- **THEN** the phase line names the new phase and the dot animation stays in phase
- **AND** the loading document still has no script execution or network access

#### Scenario: Phase update fails

- **WHEN** updating the phase line fails
- **THEN** the previously painted loading state remains visible
- **AND** the startup phase it would have named is not delayed

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

Desktop SHALL store non-secret profiles locally and credentials through OS-backed secure storage where available. A Desktop connection created from a pairing URL SHALL enrol a protected device key and save only the stable session origin as switchable profile metadata; one-time URLs SHALL never be stored or reused. A profile record SHALL contain only its stable server identity, exact session origin, display metadata, timestamps, and a diagnostic status; pairing fragments, device keys, terminal data, and filesystem paths SHALL NOT be profile fields. Desktop SHALL also persist each window's composition — its attached connection set, the workspace view chosen per attached server, and its tab order — as device-local presentation state alongside window geometry, and SHALL NOT send it to any server.

#### Scenario: Pairing URL is not persisted

- **WHEN** Desktop creates a connection from a pairing URL
- **THEN** only the stable session origin and sanitized metadata are saved, and the one-time URL is not stored

#### Scenario: Credentials use OS-backed storage

- **WHEN** Desktop enrols a device key
- **THEN** it is held through OS-backed secure storage where available and not in the profile record

#### Scenario: Composition is restored on the device

- **WHEN** Desktop restarts a window that had two attached servers in a chosen tab order
- **THEN** the attached set, per-server workspace view, and tab order are restored from device-local presentation state

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

Native actions SHALL be exposed through a versioned, source-bound host bridge. The host SHALL inject a frozen context containing the bridge version, host kind, the exact bound primary server and profile identity, the attached profile identities, and individually negotiated capabilities. A renderer SHALL NOT enable Desktop behaviour with a URL or query parameter, server payload, local setting, or claimed mode. Each request SHALL be checked against its bound window and the connection it names, SHALL reject unknown payload fields and any profile outside the window's composition, and SHALL require a user gesture for actions that can read or change native state.

#### Scenario: No renderer-selected privilege switch

- **WHEN** a renderer supplies a query parameter, server payload, local setting, or claimed mode requesting Desktop privileges
- **THEN** no Desktop behaviour is enabled

#### Scenario: Unknown fields are rejected

- **WHEN** a bridge request carries unknown payload fields
- **THEN** the request is rejected

#### Scenario: Native state changes need a gesture

- **WHEN** a bridge action can read or change native state
- **THEN** it requires a user gesture

#### Scenario: Request naming an unattached profile

- **WHEN** a bridge request names a profile outside the window's composition
- **THEN** the request is rejected

### Requirement: Bounded host bridge surface

The bridge surface SHALL be limited to semantic window and view focus, route presentation and close, menu commands, clipboard write, approved file selection, credential-free HTTP and HTTPS external links, server-owned reveal tokens, update status, notifications, a versioned `connections` capability, and explicitly declared OS integration. The `connections` capability SHALL list connection profiles with status, open a connection and return an opaque byte endpoint, close a connection, and let the renderer subscribe to connection status, and SHALL expose no credential, signaling state, or raw transport handle. The bridge SHALL never expose `BrowserWindow`, arbitrary paths, raw transport handles, generic IPC, or server application commands. Server-bundled renderers SHALL receive a `TerminayClient` byte endpoint per connection and a capability provider rather than Electron APIs. Its bridge SHALL contain no terminal data, pairing secrets, device keys, arbitrary filesystem paths, or generic Electron IPC.

#### Scenario: Bridge exposes no Electron internals

- **WHEN** a server-bundled renderer inspects its injected context
- **THEN** it finds byte endpoints and a capability provider, and no `BrowserWindow`, raw transport handle, generic IPC, or arbitrary path

#### Scenario: Malicious bundle gains nothing

- **WHEN** a malicious or compromised server bundle exercises the host bridge
- **THEN** it cannot obtain Electron Node access or another session origin's credentials

#### Scenario: Opening a connection through the capability

- **WHEN** the renderer asks the `connections` capability to open a remembered profile
- **THEN** it receives an opaque byte endpoint and no credential, signaling state, or raw transport handle

### Requirement: Canonical auxiliary route presentation

A shared UI SHALL request a route with a presentation disposition; Desktop MAY open or focus a native window while a browser uses an in-page route or browser tab. Settings, recordings, and project or terminal editors SHALL request the canonical auxiliary route controller exclusively and SHALL never probe ambient native-window globals; the presenter SHALL choose an in-page or native disposition from the negotiated host context. Project and terminal tab editors SHALL use the canonical in-page auxiliary dialog, whose shared route body owns the single visible heading and Save or Cancel journey; opening a separate Electron child window SHALL NOT be part of this contract.

#### Scenario: Editors use the canonical controller

- **WHEN** a project or terminal tab editor opens
- **THEN** it requests the canonical auxiliary route controller and does not probe ambient native-window globals

#### Scenario: Disposition comes from host context

- **WHEN** a route is requested with a presentation disposition
- **THEN** the presenter selects in-page or native presentation from the negotiated host context

### Requirement: Web connection host scope

`app.terminay.com` SHALL have no Local server option and SHALL never claim browser filesystem or PTY authority. Its disconnected state SHALL be a connection picker: a saved-profile list with **Add new connection**, which opens a dedicated page to scan a pairing QR or paste a pairing URL, plus rename, open, and forget actions. Selecting a profile SHALL frame it as the primary connection in the current PWA view, and an explicit action MAY open a first-party session tab. The manager SHALL also open attached connections on behalf of the framed primary, handing back one opaque byte endpoint per attached server, and an attached server SHALL deliver no bundle. The PWA SHALL contain connection-profile management, the framed session host, the origin-keyed credential vault, and attached-transport ownership, SHALL NOT run the workspace, and SHALL show at most one framed session at a time.

#### Scenario: Web host offers no Local option

- **WHEN** a browser user opens the connection manager
- **THEN** the same add, manage, and switch journey is available with no Local option

#### Scenario: One framed session at a time

- **WHEN** the user opens another saved profile
- **THEN** it replaces the currently framed session as the primary connection

#### Scenario: Manager opens an attached transport

- **WHEN** the framed primary asks to attach a saved server
- **THEN** the manager opens that server's transport with its vaulted credential and returns an opaque byte endpoint, and that server delivers no bundle

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

The stable session origin of a browser session's primary connection SHALL install that server's bounded workspace bundle after authentication. Bundle bytes, feature frames, pairing fragments, PINs, and connection tickets SHALL never enter the manager origin. Framed-session device credentials SHALL enter only the origin-keyed vault. `app.terminay.com` SHALL be the stable connection manager, and the primary connection's verified bundle SHALL render the workspace at its stable session origin. An attached server SHALL contribute no bundle bytes to any origin.

#### Scenario: Manager origin holds no bundle bytes

- **WHEN** a framed session installs a server bundle
- **THEN** the bytes are handled at the session origin and never enter the manager origin

#### Scenario: Attached server ships no bundle

- **WHEN** a server is attached to a framed session
- **THEN** it supplies a transport only and no bundle bytes are transferred for it

### Requirement: One responsive workspace implementation

The product SHALL have one full responsive workspace UI implementation: each server bundles it; Desktop loads it from its pinned embedded-server artifact and runs it for every connection; a browser session loads it through its primary connection's session origin and the existing verified asset flow; and it works standalone when the session URL is opened directly. Stable session origins SHALL run the server's exact bundled responsive UI.

#### Scenario: Direct session URL renders the workspace

- **WHEN** a session URL is opened directly
- **THEN** the server's bundled responsive UI runs standalone

#### Scenario: Every host loads the same implementation

- **WHEN** Desktop and a browser session each open a workspace
- **THEN** each runs one bundled workspace UI for all of that window's connections

### Requirement: Mobile viewport and keyboard behaviour

On mobile browsers, the workspace SHALL follow the visual viewport and resize the active terminal and surrounding content when the software keyboard appears. The focused terminal SHALL remain visible and interactive without trapping the page, and its previous geometry SHALL return when the keyboard is dismissed. Browser-chrome expansion and collapse SHALL relayout the complete terminal panel in both dimensions, and taking over an existing terminal SHALL NOT retain a stale compact viewport height after more vertical space becomes available.

#### Scenario: Keyboard appearance resizes the terminal

- **WHEN** the software keyboard appears on a mobile browser
- **THEN** the active terminal and surrounding content resize, the focused terminal stays visible and interactive, and the page is not trapped

#### Scenario: Takeover uses current viewport height

- **WHEN** an existing terminal is taken over after more vertical space becomes available
- **THEN** it relayouts to the current height rather than retaining a stale compact height

### Requirement: Remote code containment in Electron

Server-provided code inside Electron SHALL run with sandboxing, context isolation, Node integration disabled, and no ambient privileged preload. A minimal host bridge SHALL validate every native action. The Desktop shell SHALL resolve the bundle manifest and assets only on the window's primary connection's exact session origin. Same-origin bundle navigation SHALL be allowed; arbitrary origins, URL credentials or query state, new windows, downloads, permission prompts, and custom protocol handlers SHALL be denied by default. A privileged host MAY explicitly allow one guarded request through the native policy boundary. An attached connection SHALL deliver bytes over its endpoint only and SHALL NOT contribute script, asset, or navigation to the window.

#### Scenario: Off-origin navigation is denied

- **WHEN** a bundle attempts to navigate to an arbitrary origin
- **THEN** the navigation is denied

#### Scenario: Downloads and permission prompts are denied by default

- **WHEN** a bundle triggers a download, new window, permission prompt, or custom protocol handler
- **THEN** it is denied unless a privileged host explicitly allows that one guarded request

#### Scenario: Attached server contributes no code

- **WHEN** a server is attached to a window
- **THEN** it delivers application bytes over its endpoint and contributes no script, asset, or navigation

### Requirement: Bundle manifest compatibility

The bundle manifest SHALL declare compatible bootstrap, bundle-format, and host-bridge revisions plus required and optional host capabilities. The host SHALL check those bundle-to-host boundaries only. Missing optional capabilities SHALL use browser-equivalent in-page behaviour or a clear unavailable action. Missing required host compatibility SHALL block launch before committing connection state and SHALL identify whether the host or the bundle must be upgraded. A Desktop shell SHALL run a bundle only when its declared bootstrap, bundle format, byte transport, execution runtime, and required bridge contracts validate successfully.

#### Scenario: Incompatible bundle blocks launch

- **WHEN** required host compatibility is missing
- **THEN** launch is blocked before connection state is committed and the message identifies whether the host or the bundle must be upgraded

#### Scenario: Missing optional capability degrades gracefully

- **WHEN** an optional host capability is absent
- **THEN** the route uses browser-equivalent in-page behaviour or shows a clear unavailable action

### Requirement: Renderer context contents

The resulting renderer context SHALL contain only non-secret identity, negotiated versions and capabilities, and one opaque byte-endpoint handle per open connection with the sanitized identity of the server it reaches. Bootstrap credentials, signaling state, transport objects, protected keys, and raw cache paths SHALL remain in Desktop main.

#### Scenario: Renderer holds no secrets

- **WHEN** a renderer inspects its context
- **THEN** it finds non-secret identity, negotiated versions and capabilities, and opaque byte-endpoint handles only

#### Scenario: One endpoint per connection

- **WHEN** a window holds a primary and two attached connections
- **THEN** the renderer context carries three opaque byte-endpoint handles, each with its own sanitized server identity

### Requirement: Pending approval surface

While a device awaits approval, the exposure surface in Remote Control, the Pair Device dialog, and the standalone CLI SHALL show the requested device name and the five-character match code with **Approve** and **Deny**. Desktop SHALL also raise a native notification naming the device so the administrator notices a request made while the dialog is closed. Approve and Deny SHALL act only on the exact pending request they were rendered for; a request that expired or was replaced SHALL show as such rather than approving a different one.

#### Scenario: Approval from the notification

- **WHEN** the administrator activates the pending-approval notification
- **THEN** Remote Control opens on the pending request with its match code and controls

#### Scenario: Stale approval is inert

- **WHEN** the administrator approves a request that has already expired
- **THEN** nothing is enrolled and the surface reports the request expired

### Requirement: Browser connection journeys

Terminay SHALL support two browser entry journeys — opening the hosted pairing link and the `app.terminay.com` PWA add flow — and both SHALL use the same session-origin pairing, credential, server-bundle, and reconnect contracts. Opening the advertised hosted URL SHALL land on the manager, which consumes the fragment in memory, strips query and hash from the visible URL, and asks **Save and connect** with an optional title prefilled from `hostName` or the session id; Cancel SHALL discard the material and Confirm SHALL write the bookmark and frame `https://<session-id>.terminay.com/v1/#<secret>` without storing the fragment. The framed session origin SHALL establish WebRTC, verify and launch that server's bundle as the window's one workspace bundle, create the device key, submit enrollment, display the match code while awaiting host approval, and complete enrollment, storing that key in the manager vault for `event.origin` when framed. First pairing with any server SHALL happen at that server's own session origin, whether it later serves as a primary or an attached connection. A later visit to the saved profile or the stable session origin SHALL reconnect without reuse of the pairing URL. A first-party visit to a session-origin `/v1/` pairing URL SHALL enrol at the session origin with session-origin IndexedDB.

#### Scenario: Both journeys share one prompt

- **WHEN** the user opens a hosted pairing link in a browser or scans or pastes it inside the PWA
- **THEN** the same **Save and connect** prompt appears and enrollment is framed at the session origin

#### Scenario: Returning to the manager restores the profile

- **WHEN** the user returns to the manager after a framed session
- **THEN** the iframe unloads and the saved profile is restored from local browser storage

#### Scenario: Saved connection reconnects from the vault

- **WHEN** the user selects the saved connection later
- **THEN** its stable session origin is framed, receives its device credential from the manager vault, and reconnects without a pairing URL

#### Scenario: Pairing a server that will be attached

- **WHEN** the user pairs a new server intending to attach it to an existing framed session
- **THEN** first pairing runs at that server's own session origin before it can be attached

### Requirement: Manager is not part of the credential path

The manager SHALL NOT participate in approval or match-code display and SHALL never receive the connection ticket, terminal data, or workspace data. A missing or revoked device identity SHALL request a newly generated pairing URL. The saved manager profile SHALL remain until the user chooses **Forget**.

#### Scenario: Manager never sees the PIN or ticket

- **WHEN** enrollment or reconnect runs in a framed session
- **THEN** the manager receives no match code, approval decision, connection ticket, terminal data, or workspace data

#### Scenario: Revoked identity requests re-pairing

- **WHEN** the device identity is missing or revoked
- **THEN** a newly generated pairing URL is requested and the saved profile is retained

### Requirement: Browser enrollment prompt behaviour

Browser connection and device-enrollment prompts SHALL use the same centered, responsive modal surface and form controls as the rest of the disconnected browser host. Enrollment SHALL require a non-empty device name before enabling its primary action, SHALL then show the five-character match code with the instruction to confirm it on the exposing computer, and SHALL remain fully inset from the viewport at narrow sizes. Starting a fresh pairing flow SHALL NOT show a missing-saved-credential warning; enrollment errors SHALL appear only after an enrollment attempt fails or is denied.

#### Scenario: Primary action gated on valid input

- **WHEN** the device name is empty
- **THEN** the primary enrollment action stays disabled

#### Scenario: Match code shown while awaiting approval

- **WHEN** the enrollment request has been sent
- **THEN** the prompt shows the match code and waits for the host decision

#### Scenario: Fresh pairing shows no credential warning

- **WHEN** the user starts a fresh pairing flow
- **THEN** no missing-saved-credential warning is shown and errors appear only after a failed or denied enrollment attempt

### Requirement: Desktop add-connection parity

Desktop **Add connection** SHALL accept the same pairing URL, including hosted `app.terminay.com` links and direct standalone links whose origin is a server's own HTTPS signaling listener, even when that URL would otherwise open a browser. It SHALL never pair against the manager origin. Browser and Desktop flows SHALL produce the same server-side device and audit semantics and SHALL use the same transport-authenticated data-channel enrollment. The Desktop connection host SHALL consume the pairing fragment in memory; hosted and direct links MAY carry non-secret `s`, `hostName`, and `pairingExpiresAt` query fields while pairing secrets stay in the fragment. Desktop SHALL show the match code in its Add connection dialog while awaiting host approval. It SHALL persist only the exact session or direct origin plus sanitized profile metadata with a default label from `hostName`. The fragment and complete pairing URL SHALL never be returned by the host profile API or serialized into the connection menu store. Enrollment SHALL run against the reconstructed session origin or the direct origin over the transport-authenticated WebRTC channels; Desktop SHALL NOT send pairing material to a direct origin over HTTPS.

#### Scenario: Desktop enrols against the session origin

- **WHEN** Desktop accepts a hosted pairing URL
- **THEN** enrollment runs against the reconstructed session origin and never against `app.terminay.com`

#### Scenario: Desktop enrols against a direct origin

- **WHEN** Desktop accepts a direct standalone pairing URL
- **THEN** it opens signaling at that origin's `/signal`, verifies the signed transport transcript, and completes enrollment on the data channels
- **AND** no pairing token, device key, or ticket is sent over HTTPS

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

Embedded Local servers SHALL accept only the private Desktop transport and SHALL NOT be advertised by default. **Expose this server…** SHALL be available only with server administrative capability. The flow SHALL start WebRTC availability and show a short-lived pairing URL and QR, expiry, relay state, pending approvals, paired devices, live connections, and approve, deny, revoke, reset-identity, and stop controls. **Expose this server** SHALL NOT change which server the current window renders. The current Local MessagePort SHALL remain connected throughout exposure and SHALL never be presented as a selectable exposure route. Standalone server CLI and UI SHALL use the same exposure and trust model.

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

Desktop and web SHALL render the same projects, panels, files, terminals, settings, recordings, agents, and connection state. Wide layouts SHALL resemble the Electron workspace. Narrow layouts SHALL replace wide tab strips and sidebars with accessible selectors, drawers, stacked surfaces, and touch controls while retaining the same server object ids. A narrow-layout navigation drawer SHALL occupy the full height available to the workspace rather than a fixed fraction of the viewport, and SHALL overlay the workspace content rather than reducing the height allotted to it. Native-only window operations SHALL be capability-gated, and web clients SHALL manage server-owned logical workspace views through in-page navigation rather than requiring popup windows.

#### Scenario: Narrow layout keeps server object ids

- **WHEN** the workspace renders at a narrow width
- **THEN** selectors, drawers, and stacked surfaces are used while server object ids stay the same

#### Scenario: Narrow navigation drawer fills the viewport

- **WHEN** workspace navigation is opened at a narrow width
- **THEN** the drawer occupies the full height available to the workspace
- **AND** the workspace content is overlaid rather than compressed

#### Scenario: Web needs no popup windows

- **WHEN** a web client manages server-owned logical workspace views
- **THEN** it uses in-page navigation rather than requiring popup windows

### Requirement: Development and packaged Desktop parity

Development and packaged Desktop SHALL launch the same server-bundled workspace; development SHALL change only whether those generated assets are restored from the Turbo cache or rebuilt, and SHALL NOT change renderer entry, preload, state hydration, authority, or host-capability behaviour. The launched server-UI inventory SHALL contain only the current build's assets, so leftover hashed files from a previous rebuild cannot be published or launched.

#### Scenario: Stale assets are not published

- **WHEN** a rebuild replaces the server-UI assets
- **THEN** the launched inventory contains only the current build's assets

#### Scenario: Development changes no authority

- **WHEN** Desktop runs from source
- **THEN** renderer entry, preload, state hydration, authority, and host-capability behaviour match the packaged build

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

**Disconnect** SHALL close a connection's client transport and SHALL NOT stop the server or terminate its PTYs. **Detach** SHALL remove a server from the window's composition, dropping its tabs from the strip and closing its transport, and SHALL close nothing on the server itself. On `app.terminay.com`, **File → Disconnect** and **Switch connections** SHALL close the primary connection and return to the manager connection list, using `shell.back` when framed. Desktop SHALL have no Disconnect item; its native File menu SHALL remain Local and remote window management. Closing or reloading the host SHALL preserve server-side sessions.

#### Scenario: Disconnect leaves PTYs running

- **WHEN** a browser user disconnects
- **THEN** the client transport closes while the server and its PTYs continue

#### Scenario: Desktop File menu has no Disconnect

- **WHEN** a Desktop user opens File
- **THEN** there is no Disconnect item

#### Scenario: Detach removes tabs without touching the server

- **WHEN** the user detaches an attached server
- **THEN** its tabs leave the composition and its terminals, projects, and PTYs on that server are untouched

### Requirement: Allowed and forbidden host-local profile data

Allowed host-local profile data SHALL be the stable server id or fingerprint, the exact non-secret session origin, the user label and explicitly shared server display name, created, last-opened, and last-connected timestamps, local window and view mapping, window composition consisting of the attached connection set, the workspace view chosen per attached server, and tab order, non-secret UI preferences, and known, offline, expired, revoked, archived, or unreachable state. Pairing URL fragments and full unconsumed pairing URLs, PINs, terminal tickets, server secrets, terminal output, command history, project roots, filenames, and recordings SHALL be forbidden in connection-manager `localStorage`, URLs, logs, and bookmark records. Device private keys SHALL never enter bookmark storage, `localStorage`, URLs, or logs; in the framed PWA they SHALL live only in the origin-keyed manager IndexedDB vault and in closed `postMessage` clones to the matching session iframe.

#### Scenario: Bookmark record excludes secrets

- **WHEN** a connection profile is written
- **THEN** it contains no pairing fragment, PIN, ticket, server secret, terminal output, command history, project root, filename, or recording

#### Scenario: Device key stays out of localStorage

- **WHEN** a framed PWA session holds a device key
- **THEN** it lives only in the origin-keyed manager IndexedDB vault and in closed clones to the matching iframe

#### Scenario: Composition holds identities and order only

- **WHEN** a window's composition is written host-locally
- **THEN** it holds server ids, view ids, and tab order, and no project root, filename, or workspace content

### Requirement: Desktop persistence allowlist

Desktop persistence SHALL be a closed allowlist of sanitized profiles, protected credential references, native geometry, exact primary and attached profile and view bindings, window composition and tab order, update state, OS permission decisions, and explicit device preferences. Workspace snapshots, application DTOs, project roots, panel and terminal state, server settings, and feature capability projections SHALL be forbidden in the host store. Unclassified fields SHALL fail closed.

#### Scenario: Unclassified field is rejected

- **WHEN** a field outside the allowlist is written to the Desktop host store
- **THEN** the write fails closed

#### Scenario: Workspace state stays server-owned

- **WHEN** Desktop persists host state
- **THEN** no workspace snapshot, application DTO, project root, panel or terminal state, server setting, or capability projection is stored

### Requirement: Connection failure behaviour

A failed connection SHALL remain part of the window's composition and SHALL keep its tabs in the strip, greyed and inert. Offline, reconnecting, unauthenticated, and incompatible states SHALL each be shown per connection, SHALL preserve the profile and device identity, and SHALL offer Retry through that server's session origin reconnect operation. Connection errors SHALL remain visible and that connection's terminal input SHALL remain disabled until its new client, subscriptions, workspace, and mounted terminal attachments have hydrated successfully; other connections in the same window SHALL be unaffected. Missing or revoked device identity SHALL request a fresh pairing URL for that server. If the host shell cannot safely load the workspace bundle, it SHALL show a typed diagnostic and leave the window unopened.

#### Scenario: Failure does not rebind the window

- **WHEN** a connection fails
- **THEN** it stays in the window's composition with its tabs greyed and inert, and the window's primary binding is unchanged

#### Scenario: Input stays disabled until hydration completes

- **WHEN** a replacement client for one connection is hydrating
- **THEN** that connection's errors stay visible and its terminal input stays disabled while other connections keep working

#### Scenario: Unsafe bundle leaves the connection unopened

- **WHEN** the host shell cannot safely load the workspace bundle
- **THEN** it shows a typed diagnostic and does not open the window

### Requirement: Framed session liveness

A framed `app.terminay.com` session that has painted workspace chrome SHALL NOT be treated as connected unless live application events still arrive; later PTY, new projects, and new terminals are those events. Resume from background SHALL use the session origin's reconnect operation rather than a second unmanaged signaling join, and SHALL prove liveness when the document becomes visible rather than waiting for the next scheduled liveness probe. While recovery runs, connection chrome SHALL show reconnecting and input SHALL stay disabled. Browser recovery SHALL restore ordered terminal input without duplicate PTYs or workspace mutations.

The session origin's reconnect operation SHALL only ever yield a transport that is open. A generation whose application transport is closed or failed SHALL NOT satisfy a reconnect request, whichever side observed the loss first: the reconnect operation SHALL replace that generation and yield the replacement's transport. A client that asks to reconnect because it observed its own transport die SHALL NOT be given that same transport back.

Browser recovery SHALL continue until it reconnects or the session is left. A recovery attempt that fails or times out SHALL schedule a further attempt with bounded backoff, and SHALL keep the reconnecting state visible while it does. A failed attempt SHALL NOT leave the session idle awaiting a manual action; an explicit retry action SHALL remain available and SHALL start the next attempt immediately.

Recovery SHALL be presented as one steady reconnecting surface. Whether a session is recovering SHALL be decided by whether it has ever been connected, not by whether a connection currently exists, so no attempt after the first is presented as a cold connect. The most recent attempt's error SHALL stay visible until an attempt succeeds, and a single attempt SHALL NOT change the presented phase on its own.

#### Scenario: Painted chrome is not proof of connection

- **WHEN** workspace chrome is painted but no live application events arrive
- **THEN** the session is not treated as connected

#### Scenario: Returning to a framed session resolves visibly

- **WHEN** the user returns to a framed PWA session
- **THEN** it reconnects or fails visibly and does not remain on the session loading mark with no in-flight generation

#### Scenario: Recovery does not duplicate state

- **WHEN** browser recovery completes
- **THEN** ordered terminal input is restored with no duplicate PTYs or workspace mutations

#### Scenario: Reconnect never yields a dead transport

- **WHEN** a client asks the session origin to reconnect while the current generation's application transport is already closed or failed
- **THEN** that generation is replaced and the client receives the replacement generation's open transport

#### Scenario: A failed recovery attempt keeps trying

- **WHEN** a recovery attempt fails or times out
- **THEN** a further attempt is scheduled with bounded backoff, the reconnecting state stays visible, and the session does not wait for a manual action to try again

#### Scenario: Recovery survives a relay that is briefly unreachable

- **WHEN** the signaling relay does not answer for the duration of several recovery attempts and then answers again
- **THEN** a later attempt establishes a new generation and the workspace reconnects with its document and installed bundle intact

#### Scenario: A frozen document reconnects when it is shown again

- **WHEN** a backgrounded session is frozen, its transport dies while it sleeps, and the document is shown again
- **THEN** liveness is proven immediately, recovery runs against the session origin's reconnect operation, and the workspace reconnects without reloading the document or reinstalling the bundle

#### Scenario: Repeated failures keep one reconnecting surface

- **WHEN** several recovery attempts fail in a row after the session has been connected once
- **THEN** every attempt is presented as reconnecting, none as a cold connect, and the most recent error stays visible until an attempt succeeds

### Requirement: Connections and client hosts non-goals

There SHALL be no browser-owned Local Terminay server, no cloud account or cloud-synchronized connection list, no silent exposure of an embedded Local server, no arbitrary remote JavaScript with Electron or Node privileges, no requirement that browser UI use native popup windows, no independently versioned full workspace application at `app.terminay.com`, no renderer-selected `mode=electron` or equivalent privilege switch, and no Desktop feature client or persisted workspace mirror used to translate between server application versions.

#### Scenario: No cloud-synchronized connection list

- **WHEN** a user adds a connection on one device
- **THEN** it is stored host-locally and is not synchronized through a cloud account

#### Scenario: No translation layer between versions

- **WHEN** a host connects to a server whose protocol the bundle's client cannot satisfy
- **THEN** the connection is reported incompatible and the host holds no feature client or persisted workspace mirror to translate application versions

### Requirement: One workspace bundle per window

A window SHALL run exactly one workspace UI bundle, and that bundle SHALL be the sole workspace renderer for connections, Git, agents, folders, and terminals across every connection the window holds. Desktop development, packaged Desktop, and auxiliary routes SHALL execute the same bundled route bodies against the authenticated client of the connection the route belongs to. Desktop SHALL use the same production server-UI window composition for every startup, with no second workspace-window owner. A window SHALL NOT load a second workspace bundle in order to reach an attached server.

#### Scenario: Auxiliary routes use the window's bundle

- **WHEN** Desktop opens an auxiliary route for an attached server
- **THEN** the window's single bundle executes that route body against that connection's authenticated client

#### Scenario: Development and packaged builds render identically

- **WHEN** Desktop runs in development or packaged form
- **THEN** the same bundled workspace renders

#### Scenario: Attaching a server loads no second bundle

- **WHEN** a second server is attached to a window
- **THEN** the window keeps running its one bundle and opens a connection to that server

### Requirement: Desktop runs its packaged bundle for every connection

Desktop SHALL launch the workspace bundle read from its pinned embedded-server artifact, and SHALL run that bundle for the primary Local connection and for every attached remote connection. A remote connection profile SHALL supply a transport, and SHALL NOT supply workspace bundle bytes. Desktop SHALL NOT open a public listener or an asset download in order to obtain a bundle.

#### Scenario: Attached remote connection runs the packaged bundle

- **WHEN** a Desktop window attaches a remote profile
- **THEN** the window keeps running the bundle from its pinned embedded-server artifact and the remote profile supplies only a transport

#### Scenario: Same bundle across a window's connections

- **WHEN** a Desktop window holds a Local primary connection and two attached remote connections
- **THEN** all three are served by one bundle id, differing only in transport and connection identity

### Requirement: Server compatibility is negotiated by the bundle's client

The bundle manifest SHALL declare the application-protocol version range and the server capabilities the bundle's client requires, and MAY declare optional server capabilities. The client SHALL carry both in its hello, the server SHALL answer with its protocol version and capability set, and the client SHALL classify each connection as **compatible**, **degraded** when an optional capability is absent, or **incompatible** when the protocol range or a required capability is unsatisfied. An incompatible connection SHALL stay attached with its tabs rendered greyed and inert, SHALL state the server's version and which side must be upgraded, and SHALL receive no application operation. A degraded connection SHALL keep working with the affected surface presented as unavailable. The host SHALL NOT evaluate this negotiation.

#### Scenario: Incompatible server stays attached and inert

- **WHEN** an attached server answers the hello outside the bundle's declared protocol range
- **THEN** its tabs render greyed with the server's version and the side that must be upgraded, and no operation is sent to it

#### Scenario: Optional capability absent

- **WHEN** an attached server declares every required capability but omits an optional one
- **THEN** the connection is degraded, remains usable, and the affected surface shows as unavailable

#### Scenario: Host stays out of the negotiation

- **WHEN** a connection is classified
- **THEN** the classification is computed by the bundle's client and the host evaluates only bundle-to-host boundaries

### Requirement: Desktop bundle commitment from the packaged artifact

Desktop SHALL commit a native window only after the bundle inventory read from its pinned embedded-server artifact has been verified, its host compatibility requirements accepted, and the window's primary binding reserved. The artifact SHALL be read directly, without a public listener and without a network fetch. An incomplete or invalid inventory SHALL leave the window uncommitted with a typed diagnostic.

#### Scenario: Verification precedes window commitment

- **WHEN** Desktop prepares a window
- **THEN** it commits the window only after verifying the packaged bundle inventory and accepting its host compatibility requirements

#### Scenario: Invalid inventory leaves the window uncommitted

- **WHEN** the packaged bundle inventory is incomplete or invalid
- **THEN** the window stays uncommitted and a typed diagnostic is shown

### Requirement: Connections route contract for a window's connections

The production shared Connections route SHALL accept the host-local `ConnectionProfileStore` and narrow callbacks for attaching, detaching, server revocation, exposure, pairing, and rename. It SHALL keep forget explicitly separate from revoke with different confirmation copy and SHALL never write a pairing URL into profile metadata. Unsupported actions SHALL stay absent or disabled. The production Desktop server-UI bridge SHALL supply a sanitized profile snapshot and source-bound actions, SHALL reject profiles outside the window's host context, SHALL allow exposure only for a connection attached to that window, and SHALL consume pairing credentials without retaining them. Final persisted profile and window-registry callbacks SHALL use the exact `openProfileWindow` selection, flush host-local writes before returning, and separate detach and forget from server revocation. The connected shared workspace SHALL enable the Connections route for every authenticated attached server.

#### Scenario: Foreign profile is rejected

- **WHEN** the bridge receives a profile outside the window's host context
- **THEN** it rejects that profile

#### Scenario: Exposure limited to attached connections

- **WHEN** exposure is requested for a connection that is not attached to the window
- **THEN** it is not allowed

#### Scenario: Exposure of an attached server

- **WHEN** exposure is requested for a server attached to the window
- **THEN** that server exposes itself and no other attached server's exposure changes

#### Scenario: Host-local writes flush before return

- **WHEN** a profile or window-registry callback completes
- **THEN** host-local writes are flushed before it returns
