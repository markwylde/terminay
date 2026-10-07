## MODIFIED Requirements

### Requirement: Header server control presentation

The header SHALL display a connections control naming the window's server label rather than the transport, followed by a chevron that opens the connection menu. The control SHALL NOT carry an exposure icon or a connection-count pill; exposure state and active connections are shown by the workspace status bar and started or stopped from the connection menu. The control's accessible name SHALL still state whether that server is exposed and how many remote connections are active. The header SHALL report that server's profile label and status, including Local failure or offline state, and SHALL never show a transport name or the opaque session-id hostname. Browser sessions SHALL use the saved connection title, falling back to the pairing `hostName`.

#### Scenario: Exposure icon reflects state

- **WHEN** the window's server is exposed
- **THEN** the header control shows the server label and chevron with no exposure icon, and the workspace status bar dot reflects the exposure state

#### Scenario: Connection pill hidden at zero

- **WHEN** the window's server has any number of active remote connections, including zero
- **THEN** the header control shows no count pill, and the workspace status bar carries the connection count

#### Scenario: Accessible name carries the state

- **WHEN** the window's server is not exposed
- **THEN** the header control's accessible name states that it is offline

#### Scenario: Label never shows the session hostname

- **WHEN** a browser session is connected to a remote server
- **THEN** the header shows the saved connection title, or the pairing `hostName`, and never the opaque session-id hostname

### Requirement: Native window reload preserves binding

Reloading a native window SHALL preserve the exact server it is bound to. Desktop SHALL discard the document-scoped byte channel, reconnect the remembered profile with its OS-protected credential where the server is remote, and transfer a fresh channel to the new document. A reload SHALL never change which server a window shows merely because a renderer transport was destroyed with the previous document.

#### Scenario: Remote window reload stays remote

- **WHEN** a window showing a remote server is reloaded
- **THEN** that profile reconnects with its OS-protected credential and a fresh channel is transferred to the new document

### Requirement: Connection failure behaviour

A failed connection SHALL be a state of the whole window: the window stays bound to its server and presents that server's connection state in place of a usable workspace. Offline, reconnecting, unauthenticated, and incompatible states SHALL each be shown, SHALL preserve the profile and device identity, and SHALL offer Retry through that server's session origin reconnect operation. Connection errors SHALL remain visible and terminal input SHALL remain disabled until the new client, subscriptions, workspace, and mounted terminal attachments have hydrated successfully. While a Desktop window's server is unavailable, the connection menu SHALL stay usable so the person can switch the window to another server. Missing or revoked device identity SHALL request a fresh pairing URL for that server. If the host shell cannot safely load the workspace bundle, it SHALL show a typed diagnostic and leave the window unopened.

#### Scenario: Failure does not rebind the window

- **WHEN** a window's connection fails
- **THEN** the window shows that server's connection state and stays bound to it

#### Scenario: Input stays disabled until hydration completes

- **WHEN** a replacement client is hydrating
- **THEN** the errors stay visible and terminal input stays disabled

#### Scenario: Leaving an unreachable server

- **WHEN** a Desktop window's server is offline
- **THEN** the person can open the connection menu and switch the window to Local

#### Scenario: Unsafe bundle leaves the connection unopened

- **WHEN** the host shell cannot safely load the workspace bundle
- **THEN** it shows a typed diagnostic and does not open the window

### Requirement: Desktop enrollment is a closed host action

On Desktop, device enrollment SHALL be a closed host action: Electron SHALL perform device enrollment, store the device private key in its credential compartment, and save the server's profile. Once the authenticated remote transport is ready, Electron SHALL switch the workspace window from which Remote Control was opened to the new server. The Remote Control window SHALL remain Remote Control and SHALL list the new server. The renderer SHALL receive no pairing fragment and no private key.

#### Scenario: Byte lane swaps only when ready

- **WHEN** Desktop enrols a new remote server
- **THEN** the workspace window keeps its current server until the authenticated remote transport is ready

#### Scenario: Pairing switches the workspace window

- **WHEN** Desktop enrols a new remote server from Remote Control
- **THEN** the workspace window that opened Remote Control shows the new server once its authenticated transport is ready
- **AND** Remote Control is still Remote Control

#### Scenario: Renderer never sees the private key

- **WHEN** enrollment completes
- **THEN** the device private key stays in the Electron credential compartment

