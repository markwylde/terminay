## ADDED Requirements

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

## MODIFIED Requirements

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

### Requirement: Desktop persistence allowlist

Desktop persistence SHALL be a closed allowlist of sanitized profiles, protected credential references, native geometry, exact primary and attached profile and view bindings, window composition and tab order, update state, OS permission decisions, and explicit device preferences. Workspace snapshots, application DTOs, project roots, panel and terminal state, server settings, and feature capability projections SHALL be forbidden in the host store. Unclassified fields SHALL fail closed.

#### Scenario: Unclassified field is rejected

- **WHEN** a field outside the allowlist is written to the Desktop host store
- **THEN** the write fails closed

#### Scenario: Workspace state stays server-owned

- **WHEN** Desktop persists host state
- **THEN** no workspace snapshot, application DTO, project root, panel or terminal state, server setting, or capability projection is stored

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

### Requirement: Connections and client hosts non-goals

There SHALL be no browser-owned Local Terminay server, no cloud account or cloud-synchronized connection list, no silent exposure of an embedded Local server, no arbitrary remote JavaScript with Electron or Node privileges, no requirement that browser UI use native popup windows, no independently versioned full workspace application at `app.terminay.com`, no renderer-selected `mode=electron` or equivalent privilege switch, and no Desktop feature client or persisted workspace mirror used to translate between server application versions.

#### Scenario: No cloud-synchronized connection list

- **WHEN** a user adds a connection on one device
- **THEN** it is stored host-locally and is not synchronized through a cloud account

#### Scenario: No translation layer between versions

- **WHEN** a host connects to a server whose protocol the bundle's client cannot satisfy
- **THEN** the connection is reported incompatible and the host holds no feature client or persisted workspace mirror to translate application versions

## REMOVED Requirements

### Requirement: One workspace renderer per selected server

**Reason:** A window runs one workspace UI bundle across every connection it holds, so the renderer is a property of the window rather than of a selected server. Replaced by "One workspace bundle per window".

**Migration:** None; there are no installed users.

### Requirement: Desktop launches the selected server's bundle

**Reason:** Desktop runs the bundle packaged with it for every connection, and a remote profile supplies a transport rather than bundle bytes. Replaced by "Desktop runs its packaged bundle for every connection".

**Migration:** None; there are no installed users. Desktop's per-server bundle cache directory is deleted on first start.

### Requirement: Verified bundle cache

**Reason:** Desktop reads its one bundle from the pinned embedded-server artifact, so there is no per-server download lane or content-addressed cache to partition by server identity. Replaced by "Desktop bundle commitment from the packaged artifact"; the browser's primary-origin bundle installation stays covered by "Bundle content stays out of the manager origin".

**Migration:** None; there are no installed users. Desktop's per-server bundle cache directory is deleted on first start.

### Requirement: Shared Connections route contract

**Reason:** Exposure and route enablement are per attached connection, and the route's actions include attach and detach; the single "current connection" framing is replaced.
**Migration:** None; the route keeps its callbacks and gains attach and detach.
