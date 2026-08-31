# Connections and client hosts

## Summary

Terminay Desktop and browser clients use the same server identity, device
enrollment, and connection model. The header server control is a current-server
selector and connection menu.

Desktop starts connected to its embedded server as **Local**. Browser clients
have no embedded server and begin with a remembered connection or connection
picker. Both hosts can add, remember, open, switch, inspect, and forget remote
Terminay Server connections. An authorized local Desktop window can also expose
its embedded server so other desktop or browser clients can pair with it.

Terminay Server connections are distinct from
[project environments](./project-environments.md). A server connection is the
client-to-Terminay-Server transport selected by the host. A project environment
is a server-owned outbound binding from that Terminay Server to a project
machine. The header server selector never lists SSH servers or Puzed VMs;
project creation and **Project Environments…** do. Desktop/web never install
environment extensions, make those outbound connections, or hold their secrets.

## Concepts

- A **server connection** is an authenticated relationship with one stable
  Terminay Server identity.
- A **connection profile** is host-local metadata such as label, session origin,
  server identity/fingerprint, last-opened time, and status.
- A **connection window** is an Electron window or browser view bound to one
  server and optionally one logical workspace view.
- A **host shell** owns connection bootstrap, protected credentials, verified
  bundle installation, and native/browser presentation. It does not implement
  workspace features or interpret the application protocol.
- A **host capability** is one optional, versioned presentation or OS action
  supplied by a trusted shell to a bound server-bundled renderer.
- **Expose this server** makes an authorized server available for remote
  pairing/reconnect. It does not change which server the current window renders.
- **Disconnect** closes the client transport. It does not stop the server or
  terminate its PTYs. On `app.terminay.com`, **File → Disconnect** and
  **Switch connections** return to the manager connection list (`shell.back`
  when framed). Desktop has no Disconnect item; its native File menu stays
  Local/remote window management.
- **Forget** removes host-local metadata/credentials after confirmation.
  **Revoke** changes server authorization and closes affected connections.

## Shared header journey

The header displays the current server label, not the transport. Left of
the label, an exposure control icon uses the same color as the label: a
stop icon while the server is exposed, a play icon while it is not. Right
of the label, a blue pill shows the number of active remote connections, or
nothing when the count is zero:

```text
[ ▶ Local ▼ ]
[ ■ Local ▼ ]
[ ■ Local  2 ▼ ]
[ ▶ Production VPS ▼ ]
[ ▶ Home Mac · Offline ▼ ]
```

The menu contains:

- on Desktop, every remembered connection as a single-line list with
  **Local** first; selecting another profile focuses an existing window for
  that connection or opens a new sandboxed window;
- on a framed `app.terminay.com` session, only the current connection,
  which is not a switcher list, because the manager owns the saved-profile
  list outside the iframe;
- a manage control on the Connections heading that opens the same
  **Remote Control** surface as File → Remote Control;
- **Expose this server…** when the current device is allowed to manage
  exposure;
- **Create pairing link** while the server is exposed;
- live **Active Connections** for every connected browser or Desktop peer,
  with empty copy using the same inset as other menu rows;
- retry and forget/revoke actions with distinct language inside Remote
  Control;
- **Switch connections** only when the browser session can return to the
  `app.terminay.com` manager (`shell.back` when framed). Desktop never shows
  this action; and
- diagnostics that distinguish server offline, relay unavailable, WebRTC
  route failure, missing device identity, revoked device, invalid contract, and
  failed switch actions. Failed switch actions keep the selector visible and
  show the host-provided failure reason instead of logging only to the native
  terminal.

On Desktop, selecting another remembered connection focuses or opens that
connection's window. On a framed browser session, **Switch connections**
returns to the manager list; opening another saved profile replaces the
framed session.

Remote Control is the single management surface for pairing, trusted devices,
and live connections. Settings keeps PIN limits and signaling configuration.