#### Scenario: The first connection fails

- **WHEN** enrollment succeeds but the first connection to the new server fails
- **THEN** the server is saved, the workspace window stays on the server it was showing, and the failure is reported in Remote Control

### Requirement: Bounded host bridge surface

The bridge surface SHALL be limited to semantic window and view focus, route presentation and close, menu commands, clipboard write, approved file selection, credential-free HTTP and HTTPS external links, server-owned reveal tokens, update status, notifications, a versioned `connections` capability, and explicitly declared OS integration. The `connections` capability SHALL list the remembered connection profiles by id and label, rename a profile, forget a profile, switch the requesting window to a remembered profile, open a remembered profile in a new window, and let the renderer subscribe to changes of that list, and SHALL expose no credential, signaling state, or raw transport handle. The bridge SHALL never expose `BrowserWindow`, arbitrary paths, raw transport handles, generic IPC, or server application commands. Server-bundled renderers SHALL receive one `TerminayClient` byte endpoint, reaching the window's server, and a capability provider rather than Electron APIs. Its bridge SHALL contain no terminal data, pairing secrets, device keys, arbitrary filesystem paths, or generic Electron IPC.

#### Scenario: Bridge exposes no Electron internals

- **WHEN** a server-bundled renderer inspects its injected context
- **THEN** it finds one byte endpoint and a capability provider, and no `BrowserWindow`, raw transport handle, generic IPC, or arbitrary path

#### Scenario: Malicious bundle gains nothing

- **WHEN** a malicious or compromised server bundle exercises the host bridge
- **THEN** it cannot obtain Electron Node access or another session origin's credentials

#### Scenario: Opening a connection through the capability

- **WHEN** the renderer asks the `connections` capability to open a remembered profile in a new window
- **THEN** the host opens a window bound to that profile, and the requesting renderer receives no byte endpoint for it and no credential, signaling state, or raw transport handle

#### Scenario: Switching through the capability

- **WHEN** the renderer asks the `connections` capability to switch its window to a remembered profile
- **THEN** the host performs the switch and the renderer receives only success or a failure reason

### Requirement: One responsive workspace implementation

The product SHALL have one full responsive workspace UI implementation: each server bundles it; Desktop loads it from its pinned embedded-server artifact and runs it for every window; a browser session loads it through its server's session origin and the existing verified asset flow; and it works standalone when the session URL is opened directly. Stable session origins SHALL run the server's exact bundled responsive UI.

#### Scenario: Direct session URL renders the workspace

- **WHEN** a session URL is opened directly
- **THEN** the server's bundled responsive UI runs standalone

#### Scenario: Every host loads the same implementation

- **WHEN** Desktop and a browser session each open a workspace
- **THEN** each runs one bundled workspace UI for its window's server

### Requirement: Renderer context contents

The resulting renderer context SHALL contain only non-secret identity, negotiated versions and capabilities, one opaque byte-endpoint handle for the window's server with the sanitized identity of that server, the id of the one profile the window is bound to, and the sanitized list of remembered profiles for the connection menu, each carrying its id and label only. Bootstrap credentials, signaling state, transport objects, protected keys, and raw cache paths SHALL remain in Desktop main.

#### Scenario: Renderer holds no secrets

- **WHEN** a renderer inspects its context
- **THEN** it finds non-secret identity, negotiated versions and capabilities, remembered profile labels, and one opaque byte-endpoint handle only

#### Scenario: One endpoint per connection

- **WHEN** a window is bound to a server
- **THEN** the renderer context carries exactly one opaque byte-endpoint handle, with that server's sanitized identity

#### Scenario: Remembered profiles are labels only

- **WHEN** a window shows Local while two remote servers are remembered
- **THEN** the renderer context lists those two profiles by id and label, and carries no byte endpoint, status, or workspace content for them

### Requirement: Desktop persistence allowlist

Desktop persistence SHALL be a closed allowlist of sanitized profiles, protected credential references, native geometry, the exact profile and view binding of each window, update state, OS permission decisions, and explicit device preferences. Workspace snapshots, application DTOs, project roots, panel and terminal state, server settings, and feature capability projections SHALL be forbidden in the host store. Unclassified fields SHALL fail closed.

#### Scenario: Unclassified field is rejected

- **WHEN** a field outside the allowlist is written to the Desktop host store
- **THEN** the write fails closed

