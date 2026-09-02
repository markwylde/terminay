# ADR-0005: Load server UI in a sandboxed, origin-bound partition in both Desktop and browser hosts

Status: accepted
Date: 2026-07-27

## Context

A Terminay client connects to a server the user selected, and that server
supplies the UI the client runs. That UI is therefore code of unknown
trustworthiness from the client's point of view. Desktop already exposes a broad
`window.terminay` preload to its own renderer; handing that surface to
server-provided code would give a remote server native authority over the
machine. On the web, several servers may be reachable from one connection shell,
so one server's UI must not be able to read another's credentials or storage.

## Decision

Each Desktop connection window loads one selected server UI in a sandboxed,
origin-bound partition. It uses a dedicated minimal preload; the existing broad
`window.terminay` preload is never exposed to server-provided code.

`app.terminay.com` is a thin parent connection shell containing one
exact-session-origin frame. Cross-origin messages are source-checked,
origin-checked, schema-validated, and limited to sanitized profile display data
and explicit host actions.

## Consequences

- Server UI cannot reach Node, Electron IPC, another partition, downloads,
  popups, ambient permissions, or credentials in either host.
- Every capability the server UI needs from the host must be added deliberately
  to a closed schema, rather than being available by default.
- Clipboard access requires iframe `allow`, top-level Permissions Policy, and
  permission for both the session and top-level origins. Clipboard permission is
  therefore an explicit user capability, not a credential-isolation boundary.
- Embedded session cookies must use `Secure; SameSite=None; Partitioned`
  (CHIPS); ordinary third-party `SameSite=Strict` cookies are not available to
  the framed session in current Chromium.

### Electron host evidence

`e2e/server-ui-sandbox.spec.ts` loads a hostile fixture through
`electron/serverUiHost.ts` and its dedicated preload, verifying:

- sandboxing, context isolation, disabled Node integration and webviews, and the
  absence of the broad Terminay and WebRTC-host preloads;
- one exact main-frame origin and opaque persistent partition per connection
  profile;
- a frozen, schema-exact host context/action bridge with rejected extra fields,
  subframes, and unbound senders;
- denied popups, downloads, cross-origin navigation and redirects, and denied
  notification, geolocation, microphone, and ambient clipboard-read permission;
- normal focused keyboard input and user-initiated native paste without granting
  programmatic clipboard reads; and
- cookie, localStorage, and IndexedDB separation between two same-origin server
  windows in different opaque profile partitions.

### Browser host evidence

`e2e/web-client-host.spec.ts` runs a parent connection shell, two exact session
origins, and an attacker origin in Chromium, verifying:

- exact source, origin, protocol version, and closed-schema validation for every
  host/session message;
- rejection of sibling impersonation and extra-field schema smuggling;
- inaccessible parent and sibling DOM plus separate cookies, IndexedDB, Cache
  Storage, device-key, reconnect-grant, and workspace sentinels;
- responsive iframe sizing, ResizeObserver reporting, keyboard focus and input,
  clipboard permission delegation, sandboxed navigation, CSP `frame-src`, and
  session `frame-ancestors`; and
- rejection when an unauthorized origin attempts to frame a session.

## Open items

- Headless Chromium does not prove mobile soft-keyboard visual-viewport
  movement. The separate
  [iOS Safari xterm mobile-viewport spike](./evidence/ios-safari-mobile-viewport-spike.md)
  loads real xterm inside the exact-origin session frame on an iOS 26.5 Safari
  simulator, focuses its helper textarea, types through the actual software
  keyboard, keeps the terminal inside the shrunken visual viewport, and restores
  the layout after dismissal. Physical-device, rotation, landscape, and complete
  release-UI coverage remain release gates rather than foundation blockers.
- The Electron server-UI window factory is not part of normal Desktop startup
  until a connection-host implementation binds each window to a selected server
  profile.
