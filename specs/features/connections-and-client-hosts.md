# Connections and client hosts

## Summary

Terminay Desktop and `web.terminay.com` share one connection journey. The
header server control is a current-server selector and connection menu.

Desktop starts connected to its embedded server as **Local**. Browser clients
have no embedded server and begin with a remembered connection or connection
picker. Both hosts can add, remember, open, switch, inspect, and forget remote
Terminay Server connections. An authorized local Desktop window can also expose
its embedded server so other desktop or browser clients can pair with it.

## Concepts

- A **server connection** is an authenticated relationship with one stable
  Terminay Server identity.
- A **connection profile** is host-local metadata such as label, session origin,
  server identity/fingerprint, last-opened time, and status.
- A **connection window** is an Electron window or browser view bound to one
  server and optionally one logical workspace view.
- **Expose this server** makes an authorized server available for remote
  pairing/reconnect. It does not change which server the current window renders.
- **Disconnect** closes the client transport. It does not stop the server or
  terminate its PTYs.
- **Forget** removes host-local metadata/credentials after confirmation.
  **Revoke** changes server authorization and closes affected connections.

## Shared header journey

The header displays the current server label, not the transport:

```text
[ Local ▼ ]
[ Production VPS ▼ ]
[ Home Mac · Offline ▼ ]
```

The menu contains:

- current server identity and connection state;
- remembered connections, grouped or ordered consistently;
- focus/open/switch actions appropriate to the host;
- **Add connection…** and **Manage connections…**;
- **Expose this server…** when the current device is allowed to manage
  exposure;
- retry, disconnect, forget, and revoke actions with distinct language; and
- diagnostics that distinguish server offline, relay unavailable, WebRTC
  route failure, expired grant, revoked device, incompatible version, and
  failed switch actions. Failed switch actions keep the selector visible and
  show the host-provided failure reason instead of logging only to the native
  terminal.

The exposure control reports mode capability separately from runtime state.
It must not label an unavailable mode **Ready**, offer **Expose & show QR**, or
wait for a start-time exception when the host already knows that the required
listener, WebRTC runtime, or authenticated signaling authority is absent.
Unavailable modes remain visible for diagnosis and link to their configuration
or build requirement, but their start actions are disabled.

The shared browser-safe UI package projects this model into an accessible
`menuitemradio` list with stable ordering, position/set-size metadata, and
keyboard/touch focus behavior (arrow wrapping, Home/End, Escape, and explicit
activation). Host capabilities gate administrative actions such as exposure;
the menu never invokes a native operation directly.

The same package exposes a route registry for workspace, connections, settings,
recordings, macros, file, and Git surfaces. Browser hosts keep every route
in-page; Desktop may present eligible secondary routes in native auxiliary
windows only when its `nativeWindows` capability is declared.

Desktop development and auxiliary query routes render those same production
shared route bodies against the authenticated embedded-server clients. They do
not substitute legacy placeholder content for connections, Git, agents,
folders, or terminal views.

The existing activity/notification indicator remains separate. Connection
status must not be conflated with terminal or agent attention.

## Terminay Desktop

- Startup supervises the embedded server and opens/focuses a window bound to
  its **Local** profile.
- The initial native window is explicitly bound to immutable Local and the
  header reports the selected profile label/status (including Local failure or
  offline state), never a transport name. Local uses authenticated loopback
  transport and does not require internet access, hosted signaling, or WebRTC;
  remote profiles require their own selected transport.
- A Desktop installation has one embedded Local server identity and may
  remember any number of remote profiles.
- A native window is bound to exactly one server at a time. Its title and
  security scope make the connection clear.
- Selecting a profile focuses an existing window for that connection/view when
  appropriate or opens a new sandboxed window. Rebinding the current window is
  an explicit action, not an accidental side effect of menu selection.
- A newly opened Desktop connection window remains in the normal loading state
  until its own local or remote server connection is ready; the originating
  window keeps its existing server binding during that handoff.
- Multiple windows may target the same server and different logical workspace
  views. Other windows may simultaneously target other servers.
- Local server startup, shutdown, crash recovery, and update are host actions.
  Remote server shutdown/update is never implied by closing its window.
- Desktop stores non-secret profiles locally and credentials through OS-backed
  secure storage where available.
- A Desktop connection created from a one-time standalone application URL uses
  that authenticated first session to enroll reconnect material before saving
  the profile as switchable. One-time URLs are never stored or reused for later
  switching.
- A remote HTTP event feed is a replayable projection channel, not the command
  transport's lifetime signal. If that feed ends unexpectedly, Desktop and Web
  reconnect it from the last observed revision while keeping independent
  query/command responses live; an event-stream interruption must not turn an
  in-flight command into an unknown outcome.

The Desktop host foundation keeps the connection manager deliberately separate
from server workspace state. A profile record contains only its stable server
identity, exact session origin, display metadata, timestamps, and a diagnostic
status; pairing fragments, device keys, reconnect grants, terminal data, and
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