#### Scenario: Workspace state stays server-owned

- **WHEN** Desktop persists host state
- **THEN** no workspace snapshot, application DTO, project root, panel or terminal state, server setting, or capability projection is stored

### Requirement: Desktop bundle commitment from the packaged artifact

Desktop SHALL commit a native window only after the bundle inventory read from its pinned embedded-server artifact has been verified, its host compatibility requirements accepted, and the window's server binding reserved. The artifact SHALL be read directly, without a public listener and without a network fetch. An incomplete or invalid inventory SHALL leave the window uncommitted with a typed diagnostic.

#### Scenario: Verification precedes window commitment

- **WHEN** Desktop prepares a window
- **THEN** it commits the window only after verifying the packaged bundle inventory and accepting its host compatibility requirements

#### Scenario: Invalid inventory leaves the window uncommitted

- **WHEN** the packaged bundle inventory is incomplete or invalid
- **THEN** the window stays uncommitted and a typed diagnostic is shown

## ADDED Requirements

### Requirement: Connections route contract

The production shared Connections route SHALL accept the host-local `ConnectionProfileStore` or the host's sanitized saved-server list, and narrow callbacks for switching to a server, opening it in a new window, server revocation, exposure, pairing, rename, and forget. It SHALL keep forget explicitly separate from revoke with different confirmation copy and SHALL never write a pairing URL into profile metadata. Unsupported actions SHALL stay absent or disabled. The production Desktop server-UI bridge SHALL supply a sanitized profile snapshot and source-bound actions, SHALL reject profiles the host does not remember, SHALL allow exposure only for the server the window shows, and SHALL consume pairing credentials without retaining them. Host-local writes SHALL be flushed before a profile or window callback returns.

#### Scenario: Foreign profile is rejected

- **WHEN** the bridge receives a profile the host does not remember
- **THEN** it rejects that profile

#### Scenario: Exposure limited to the window's server

- **WHEN** exposure is requested for a server other than the one the window shows
- **THEN** it is not allowed

#### Scenario: Host-local writes flush before return

- **WHEN** a profile or window callback completes
- **THEN** host-local writes are flushed before it returns

### Requirement: The bundle's client negotiates server compatibility

The bundle manifest SHALL declare the application-protocol version range and the server capabilities the bundle's client requires, and MAY declare optional server capabilities. The client SHALL carry both in its hello, the server SHALL answer with its protocol version and capability set, and the client SHALL classify the connection as **compatible**, **degraded** when an optional capability is absent, or **incompatible** when the protocol range or a required capability is unsatisfied. A window whose server is incompatible SHALL show no workspace, SHALL state the server's version and which side must be upgraded, and SHALL send that server no application operation. A degraded connection SHALL keep working with the affected surface presented as unavailable. The host SHALL NOT evaluate this negotiation.

#### Scenario: Incompatible server

- **WHEN** a window's server answers the hello outside the bundle's declared protocol range
- **THEN** the window states the server's version and the side that must be upgraded, and no operation is sent to it

#### Scenario: Optional capability absent

- **WHEN** a server declares every required capability but omits an optional one
- **THEN** the connection is degraded, remains usable, and the affected surface shows as unavailable

#### Scenario: Host stays out of the negotiation

- **WHEN** a connection is classified
- **THEN** the classification is computed by the bundle's client and the host evaluates only bundle-to-host boundaries

### Requirement: Desktop runs its packaged bundle for every server

Desktop SHALL launch the workspace bundle read from its pinned embedded-server artifact, and SHALL run that bundle for every window, whether the window shows Local or a remote server. A remote connection profile SHALL supply a transport, and SHALL NOT supply workspace bundle bytes. Desktop SHALL NOT open a public listener or an asset download in order to obtain a bundle.

#### Scenario: A remote window runs the packaged bundle

- **WHEN** a Desktop window is switched to a remote server
- **THEN** it runs the bundle from Desktop's pinned embedded-server artifact and the remote profile supplies only a transport

#### Scenario: Same bundle across windows

- **WHEN** one Desktop window shows Local and another shows a remote server
- **THEN** both run one bundle id, differing only in transport and connection identity

### Requirement: One workspace bundle runs each window

