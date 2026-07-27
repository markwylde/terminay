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
  route failure, expired grant, revoked device, and incompatible version.

The existing activity/notification indicator remains separate. Connection
status must not be conflated with terminal or agent attention.

## Terminay Desktop

- Startup supervises the embedded server and opens/focuses a window bound to
  its **Local** profile.
- A Desktop installation has one embedded Local server identity and may
  remember any number of remote profiles.
- A native window is bound to exactly one server at a time. Its title and
  security scope make the connection clear.
- Selecting a profile focuses an existing window for that connection/view when
  appropriate or opens a new sandboxed window. Rebinding the current window is
  an explicit action, not an accidental side effect of menu selection.
- Multiple windows may target the same server and different logical workspace
  views. Other windows may simultaneously target other servers.
- Local server startup, shutdown, crash recovery, and update are host actions.
  Remote server shutdown/update is never implied by closing its window.
- Desktop stores non-secret profiles locally and credentials through OS-backed
  secure storage where available.

A normal arrangement may therefore be one Local window plus three windows
connected to three remote servers.

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

`web.terminay.com` is a stable host/manager, not a latest independent workspace
client. The selected server's verified bundle renders the workspace.

## Server-bundled workspace and host shell

The product has one full responsive workspace UI implementation:

- each server bundles it;
- local Desktop loads it from the embedded server;
- remote Desktop/browser clients load it through the selected server session
  origin and existing verified asset flow;
- it works standalone when the session URL is opened directly.

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
minimal host bridge validates every native action.

## Adding and pairing a connection

1. The user chooses **Add connection…** and pastes/opens a secure pairing URL,
   scans its QR code, or follows an OS deep link.
2. The client consumes the one-time fragment in memory and removes it from
   visible/history state.
3. The hosted bootstrap and server establish WebRTC through the data-blind
   signaling service.
4. The server bundle is hash-verified and launched on the exact session origin.
5. Device-key pairing and PIN/approval complete against the server.
6. The origin stores its private key/reconnect grant; the connection host
   stores only sanitized profile metadata.
7. Later opening uses reconnect. Missing/expired/revoked credentials ask for
   fresh pairing without destroying the remembered non-secret profile unless
   the user forgets it.

Desktop may accept the pairing URL in its connection menu even when the URL
would otherwise open a browser. Browser and Desktop flows must produce the same
server-side device and audit semantics.

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
- Settings/recordings/edit surfaces use shared routes/components. Electron may
  present a route in a native auxiliary window; the web host presents it
  in-page.

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
- A malicious or compromised server bundle cannot obtain Electron Node access
  or another session origin's credentials through the host bridge.