The primary exposure control represents server-owned WebRTC availability. An
unavailable route remains visible for diagnosis and links to its configuration
or build requirement, and its start action is disabled.

The shared browser-safe UI package projects this model into an accessible
`menuitemradio` list with stable ordering, position/set-size metadata, and
keyboard/touch focus behavior (arrow wrapping, Home/End, Escape, and explicit
activation). Host capabilities gate administrative actions such as exposure;
the menu never invokes a native operation directly.

The same package exposes a route registry for workspace, connections, settings
(including Extensions), project environments, recordings, macros, file, and
Git surfaces. Browser hosts keep every route in-page; Desktop may present
eligible secondary routes in native auxiliary windows only when its
`nativeWindows` capability is declared.

File groups workspace creation separately from management surfaces:

- **Create a new terminal tab** and **Create a new project**;
- then **Remote Control**, **Project Environments**, **Extensions**,
  **Macros**, **Recordings**, and **Settings**.

**Remote Control** opens the shared connections route as a first-class
management window, the same presentation family as Settings, Macros,
Recordings, and Project Environments. It uses that family's sidebar-and-content
chrome: title, subtitle, and **Add connection…** live in the left sidebar with
**This server → Exposure** first, then the saved-server list. Title, action,
group labels, rows, and empty sidebar copy share one inset, matching Settings. The main pane
shows only the selected sidebar item: Exposure uses the Settings remote-access
cards (status header, WebRTC summary, trusted browsers, live connections);
saved-server details and pairing live there when those items are selected.
**Create pairing link** from the connection menu and from Remote Control opens
the same Pair Device dialog. Remote Control’s Exposure header shows that
action next to **Stop exposure** while the server is exposed. The dialog
shows the one-time pairing link and copy control; it does not show the
session-origin hostname.
Desktop opens or focuses a native auxiliary window; the browser host presents
the same route in-page. The window is not an Edit Tab sheet. Pairing URL and
PIN fields stack at full width above continue/cancel actions. An empty
saved-server list keeps a quiet sidebar note. With no saved servers, the window
lands on Exposure instead of empty-server copy. Empty-server copy is also
hidden while Exposure is selected or the pairing form is open.

Desktop development, packaged Desktop, and auxiliary routes execute the same
server-bundled route bodies against the authenticated selected-server client.
That selected-server bundle is the sole workspace renderer for connections,
Git, agents, folders, and terminals.

The existing activity/notification indicator remains separate. Connection
status must not be conflated with terminal or agent attention.

## Terminay Desktop

- Startup supervises the embedded server and opens/focuses a window bound to
  its **Local** profile.
- Desktop launches the exact verified workspace bundle owned by that selected
  server for every Local and remote connection window. Local obtains the bytes
  from its pinned embedded-server artifact; remote obtains them through the
  authenticated server asset channel. Desktop never runs its independently
  packaged Local workspace renderer against a different remote server.