A window SHALL run exactly one workspace UI bundle, and that bundle SHALL be the sole workspace renderer for connections, Git, agents, folders, and terminals of the window's server. Desktop development, packaged Desktop, and auxiliary routes SHALL execute the same bundled route bodies against the window's authenticated client. Desktop SHALL use the same production server-UI window composition for every startup, with no second workspace-window owner.

#### Scenario: Auxiliary routes use the window's bundle

- **WHEN** Desktop opens an auxiliary route from a window
- **THEN** the same bundle executes that route body against that window's server

#### Scenario: Development and packaged builds render identically

- **WHEN** Desktop runs in development or packaged form
- **THEN** the same bundled workspace renders

### Requirement: Disconnecting and switching leave the server running

**Disconnect** SHALL close a connection's client transport and SHALL NOT stop the server or terminate its PTYs. Switching a Desktop window to another server SHALL close the transport to the server it was showing and SHALL close nothing on that server. On `app.terminay.com`, **File → Disconnect** and **Switch connections** SHALL close the connection and return to the manager connection list, using `shell.back` when framed. Desktop SHALL have no Disconnect item; its native File menu SHALL remain Local and remote window management. Closing or reloading the host SHALL preserve server-side sessions.

#### Scenario: Disconnect leaves PTYs running

- **WHEN** a browser user disconnects
- **THEN** the client transport closes while the server and its PTYs continue

#### Scenario: Desktop File menu has no Disconnect

- **WHEN** a Desktop user opens File
- **THEN** there is no Disconnect item

#### Scenario: Switching away leaves the server untouched

- **WHEN** the user switches a window from one server to another
- **THEN** the first server's terminals, projects, and PTYs are untouched and are there when the window returns to it

### Requirement: Desktop persists profiles and each window's server

Desktop SHALL store non-secret profiles locally and credentials through OS-backed secure storage where available. A Desktop connection created from a pairing URL SHALL enrol a protected device key and save only the stable session origin as switchable profile metadata; one-time URLs SHALL never be stored or reused. A profile record SHALL contain only its stable server identity, exact session origin, display metadata, timestamps, and a diagnostic status; pairing fragments, device keys, terminal data, and filesystem paths SHALL NOT be profile fields. Desktop SHALL also persist which server each window shows, and the workspace view chosen on it, as device-local presentation state alongside window geometry, and SHALL NOT send it to any server.

#### Scenario: Pairing URL is not persisted

- **WHEN** Desktop creates a connection from a pairing URL
- **THEN** only the stable session origin and sanitized metadata are saved, and the one-time URL is not stored

#### Scenario: Credentials use OS-backed storage

- **WHEN** Desktop enrols a device key
- **THEN** it is held through OS-backed secure storage where available and not in the profile record

#### Scenario: A window reopens on its server

- **WHEN** Desktop restarts after a window was showing a remote server
- **THEN** that window reopens bound to the same server

### Requirement: A native window is bound to one server

A native window SHALL be bound to exactly one server connection, and its title and security scope SHALL make that server clear. Several windows MAY show Local, each with a different logical workspace view, and other windows MAY simultaneously show other servers. At most one window SHALL show a given remote server, because a server holds one live connection for each device. A window's server SHALL change only through an explicit action by the person — choosing a server in the connection menu, or adding one — and SHALL NEVER change as a side effect of a connection failure or of another window's actions. Native window identity and server logical-view identity SHALL remain separate bindings, so focus or close does not mutate a logical view without a typed server command.

#### Scenario: Four windows across four servers

- **WHEN** four Electron windows show four different servers
- **THEN** no server, project, or credential state crosses between them

#### Scenario: A failure does not move the window

- **WHEN** a window's server becomes unreachable
- **THEN** the window stays bound to that server and shows its connection state

### Requirement: Connection menu lists and switches servers

On Desktop the connection menu SHALL list every remembered server as a single line with **Local** first, and SHALL mark the server the window is showing. Choosing another server SHALL switch the window to it, and each row for another server SHALL also offer **Open in new window**. On a framed `app.terminay.com` session the menu SHALL show the session's one server and SHALL NOT list the manager's other saved profiles, because the manager owns the saved-profile list outside the iframe. The menu SHALL contain a manage control on the Connections heading that opens the same **Remote Control** surface as File → Remote Control; **Expose this server…** when the current device is allowed to manage the window's server's exposure; **Create pairing link** while that server is exposed; live **Active Connections** for every browser or Desktop peer connected to that server, with empty copy using the same inset as other menu rows; retry and forget or revoke actions with distinct language inside Remote Control; and **Switch connections** only when the browser session can return to the `app.terminay.com` manager.