Native actions are exposed through a versioned, source-bound host bridge. Each
request is checked against its bound window and current connection, rejects
unknown payload fields, and requires a user gesture for actions that can read
or change native state. The bridge surface is limited to window/view focus and
close, menu commands, clipboard, approved file selection, HTTPS external
links, server-owned reveal tokens, update status, and notifications. Server-bundled renderers
receive a `TerminayClient` and capability provider rather than Electron or
generic IPC imports.

A normal arrangement may therefore be one Local window plus three windows
connected to three remote servers.

The production shared Connections route accepts the host-local
`ConnectionProfileStore` and narrow callbacks for switching, server revocation,
exposure, and pairing handoff. It supports sanitized add/import and rename,
keeps forget explicitly separate from revoke with different confirmation copy,
and never writes a pairing URL into profile metadata. Unsupported actions stay
absent or disabled. The production Desktop server-UI bridge supplies a
sanitized profile snapshot and source-bound actions, rejects profiles outside
the window's host context, allows exposure only for the current connection,
and consumes pairing credentials without retaining them. Final persisted
profile/window-registry callbacks use the exact `openProfileWindow` selection,
flush host-local writes before returning, separate disconnect/forget from
server revocation, and persist only the sanitized profile returned by pairing.
The Web manager renders the same action body through `WebConnectionHost`;
profile metadata remains at the exact manager origin, storage events rebuild
the sanitized projection in other tabs, and one-time pairing fragments never
enter localStorage. The connected shared workspace enables the Connections
route with those same persisted callbacks. Desktop exposes a tested
`createDesktopServerUiWindow` composition seam, but the current legacy
Electron bootstrap has no server-bundle window caller to adopt it yet; that
authority replacement remains explicit parity work rather than creating a
second BrowserWindow owner.

## Web connection host

- `web.terminay.com` has no Local server option and never claims browser
  filesystem/PTY authority.
- Its disconnected state is a connection picker with add/import, remembered
  profiles, offline/revoked status, and clear recovery.
- Selecting a profile opens it in the current browser view; an explicit action
  can open another browser tab.
- The host stores only non-secret connection metadata in localStorage or an
  equivalent browser store.
- Origin-bound device keys and reconnect grants remain in IndexedDB/WebCrypto
  storage on the exact server session origin.
- The connection host cannot read terminal output, project names, paths, device
  keys, reconnect grants, PINs, or session-origin storage.

The browser host implementation uses a Local-disabled `ConnectionProfileStore`
and a versioned `terminay.web.connection-profiles.v1` metadata record. It
restores malformed records defensively, keeps offline/relay/WebRTC/expired/
revoked/unreachable statuses distinct, and requires explicit confirmation for
forget or revoke. Opening a profile constructs a route-only URL on that exact
HTTPS origin; an explicit new-tab action is host-controlled. Pairing fragments
are consumed in memory and are not returned, persisted, or copied into the
session URL. The host bridge accepts messages only from the exact selected
session origin and expected window source, and rejects privileged payload keys.

Legacy manager records are redirected from `app.terminay.com` to the stable
`web.terminay.com` manager only as sanitized profile metadata. Profile ids,
server ids, labels, fingerprints, and canonical origins may be retained;
pairing fragments, device keys, reconnect grants, and other credentials are
discarded. A session record retains only a canonical origin; legacy paths,
queries, fragments, or origin userinfo are rejected rather than becoming
manager state or a session credential.

`web.terminay.com` is a stable host/manager, not a latest independent workspace
client. The selected server's verified bundle renders the workspace.

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

Desktop and web connection hosts may wrap that workspace in a small stable
shell. Cross-origin communication is narrow, versioned, and validated:

- parent-to-workspace messages may provide non-secret current-profile display
  metadata and request safe navigation/focus actions;
- workspace-to-parent messages may report sanitized readiness, connection
  status, server display name, or request an allowed host action;
- every browser message checks exact origin and source window;
- no bridge passes terminal data, pairing secrets, device keys, reconnect
  grants, arbitrary filesystem paths, or generic Electron IPC;
- the server UI declares explicit `frame-ancestors` when embedding is used;
  and
- direct standalone mode provides its own compact connection action or a safe
  route back to the manager.

Remote server-provided code inside Electron runs with sandboxing, context
isolation, Node integration disabled, and no ambient privileged preload. A
minimal host bridge validates every native action. The Desktop shell resolves
the selected server bundle manifest/assets only on that profile's exact session
origin. Same-origin bundle navigation is allowed; arbitrary origins, URL
credentials/query state, new windows, downloads, permission prompts, and custom
protocol handlers are denied by default. A privileged host may explicitly allow
one guarded request through the native policy boundary.

## Adding and pairing a connection

1. The user chooses **Add connection…** and pastes/opens a secure pairing URL,
   scans its QR code, or follows an OS deep link.
2. The client consumes the one-time fragment in memory and removes it from
   visible/history state.
3. The hosted bootstrap and server establish WebRTC through the data-blind
   signaling service.