- The initial native window is explicitly bound to immutable Local and the
  header reports the selected profile label/status (including Local failure or
  offline state), never a transport name and never the opaque session-id
  hostname. Browser sessions use the saved connection title, falling back to
  the pairing `hostName` (the exposing machine's hostname). Local uses the
  private authenticated Desktop host transport and does not require a network
  listener, internet access, hosted signaling, or WebRTC; remote profiles
  require their own selected transport.
- A Desktop user-data root has one embedded Local server identity and may
  remember any number of remote profiles. On first use Desktop creates an
  opaque random identity in that root and retains it across restart; it never
  derives authority from the application name, project name, path, window, or
  process. Two Desktop profiles, development/packaged installations, or test
  roots therefore remain separate even when their restored project and
  terminal ids are identical.
- A native window is bound to exactly one server at a time. Its title and
  security scope make the connection clear.
- The header connection menu lists every remembered profile, with **Local**
  first, and omits **Switch connections**.
- Reloading a native window preserves that exact server binding. Desktop
  discards the document-scoped byte channel, reconnects the remembered remote
  profile with its OS-protected credential, and transfers a fresh channel to
  the new document. A reload must never attach Local merely because the remote
  renderer transport was destroyed with the previous document.
- Selecting a profile focuses an existing window for that connection/view when
  appropriate or opens a new sandboxed window. Rebinding the current window is
  an explicit action, not an accidental side effect of menu selection.
- A newly opened Desktop connection window remains in the normal loading state
  until its own local or remote server connection is ready. The loading state
  centers the Terminay mark in the window above a looping five-dot loading
  indicator. Desktop packaging, browser metadata, and visible web surfaces use
  the same square mark geometry: a pure-black background with even horizontal
  and vertical padding around the white glyph. The dots use five fixed,
  contrasting colours from the tab hue
  palette and enter in sequence. Local embedded-server startup has no text,
  while remote connections also show a short status message. Native window
  controls never overlap it. At local Desktop startup, a self-contained native
  loading document paints this state immediately after Electron is ready, before
  workspace restoration, extension setup, or server initialization begins. The
  loading document finishes painting, and the native window is shown, before
  that restoration starts. If workspace persistence cannot be read, validated,
  or first-run committed, Desktop stops any in-flight loading navigation and
  replaces the loader with a host-owned recovery document rather than leaving
  Chromium pending or the window unpainted. The verified server UI replaces the
  loading document once its session is ready, and its initial
  document paints the same loading state before the renderer bundle evaluates.
  Its dot animation stays in phase through that handoff, so startup never
  presents an empty window or a visibly restarted loader. If the renderer cannot
  bootstrap, it replaces the loading state with a visible reload action. The
  originating window keeps its existing server binding during that handoff.
- Multiple windows may target the same server and different logical workspace
  views. Other windows may simultaneously target other servers.
- Local server startup, shutdown, crash recovery, and update are host actions.
  Remote server shutdown/update is never implied by closing its window.
- Desktop stores non-secret profiles locally and credentials through OS-backed
  secure storage where available.
- A Desktop connection created from a pairing URL enrolls a protected device
  key and saves only the stable session origin as switchable profile metadata.
  One-time URLs are never stored or reused.
- Desktop keeps application traffic opaque after bootstrap. Its local and
  remote adapters provide bounded byte transports to the server-bundled
  client; they do not decode, translate, persist, or synthesize feature
  commands, results, workspace snapshots, or events.

The Desktop host foundation keeps the connection manager deliberately separate
from server workspace state. A profile record contains only its stable server
identity, exact session origin, display metadata, timestamps, and a diagnostic
status; pairing fragments, device keys, terminal data, and
filesystem paths are not profile fields. The embedded server creates one
immutable `Local` profile from its stable identity before the first workspace
client is opened. A failed identity check marks that profile as an explicit
identity-mismatch failure and never switches to Local or another remembered
profile implicitly. A Local crash, restart, or stopped state detaches the
active client and marks the profile unavailable until an explicit recovery
connects again; the host never presents a stale connected workspace.

Connection management actions remain distinct: rename changes only remote
display metadata, archive hides a remote profile without deleting its saved
origin, forget removes host-local metadata only after confirmation, and revoke
marks remote access unavailable only after separate confirmation. None of these
actions can rename, archive, forget, or revoke the immutable Local profile.
Forgetting or revoking a remote profile that is not bound to the current window
does not replace, reconnect, or resynchronize that window's Local client. Its
projects, terminal attachments, and in-flight protocol operations continue
without interruption.

Native actions are exposed through a versioned, source-bound host bridge. The
host injects a frozen context containing the bridge version, host kind, exact
bound server/profile identity, and individually negotiated capabilities. A
renderer cannot enable Desktop behavior with a URL/query parameter, server
payload, local setting, or claimed mode. Each request is checked against its
bound window and current connection, rejects unknown payload fields, and
requires a user gesture for actions that can read or change native state.

The bridge surface is limited to semantic window/view focus, route
presentation and close, menu commands, clipboard write, approved file
selection, credential-free HTTP and HTTPS external links, server-owned
reveal tokens, update status, notifications, and explicitly declared OS
integration. A shared UI requests a
route with a presentation disposition; Desktop may open/focus a native window,
while a browser uses an in-page route or browser tab. The bridge never exposes
`BrowserWindow`, arbitrary paths, raw transport handles, generic IPC, or server
application commands. Server-bundled renderers receive a `TerminayClient` byte
endpoint and capability provider rather than Electron APIs.
Settings, recordings, and project/terminal editors request the canonical
auxiliary route controller exclusively. They never probe ambient native-window
globals; the presenter chooses an in-page or native disposition from the
negotiated host context.
Project and terminal tab editors use the canonical in-page auxiliary dialog.
Their shared route body owns the single visible heading and Save/Cancel journey;
opening a separate Electron child window is not part of this contract.

A normal arrangement may therefore be one Local window plus three windows
connected to three remote servers.

The production shared Connections route accepts the host-local
`ConnectionProfileStore` and narrow callbacks for switching, server revocation,
exposure, pairing, and rename. It keeps forget explicitly separate from revoke
with different confirmation copy and never writes a pairing URL into profile
metadata. Unsupported actions stay absent or disabled. The production Desktop
server-UI bridge supplies a
sanitized profile snapshot and source-bound actions, rejects profiles outside
the window's host context, allows exposure only for the current connection,
and consumes pairing credentials without retaining them. Final persisted
profile/window-registry callbacks use the exact `openProfileWindow` selection,
flush host-local writes before returning, and separate disconnect/forget from
server revocation.
The PWA manager persists its bookmark list only at the exact manager origin.
One-time pairing fragments never enter that storage. The connected shared
workspace enables the Connections route for the authenticated selected server.
Desktop uses the same production server-UI window composition for normal Local
and remote startup; no second workspace-window owner exists.

## Web connection host

- `app.terminay.com` has no Local server option and never claims browser
  filesystem/PTY authority.
- Its disconnected state is a connection picker: a saved-profile list with
  **Add new connection**, which opens a dedicated page to scan a pairing QR or
  paste a pairing URL, plus rename, open, and forget actions.
- Selecting a profile frames it in the current PWA view; an explicit action
  can open a first-party session tab.
- The PWA contains connection-profile management, the framed session host, and
  the origin-keyed credential vault. It does not run the workspace. It shows
  at most one framed session at a time.
- The framed workspace connection menu shows only the current connection plus
  **Switch connections**, which returns to the manager list. It does not list
  other saved manager profiles.
- Its installable application shell and saved profile list remain available
  offline; opening a profile requires the selected session origin to be
  reachable.
- The exact session-origin shell owns one replaceable transport generation for
  its mounted workspace, device authentication, WebRTC/signaling, bundle
  installation, and connection errors.
- The host stores bookmark metadata in localStorage or an equivalent browser
  store, and framed-session device credentials in manager-origin IndexedDB.
- The non-extractable browser device key for a framed PWA session lives in that
  manager vault. A first-party session document stores its key in
  IndexedDB/WebCrypto on the exact server session origin.
- The connection host cannot read terminal output, project names, paths, PINs,
  or workspace data. It may clone a vaulted device key only into the session
  iframe whose origin matches the vault slot.

The PWA uses a Local-disabled `ConnectionProfileStore` and a versioned
`terminay.web.connection-profiles.v1` metadata record. It restores malformed
records defensively and requires explicit confirmation for forget. Opening a profile frames that exact HTTPS origin in the current PWA view; an
explicit new-tab action is host-controlled and opens a first-party session
document. Pairing fragments are handed to the stable session origin without
being persisted or copied into the saved profile. Live connection, pairing,
offline, and revocation states are presented by the session origin, not
inferred by the manager.

The manager accepts only sanitized profile metadata. A profile retains only a
label, canonical origin, and local created/last-opened timestamps. Pairing URL
paths and fragments are discarded when the manager derives that profile.
Queries, origin userinfo, pairing material, and other credentials never become
bookmark state. Framed-session device credentials are vault state, not profile
metadata.

`app.terminay.com` is the stable connection manager. The selected server's
verified bundle renders the workspace at its stable session origin.

The stable session origin installs the selected server's bounded workspace
bundle after authentication. Bundle transfer and validation follow
[server runtime and application protocol](./server-runtime-and-protocol.md).
Bundle bytes, feature frames, pairing fragments, PINs, and connection tickets
never enter the manager origin. Framed-session device credentials enter only
the origin-keyed vault.

## Server-bundled workspace and host shell

The product has one full responsive workspace UI implementation:

- each server bundles it;
- local Desktop loads it from the embedded server;
- remote Desktop/browser clients load it through the selected server session
  origin and existing verified asset flow;
- it works standalone when the session URL is opened directly.
- On mobile browsers, the workspace follows the visual viewport and resizes the
  active terminal and surrounding content when the software keyboard appears.
  The focused terminal remains visible and interactive without trapping the
  page, and its previous geometry returns when the keyboard is dismissed.
  Browser-chrome expansion and collapse relayout the complete terminal panel in
  both dimensions; taking over an existing terminal cannot retain a stale
  compact viewport height after more vertical space becomes available.

Desktop may wrap that workspace in a small native shell. Its host bridge is
narrow, versioned, source-bound, and contains no terminal data, pairing
secrets, device keys, arbitrary filesystem paths, or generic Electron IPC.

Remote server-provided code inside Electron runs with sandboxing, context
isolation, Node integration disabled, and no ambient privileged preload. A
minimal host bridge validates every native action. The Desktop shell resolves
the selected server bundle manifest/assets only on that profile's exact session
origin. Same-origin bundle navigation is allowed; arbitrary origins, URL
credentials/query state, new windows, downloads, permission prompts, and custom
protocol handlers are denied by default. A privileged host may explicitly allow
one guarded request through the native policy boundary.

The bundle manifest declares compatible bootstrap, bundle-format, and
host-bridge revisions plus required/optional host capabilities. Missing optional capabilities
use browser-equivalent in-page behavior or a clear unavailable action. Missing
required compatibility blocks launch before committing connection state and
identifies whether the host or server must be upgraded.

Desktop commits a native window only after the bundle inventory has been
verified, its host compatibility requirements accepted, and an exact
profile/server/bundle binding reserved. Local reads the pinned bundle directly
from the embedded artifact and does not download it through a public listener.
Remote reads through its authenticated asset lane into an atomic,
content-addressed cache rooted beneath a digest of the exact server identity.
Interrupted or invalid replacement retains the last complete verified bundle
for that server. Every cache entry remains bound to its exact server identity.

The resulting renderer context contains only non-secret identity, negotiated
versions/capabilities, and an opaque byte-endpoint handle. Bootstrap
credentials, signaling state, transport objects, protected
keys, and raw cache paths remain in Desktop main. Native window identity and
server logical-view identity remain separate bindings, so focus/close does not
mutate a logical view without a typed server command.

## Browser connection journeys

Terminay supports two browser entry journeys. Both use the same session-origin
pairing, credential, server-bundle, and reconnect contracts.

### Open the hosted pairing link

1. The user copies the pairing URL shown in Terminay. Hosted servers advertise
   `https://app.terminay.com/?s=<session-id>&hostName=<optional>#<secret>`.
2. Pasting that URL into a browser, or opening the QR, lands on the manager.
   The manager consumes the fragment in memory and strips query and hash from
   the visible URL.
3. The manager asks **Save and connect**, with an optional title prefilled from
   `hostName` or the session id. Cancel discards the material. Confirm writes
   the bookmark and frames
   `https://<session-id>.terminay.com/v1/#<secret>` without storing the
   fragment.
4. The framed session origin establishes WebRTC, verifies and launches the
   selected server bundle, obtains the PIN or approval, creates the device key,
   and completes enrollment. When framed, that key is stored in the manager
   vault for `event.origin`.
5. A later visit to the saved profile or the stable session origin reconnects
   without reuse of the pairing URL.

A legacy first-party visit to `https://<session-id>.terminay.com/v1/#<secret>`
still enrolls at the session origin with session-origin IndexedDB.

### `app.terminay.com` PWA

1. The user opens `https://app.terminay.com` and sees the connection manager.
2. The user chooses **Add new connection**, then **Scan QR code** or **Paste
   pairing URL**, or opens a hosted pairing URL in this origin.
3. The manager validates the URL (manager-origin hosted links and legacy
   session-origin `/v1/` links), then uses the same **Save and connect** prompt.
4. Confirm frames the reconstructed session pairing URL. When framed, the
   session origin persists the device key in the manager vault.
5. Returning to the manager unloads the iframe and restores the saved profile
   from local browser storage.
6. Selecting the saved connection frames its stable session origin. That origin
   receives its device credential from the manager vault and reconnects without
   a pairing URL.

The manager does not participate in PIN entry and never receives the connection
ticket, terminal data, or workspace data. A missing or revoked device identity
requests a newly generated pairing URL. The saved manager profile remains until
the user chooses **Forget**.

Browser connection and device-enrollment prompts use the same centered,
responsive modal surface and form controls as the rest of the disconnected
browser host. Enrollment explains where to find the PIN, requires a non-empty
device name and six digits before enabling its primary action, and remains
fully inset from the viewport at narrow sizes. Starting a fresh pairing flow
does not show a missing-saved-credential warning; enrollment errors appear only
after an enrollment attempt fails.

Desktop **Add connection** accepts the same pairing URL, including hosted
`app.terminay.com` links, even when that URL would otherwise open a browser.
It never pairs against the manager origin. Browser and Desktop flows must
produce the same server-side device and audit semantics.

The Desktop connection host consumes the pairing fragment in memory. Hosted
links may carry non-secret `s`, `hostName`, and `pairingExpiresAt` query
fields; pairing secrets stay in the fragment. It persists only the exact
session origin plus sanitized profile metadata (default label from `hostName`).
The fragment and complete pairing URL are never returned by the host profile
API or serialized into the connection menu store. Enrollment runs against the
reconstructed session origin, not `app.terminay.com`.

On Desktop that operation is a closed host action: Electron performs device
enrollment, stores the device private key in its credential compartment, verifies
the selected server bundle, and replaces the current document's byte lane only
after the authenticated remote transport is ready. The renderer receives no
pairing fragment or private key.

## Exposing a server

- Embedded Local servers accept only the private Desktop transport and are not
  advertised by default.
- **Expose this server…** is available only with server administrative
  capability.
- The flow configures/validates the PIN or approval policy, starts WebRTC
  availability, and shows a short-lived pairing URL/QR, expiry, relay state,
  paired devices, live connections, and revoke/stop controls.
- The current Local MessagePort remains connected throughout exposure and is
  never presented as a selectable exposure route.
- The visible server/session origin is non-secret metadata. **Copy pairing
  link** and the QR contain the complete short-lived fragment credential and
  expiry; the UI does not present the bare origin as a usable connection URL.
- Generating a fresh pairing room does not disconnect existing clients.
- **Revoke** on a trusted browser immediately removes that device from the
  trusted-browser list and count. Revoked devices stay stored for reconnect
  rejection and are not shown as trusted.
- Stopping WebRTC exposure prevents new WebRTC reconnect/pairing but does not
  stop the Local server or its private local workspace.
- Standalone server CLI and UI use the same exposure/trust model.

## Responsive workspace behaviour

- Desktop and web render the same projects, panels, files, terminals, settings,
  recordings, agents, and connection state.
- Development and packaged Desktop launch that same server-bundled workspace;
  development changes only whether those generated assets are restored from the
  Turbo cache or rebuilt, not renderer entry, preload, state hydration,
  authority, or host-capability behaviour. The launched server-UI inventory
  contains only the current build's assets, so leftover hashed files from a
  previous rebuild cannot be published or launched.
- Source-development Desktop uses a dedicated `Terminay Development` user-data
  namespace by default. It must not read, mutate, or silently attach to an
  installed Terminay release's persistence or embedded server authority. Tests
  and migration tooling may select an explicit isolated namespace with
  `TERMINAY_USER_DATA_DIR`; packaged releases retain the normal `Terminay`
  namespace. Each selected namespace owns its durable opaque Local identity,
  Local profile route, server-UI partition, workspace/environment/recording
  stores, and bundle cache. Historical embedded records using the former
  canonical Local id migrate only within their own namespace before normal
  server/project/session validation; a foreign server identity is never
  adopted or rewritten.
- Wide layouts resemble the Electron workspace.
- Narrow layouts replace wide tab strips and sidebars with accessible
  selectors, drawers, stacked surfaces, and touch controls while retaining the
  same server object ids.
- Native-only window operations are capability-gated. Web clients manage
  server-owned logical workspace views through in-page navigation rather than
  requiring popup windows.
- Settings (including Extensions), project environments, macros, recordings,
  remote control, and edit-tab surfaces use shared routes/components. Electron
  presents Remote Control and Project Environments as first-class native
  management windows consistent with Settings, Macros, and Recordings, while
  edit-tab routes may use modal project-editor chrome. The web host presents
  the same routes in-page with equivalent open, focus, save, cancel, and close
  semantics.
- Project-tab and terminal-tab editing is a shared command. Double-click and
  long-press open the same editor. On Desktop it may open the native modal
  edit window. In web it opens the in-page edit-tab surface and returns focus
  to the edited project or terminal after save/cancel without depending on
  popup windows.
- Browser hosts expose an in-page application menu bar for the shared
  workspace. It contains File, Edit, View, and Help menus with the same
  command vocabulary as the Desktop native menu where the browser has an
  equivalent capability. Native-only entries such as OS window management,
  Desktop update installation, native file dialogs, and DevTools remain absent
  or disabled unless the host capability exists.
- Desktop hosts advertise native menus and therefore omit the in-page
  application menu entirely. macOS native title-bar insets keep traffic lights
  separate from project tabs and workspace controls.

## Connection persistence and privacy

Allowed host-local profile data:

- stable server id/fingerprint;
- exact non-secret session origin;
- user label and explicitly shared server display name;
- created/last-opened/last-connected timestamps;
- local window/view mapping and non-secret UI preferences;
- known/offline/expired/revoked/archived/unreachable state.

Forbidden in connection-manager localStorage, URLs, logs, and bookmark
records:

- pairing URL fragments and full unconsumed pairing URLs;
- PINs, terminal tickets, or server secrets;
- terminal output, command history, project roots, filenames, or recordings.

Device private keys never enter bookmark storage, `localStorage`, URLs, or
logs. In the framed PWA they live only in the origin-keyed manager IndexedDB
vault and in closed `postMessage` clones to the matching session iframe.

Desktop persistence is a closed allowlist: sanitized profiles, protected
credential references, native geometry and exact profile/view bindings,
verified bundle-cache metadata, update state, OS permission decisions, and
explicit device preferences. Workspace snapshots, application DTOs, project
roots, panel/terminal state, server settings, and feature capability
projections are forbidden in the host store. Unclassified fields fail closed.

The PWA profile is narrower than the Desktop profile: it contains only label,
stable session origin, created time, and last-opened time. The default label
comes from the pairing URL's non-secret `hostName` (the exposing server's
machine hostname). The session id in the origin remains the stable identifier.
The user can rename that local label. Pairing URL paths and fragments are
discarded when the manager derives that profile. Framed-session device
credentials are a separate IndexedDB vault, not profile fields.