#### Scenario: Desktop menu lists remembered servers

- **WHEN** a Desktop user opens the connection menu
- **THEN** every remembered server is listed with **Local** first, the window's server is marked, and **Switch connections** is absent

#### Scenario: Framed menu shows only the current server

- **WHEN** a framed `app.terminay.com` workspace opens its connection menu
- **THEN** it shows the session's server and **Switch connections**, and not the manager's other saved profiles

#### Scenario: Exposure actions are capability-gated

- **WHEN** the current device is not allowed to manage exposure on the window's server
- **THEN** **Expose this server…** is not offered

#### Scenario: Choosing a server

- **WHEN** the user chooses another server in the Desktop connection menu
- **THEN** the window shows that server's workspace in place of the previous one

### Requirement: Connection terms

A **server connection** SHALL be an authenticated relationship with one stable Terminay Server identity. A **connection profile** SHALL be host-local metadata such as label, session origin, server identity or fingerprint, last-opened time, and status. A **connection window** SHALL be an Electron window or browser view bound to exactly one server connection, optionally bound to one logical workspace view on that server; everything the window shows belongs to that server. A **host shell** SHALL own connection bootstrap, protected credentials, verified bundle installation, and native or browser presentation, and SHALL NOT implement workspace features or interpret the application protocol. A **host capability** SHALL be one optional, versioned presentation or OS action supplied by a trusted shell to a bound server-bundled renderer.

#### Scenario: Host shell stays out of the application protocol

- **WHEN** a host shell carries application traffic for a bound renderer
- **THEN** it provides bootstrap, credentials, bundle installation, and presentation only
- **AND** it does not implement workspace features or interpret the application protocol

#### Scenario: Capabilities are negotiated, not assumed

- **WHEN** a server-bundled renderer needs a native action
- **THEN** it uses an individually negotiated, versioned host capability

#### Scenario: A window is one server

- **WHEN** a window is open
- **THEN** every project, terminal, agent, setting, and notification it shows belongs to the one server it is bound to

### Requirement: Switching a Desktop window's server

Switching a Desktop window to another remembered server SHALL be a source-bound host action that names the profile by id and carries no origin or credential. Electron SHALL open the authenticated transport, and SHALL replace the window's document with that server's workspace only once the transport is ready; until then the window SHALL keep showing the server it was on with the attempt's progress, and a failed attempt SHALL leave it there with the reason shown. A window SHALL hold one server's transport at a time. When another window already shows the chosen remote server, Desktop SHALL bring that window to the front and SHALL leave the current window as it was. Switching SHALL be refused for a profile the host does not remember.

#### Scenario: A successful switch

- **WHEN** the user chooses a reachable remembered server in the connection menu
- **THEN** the window shows that server's workspace and holds no transport to the previous server

#### Scenario: The chosen server cannot be reached

- **WHEN** the chosen server does not answer
- **THEN** the window stays on the server it was showing and the menu shows why the switch failed

#### Scenario: Another window already shows the server

- **WHEN** the user chooses a remote server that another window is showing
- **THEN** that window comes to the front and the current window stays on its server

#### Scenario: Returning to Local

- **WHEN** the user chooses **Local** in a window showing a remote server
- **THEN** the window shows the Local workspace as it was left

### Requirement: Opening a server in a new window

Each server in the Desktop connection menu other than the window's own SHALL offer **Open in new window**, which SHALL open a new native window bound to that server and SHALL leave the current window unchanged. A new window SHALL be sandboxed and bound exactly as a window switched to that server is. When a window already shows that remote server, the action SHALL bring that window to the front and SHALL open no second window.

#### Scenario: The server is already open

- **WHEN** the user chooses **Open in new window** for a remote server that another window is showing
- **THEN** that window comes to the front and no new window opens

#### Scenario: Two servers side by side

- **WHEN** the user chooses **Open in new window** for a remote server from a window showing Local
- **THEN** a second window shows that server and the first still shows Local

### Requirement: A window knows only its own server

A window SHALL hold no connection to, and SHALL show no project, terminal, agent, notification, count, or status of, any server other than the one it is bound to. The connection menu SHALL show other remembered servers by label only.

#### Scenario: Another server's activity