4. The server bundle is hash-verified and launched on the exact session origin.
5. Device-key pairing and PIN/approval complete against the server.
6. The selected server origin is the credential compartment. A static browser
   host keeps the compartment in IndexedDB keyed by that exact server origin:
   it derives a non-extractable WebCrypto proof key from the one-time grant,
   discards the grant, and keeps only sanitized profile metadata in
   `localStorage`.
7. Later opening uses a server challenge, the origin-bound proof key, and a
   fresh short-lived application ticket. Missing/expired/revoked credentials ask for
   fresh pairing without destroying the remembered non-secret profile unless
   the user forgets it.

Desktop may accept the pairing URL in its connection menu even when the URL
would otherwise open a browser. Browser and Desktop flows must produce the same
server-side device and audit semantics.

The Desktop connection host consumes a pasted/deep-link pairing URL's
one-time HTTPS fragment in memory, rejects credentials and query data, and
persists only the exact session origin plus sanitized profile metadata. The
fragment and any pairing URL path are never returned by the host profile API or
serialized into the connection menu store; protocol pairing completes as a
separate operation against that origin.

## Exposing a server

- Embedded Local servers are loopback-only and not advertised by default.
- **Expose this server…** is available only with server administrative
  capability.
- The flow configures/validates the PIN or approval policy, starts WebRTC
  availability, and shows a short-lived pairing URL/QR, expiry, relay state,
  paired devices, live connections, and revoke/stop controls.
- Generating a fresh pairing room does not disconnect existing clients.
- Stopping exposure prevents new remote reconnect/pairing but does not stop the
  Local server or its local workspace.
- Standalone server CLI and UI use the same exposure/trust model.

## Responsive workspace behaviour

- Desktop and web render the same projects, panels, files, terminals, settings,
  recordings, agents, and connection state.
- Wide layouts resemble the Electron workspace.
- Narrow layouts replace wide tab strips and sidebars with accessible
  selectors, drawers, stacked surfaces, and touch controls while retaining the
  same server object ids.
- Native-only window operations are capability-gated. Web clients manage
  server-owned logical workspace views through in-page navigation rather than
  requiring popup windows.
- Settings, macros, recordings, and edit-tab surfaces use shared
  routes/components. Electron may present a route in a native auxiliary window;
  the web host presents the same route in-page with equivalent open, focus,
  save, cancel, and close semantics.
- Project-tab and terminal-tab double-click editing is a shared command. On
  Desktop it may open the native modal edit window. In web it opens the
  in-page edit-tab surface and returns focus to the edited project or terminal
  after save/cancel without depending on popup windows.
- Browser hosts expose an in-page application menu bar for the shared
  workspace. It contains File, Edit, View, and Help menus with the same
  command vocabulary as the Desktop native menu where the browser has an
  equivalent capability. Native-only entries such as OS window management,
  Desktop update installation, native file dialogs, and DevTools remain absent
  or disabled unless the host capability exists.

## Connection persistence and privacy

Allowed host-local profile data:

- stable server id/fingerprint;
- exact non-secret session origin;
- user label and explicitly shared server display name;
- created/last-opened/last-connected timestamps;
- local window/view mapping and non-secret UI preferences;
- known/offline/expired/revoked/archived/unreachable state.

Forbidden in connection-manager localStorage, URLs, host messages, and logs:

- pairing URL fragments and full unconsumed pairing URLs;
- PINs, device private keys, reconnect grants, proof keys, signaling HMACs,
  terminal tickets, or server secrets;
- terminal output, command history, project roots, filenames, or recordings.

## Failure behaviour

- A failed remote connection never falls back to Local or another remembered
  server silently.
- Offline preserves the profile and credentials and offers Retry.
- Expired/revoked explains whether fresh pairing or server-side approval is
  required.
- Forget and revoke require confirmation explaining their different scopes.
- Closing/reloading the host preserves server-side sessions.
- If the host shell cannot safely load or embed the server bundle, it offers
  the direct session URL and diagnostics instead of weakening sandbox/origin
  policy.

## Non-goals

- No browser-owned Local Terminay server.
- No cloud account or cloud-synchronized connection list.
- No silent exposure of an embedded Local server.
- No arbitrary remote JavaScript with Electron/Node privileges.
- No requirement that browser UI use native popup windows.
- No independently versioned full workspace application at
  `web.terminay.com`.

## Acceptance outcomes

- Desktop opens to **Local**, and its connection menu can expose Local, add a
  remote, and focus/open separate remote windows.
- Four Electron windows can safely show one Local and three remote servers
  without crossing server, project, or credential state.
- The web host offers the same add/manage/switch journey without showing a
  Local option.
- Direct server URLs and host-embedded sessions run the server's exact bundled
  responsive UI.
- Forgetting a profile does not claim to revoke server access; revoking a
  device closes it server-side.
- Forgetting or revoking an unrelated remote profile leaves an active Local
  workspace connected and its terminals usable without a retry.
- A malicious or compromised server bundle cannot obtain Electron Node access
  or another session origin's credentials through the host bridge.