## Failure behaviour

- A failed remote connection remains bound to its selected server.
- Offline preserves the profile and device identity and offers Retry through
  the session origin's reconnect operation.
- Connection errors remain visible and terminal input remains disabled until
  the new client, subscriptions, workspace, and mounted terminal attachments
  have hydrated successfully.
- A framed `app.terminay.com` session that has painted workspace chrome is
  not treated as connected unless live application events still arrive. Later
  PTY, new projects, and new terminals are those events. Resume from
  background uses the session origin's reconnect operation, not a second
  unmanaged signaling join. While recovery runs, connection chrome shows
  reconnecting and input stays disabled.
- Missing or revoked device identity requests a fresh pairing URL.
- Forget and revoke require confirmation explaining their different scopes.
- Closing/reloading the host preserves server-side sessions.
- If the host shell cannot safely load the server bundle, it shows a typed
  diagnostic and leaves the connection unopened.

WebRTC generation replacement and terminal resynchronization follow
[remote access](./remote-access.md) and
[terminal stream congestion and recovery](./terminal-stream-congestion-and-recovery.md).

## Non-goals

- No browser-owned Local Terminay server.
- No cloud account or cloud-synchronized connection list.
- No silent exposure of an embedded Local server.
- No arbitrary remote JavaScript with Electron/Node privileges.
- No requirement that browser UI use native popup windows.
- No independently versioned full workspace application at
  `app.terminay.com`.