- **WHEN** an agent on a remote server needs attention while every window shows Local
- **THEN** no window shows it until a window shows that server

#### Scenario: Notifications and badges

- **WHEN** a window computes its Notifications count
- **THEN** it counts only its own server's entries

### Requirement: Every workspace surface covers the window's server

Home, the Tabs list, Automations, Notifications, the Agents pane, the Command Bar, Settings, Extensions, Macros, Recordings, and Shell profiles SHALL each present the window's server and SHALL NOT offer a control for choosing a server or name a server on a row. Auxiliary windows SHALL present the server of the window they were opened from.

#### Scenario: Opening Macros

- **WHEN** the user opens Macros from a window showing a remote server
- **THEN** it lists that server's macros and shows no server selector

#### Scenario: Automations

- **WHEN** the user opens Automations
- **THEN** it lists the window's server's automations and a new automation is created on that server

### Requirement: Add connection options come from a provider list

The ways of starting a server that Add connection presents SHALL come from one ordered list of providers, each with a name, a short description of where it runs, and what it shows the person. The first provider SHALL be selected by default. The list SHALL hold Docker and a Linux host. Adding a provider SHALL require no change to the surrounding Add connection surface.

#### Scenario: The default provider

- **WHEN** a person opens Add connection
- **THEN** the providers are offered as one choice with Docker selected

#### Scenario: Choosing a provider

- **WHEN** the person chooses the Linux host provider
- **THEN** its instructions replace Docker's

### Requirement: Host bridge is versioned and source-bound

Native actions SHALL be exposed through a versioned, source-bound host bridge. The host SHALL inject a frozen context containing the bridge version, host kind, the exact identity of the one server and profile the window is bound to, the sanitized list of remembered profiles by id and label, and individually negotiated capabilities. A renderer SHALL NOT enable Desktop behaviour with a URL or query parameter, server payload, local setting, or claimed mode. Each request SHALL be checked against its bound window and the profile it names, SHALL reject unknown payload fields and any profile the host does not remember, and SHALL require a user gesture for actions that can read or change native state.

#### Scenario: No renderer-selected privilege switch

- **WHEN** a renderer supplies a query parameter, server payload, local setting, or claimed mode requesting Desktop privileges
- **THEN** no Desktop behaviour is enabled

#### Scenario: Unknown fields are rejected

- **WHEN** a bridge request carries unknown payload fields
- **THEN** the request is rejected

#### Scenario: Native state changes need a gesture

- **WHEN** a bridge action can read or change native state
- **THEN** it requires a user gesture

#### Scenario: Request naming an unremembered profile

- **WHEN** a bridge request names a profile the host does not remember
- **THEN** the request is rejected

#### Scenario: Context names one bound profile

- **WHEN** a renderer inspects its injected context
- **THEN** it names exactly one bound server and profile, and lists the other remembered profiles by id and label only

### Requirement: Web connection manager scope

`app.terminay.com` SHALL have no Local server option and SHALL never claim browser filesystem or PTY authority. Its disconnected state SHALL be a connection picker: a saved-profile list with **Add new connection**, which opens a dedicated page to scan a pairing QR or paste a pairing URL, plus rename, open, and forget actions. Selecting a profile SHALL frame that server's session in the current PWA view, and an explicit action MAY open a first-party session tab. The manager SHALL frame one session for one server and SHALL open no transport to any other saved server on that session's behalf. The PWA SHALL contain connection-profile management, the framed session host, and the origin-keyed credential vault, SHALL NOT run the workspace, and SHALL show at most one framed session at a time.

#### Scenario: Web host offers no Local option

- **WHEN** a browser user opens the connection manager
- **THEN** the same add, manage, and switch journey is available with no Local option

#### Scenario: One framed session at a time

- **WHEN** the user opens another saved profile
- **THEN** it replaces the currently framed session, and the view shows that server only

#### Scenario: Manager opens no other transport

- **WHEN** a session is framed while other profiles are saved
- **THEN** the manager opens no transport to any other saved server, and the framed session reaches only its own server

### Requirement: Bundle bytes stay out of the manager origin

The stable session origin of a browser session's server SHALL install that server's bounded workspace bundle after authentication. Bundle bytes, feature frames, pairing fragments, PINs, and connection tickets SHALL never enter the manager origin. Framed-session device credentials SHALL enter only the origin-keyed vault. `app.terminay.com` SHALL be the stable connection manager, and the framed server's verified bundle SHALL render the workspace at its stable session origin. A saved server that is not the framed one SHALL contribute no bundle bytes to any origin.

#### Scenario: Manager origin holds no bundle bytes

- **WHEN** a framed session installs a server bundle
- **THEN** the bytes are handled at the session origin and never enter the manager origin

#### Scenario: Other saved servers ship no bundle

- **WHEN** a session is framed while other profiles are saved
- **THEN** no bundle bytes are transferred for any server other than the framed one

### Requirement: Server code containment in Electron

Server-provided code inside Electron SHALL run with sandboxing, context isolation, Node integration disabled, and no ambient privileged preload. A minimal host bridge SHALL validate every native action. The Desktop shell SHALL resolve the bundle manifest and assets only on the exact session origin of the window's server. Same-origin bundle navigation SHALL be allowed; arbitrary origins, URL credentials or query state, new windows, downloads, permission prompts, and custom protocol handlers SHALL be denied by default. A privileged host MAY explicitly allow one guarded request through the native policy boundary. A window's server SHALL deliver application bytes over the window's one endpoint, and a server the window is not bound to SHALL NOT contribute bytes, script, asset, or navigation to the window.

#### Scenario: Off-origin navigation is denied

- **WHEN** a bundle attempts to navigate to an arbitrary origin
- **THEN** the navigation is denied

#### Scenario: Downloads and permission prompts are denied by default

- **WHEN** a bundle triggers a download, new window, permission prompt, or custom protocol handler
- **THEN** it is denied unless a privileged host explicitly allows that one guarded request

#### Scenario: Another remembered server contributes nothing

- **WHEN** a window shows one server while other servers are remembered
- **THEN** no other server contributes bytes, script, asset, or navigation to that window

### Requirement: Browser pairing and reconnect journeys

Terminay SHALL support two browser entry journeys — opening the hosted pairing link and the `app.terminay.com` PWA add flow — and both SHALL use the same session-origin pairing, credential, server-bundle, and reconnect contracts. Opening the advertised hosted URL SHALL land on the manager, which consumes the fragment in memory, strips query and hash from the visible URL, and asks **Save and connect** with an optional title prefilled from `hostName` or the session id; Cancel SHALL discard the material and Confirm SHALL write the bookmark and frame `https://<session-id>.terminay.com/v1/#<secret>` without storing the fragment. The framed session origin SHALL establish WebRTC, verify and launch that server's bundle as the window's one workspace bundle, create the device key, submit enrollment, display the match code while awaiting host approval, and complete enrollment, storing that key in the manager vault for `event.origin` when framed. First pairing with any server SHALL happen at that server's own session origin. A later visit to the saved profile or the stable session origin SHALL reconnect without reuse of the pairing URL. A first-party visit to a session-origin `/v1/` pairing URL SHALL enrol at the session origin with session-origin IndexedDB.

#### Scenario: Both journeys share one prompt

- **WHEN** the user opens a hosted pairing link in a browser or scans or pastes it inside the PWA
- **THEN** the same **Save and connect** prompt appears and enrollment is framed at the session origin

#### Scenario: Returning to the manager restores the profile

- **WHEN** the user returns to the manager after a framed session
- **THEN** the iframe unloads and the saved profile is restored from local browser storage

#### Scenario: Saved connection reconnects from the vault

- **WHEN** the user selects the saved connection later
- **THEN** its stable session origin is framed, receives its device credential from the manager vault, and reconnects without a pairing URL

#### Scenario: Pairing a second server

- **WHEN** the user pairs a new server while another profile is already saved
- **THEN** first pairing runs at the new server's own session origin, and the saved profile and its vaulted credential are untouched

### Requirement: Host-local profile data allowed and forbidden

Allowed host-local profile data SHALL be the stable server id or fingerprint, the exact non-secret session origin, the user label and explicitly shared server display name, created, last-opened, and last-connected timestamps, local window and view mapping consisting of the server each window shows and the workspace view chosen on it, non-secret UI preferences, and known, offline, expired, revoked, archived, or unreachable state. Pairing URL fragments and full unconsumed pairing URLs, PINs, terminal tickets, server secrets, terminal output, command history, project roots, filenames, and recordings SHALL be forbidden in connection-manager `localStorage`, URLs, logs, and bookmark records. Device private keys SHALL never enter bookmark storage, `localStorage`, URLs, or logs; in the framed PWA they SHALL live only in the origin-keyed manager IndexedDB vault and in closed `postMessage` clones to the matching session iframe.