- No renderer-selected `mode=electron` or equivalent privilege switch.
- No Desktop feature client or persisted workspace mirror used to translate
  between remote server application versions.

## Acceptance outcomes

- Desktop opens to **Local**, and its connection menu can expose Local, add a
  remote, and focus/open separate remote windows. That menu lists remembered
  profiles and omits **Switch connections**.
- A framed `app.terminay.com` workspace connection menu shows the current
  connection and **Switch connections**, not the manager's other saved
  profiles.
- Four Electron windows can safely show one Local and three remote servers
  without crossing server, project, or credential state.
- The web host offers the same add/manage/switch journey without showing a
  Local option.
- File → Remote Control and the header connection-menu manage control open the
  same Remote Control management window as Settings/Macros, including that
  family's sidebar-and-content chrome, not an Edit Tab sheet. Remote Control
  also manages this server's exposure, pairing links, trusted browsers, and
  live connections.
- The installed PWA can open its manager and saved profile list offline without
  claiming that an unreachable session origin is connected.
- Opening a pairing link directly enrolls the browser and later opening the
  stable session origin reconnects without the one-time link.
- The advertised hosted pairing URL is on `app.terminay.com`. Opening it asks
  **Save and connect** with an optional title, then frames session-origin
  enrollment. Scanning or pasting that URL in `app.terminay.com` uses the same
  prompt. The manager stores only the stable-origin profile, not the fragment.
- Returning to `app.terminay.com` lists the saved connection, and selecting it
  frames the stable session origin and reconnects from the manager vault
  without reusing pairing material.
- Desktop **Add connection** accepts the same hosted pairing URL and enrolls
  against the session origin, not `app.terminay.com`.
- Stable session origins run the server's exact bundled responsive UI.
- Local Desktop, remote Desktop, and browser sessions launched against one
  server report the same verified bundle id; only their transport and declared
  host capabilities differ.
- A Desktop shell connects only when the selected bundle's declared bootstrap,
  bundle format, byte transport, execution runtime, and required bridge
  contracts validate successfully.
- Forgetting a profile does not claim to revoke server access; revoking a
  device closes it server-side.
- Forgetting or revoking an unrelated remote profile leaves an active Local
  workspace connected and its terminals usable without a retry.
- A malicious or compromised server bundle cannot obtain Electron Node access
  or another session origin's credentials through the host bridge.
- Browser recovery restores ordered terminal input without duplicate PTYs or
  workspace mutations.
- Returning to a framed PWA session reconnects or fails visibly; it does not
  remain on the session loading mark with no in-flight generation.