#### Scenario: Bookmark record excludes secrets

- **WHEN** a connection profile is written
- **THEN** it contains no pairing fragment, PIN, ticket, server secret, terminal output, command history, project root, filename, or recording

#### Scenario: Device key stays out of localStorage

- **WHEN** a framed PWA session holds a device key
- **THEN** it lives only in the origin-keyed manager IndexedDB vault and in closed clones to the matching iframe

#### Scenario: Window mapping holds identities only

- **WHEN** the server a window shows is written host-locally
- **THEN** the record holds a profile id and a view id, and no project root, filename, or workspace content

## REMOVED Requirements

### Requirement: Connection vocabulary

**Reason**: Its text and scenarios describe a window holding a primary connection and attached connections. A window shows one server.

**Migration**: Restated for one server per window as "Connection terms".

### Requirement: Connection menu contents

**Reason**: Its text and scenarios describe a window holding a primary connection and attached connections. A window shows one server.

**Migration**: Restated for one server per window as "Connection menu lists and switches servers".

### Requirement: Native window server binding

**Reason**: Its text and scenarios describe a window holding a primary connection and attached connections. A window shows one server.

**Migration**: Restated for one server per window as "A native window is bound to one server".

### Requirement: Desktop connection persistence

**Reason**: Its text and scenarios describe a window holding a primary connection and attached connections. A window shows one server.

**Migration**: Restated for one server per window as "Desktop persists profiles and each window's server".

### Requirement: Disconnect semantics

**Reason**: Its text and scenarios describe a window holding a primary connection and attached connections. A window shows one server.

**Migration**: Restated for one server per window as "Disconnecting and switching leave the server running".

### Requirement: One workspace bundle per window

**Reason**: Its text and scenarios describe a window holding a primary connection and attached connections. A window shows one server.

**Migration**: Restated for one server per window as "One workspace bundle runs each window".

### Requirement: Desktop runs its packaged bundle for every connection

**Reason**: Its text and scenarios describe a window holding a primary connection and attached connections. A window shows one server.

**Migration**: Restated for one server per window as "Desktop runs its packaged bundle for every server".

### Requirement: Server compatibility is negotiated by the bundle's client

**Reason**: Its text and scenarios describe a window holding a primary connection and attached connections. A window shows one server.

**Migration**: Restated for one server per window as "The bundle's client negotiates server compatibility".

### Requirement: Connections route contract for a window's connections

**Reason**: Its text and scenarios describe a window holding a primary connection and attached connections. A window shows one server.

**Migration**: Restated for one server per window as "Connections route contract".

### Requirement: Versioned source-bound host bridge

**Reason**: One of its scenarios is named for a server attached to a window, and its text describes a window holding a primary connection and attached connections. A window shows one server.

**Migration**: Restated for one server per window as "Host bridge is versioned and source-bound".

### Requirement: Web connection host scope

**Reason**: One of its scenarios is named for a server attached to a window, and its text describes a window holding a primary connection and attached connections. A window shows one server.

**Migration**: Restated for one server per window as "Web connection manager scope".

### Requirement: Bundle content stays out of the manager origin

**Reason**: One of its scenarios is named for a server attached to a window, and its text describes a window holding a primary connection and attached connections. A window shows one server.

**Migration**: Restated for one server per window as "Bundle bytes stay out of the manager origin".

### Requirement: Remote code containment in Electron

**Reason**: One of its scenarios is named for a server attached to a window, and its text describes a window holding a primary connection and attached connections. A window shows one server.

**Migration**: Restated for one server per window as "Server code containment in Electron".

### Requirement: Browser connection journeys

**Reason**: One of its scenarios is named for a server attached to a window, and its text describes a window holding a primary connection and attached connections. A window shows one server.

**Migration**: Restated for one server per window as "Browser pairing and reconnect journeys".

### Requirement: Allowed and forbidden host-local profile data

**Reason**: One of its scenarios is named for a server attached to a window, and its text describes a window holding a primary connection and attached connections. A window shows one server.

**Migration**: Restated for one server per window as "Host-local profile data allowed and forbidden".
