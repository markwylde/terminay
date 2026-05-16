# Remote Access WebRTC Specification

> Production origin-isolation, compact QR, cookie/session, and wildcard subdomain hardening work is tracked in `REMOTE_REFACTOR.md`. This document describes the original WebRTC remote access design and current baseline.

## Summary

Terminay should keep the current local-network remote access flow and add a second WebRTC flow for phones that cannot directly reach, trust, or load the desktop app's local HTTPS origin.

The product should offer two pairing modes:

- **Local Network**: Works as it does today. Terminay serves the remote HTML, CSS, JavaScript, APIs, and WebSocket from the desktop machine at a reachable address such as `https://192.168.1.23:9443`.
- **WebRTC**: The user opens a compact QR URL such as `https://<channel>.terminay.com/v1/#<qr-secret>`, and that per-session hosted page establishes a WebRTC connection to the desktop app. The `app.terminay.com` origin is only a manager/launcher and is not trusted with pairing secrets. The hosted service stays deliberately thin. The desktop app still supplies the real remote app bundle and owns all terminal APIs.

The hosted session page is a secure bootstrapper, signaling participant, and asset loader. It should not contain the full terminal UI, should not terminate terminal sessions, and should not persist remote terminal data. Any QR scanning is done by the phone's camera or OS before the browser opens the session URL.

## Goals

- Preserve the current local IP QR flow unchanged.
- Add a WebRTC QR flow that works from a public HTTPS origin.
- Let the hosted session origin provide service worker support and WebRTC bootstrapping.
- Keep the desktop app as the authority for pairing, authentication, terminal sessions, static app assets, and audit state.
- Keep the hosted server simple enough to run as static hosting plus a small signaling relay.
- Reuse as much of the existing remote browser app and protocol as practical.
- Keep paired-device security at least as strong as the existing RSA device-key and challenge flow.

## Non-Goals

- This spec does not require internet-wide remote access without the desktop app being online.
- This spec does not require the hosted server to proxy terminal traffic.
- This spec does not require the hosted server to store device keys, terminal data, command history, or session metadata.
- This spec does not require replacing the existing HTTPS and WebSocket local server.
- This spec does not require TURN hosting in the first implementation, though the design should leave room for it.

## Current Codebase Shape

Terminay already has a remote access split between Electron main and a browser client.

Electron owns the host side in `electron/remote/`:

- `electron/remote/service.ts` starts an HTTPS server, serves static files, handles pairing/auth HTTP routes, upgrades `/ws`, and bridges terminal sessions to remote clients.
- `electron/remote/config.ts` requires an `https://` origin and resolves bind address, host, port, and TLS paths.
- `electron/remote/pairing.ts` creates short-lived pairing URLs with `pairingSessionId`, `pairingToken`, and `pairingExpiresAt`.
- `electron/remote/deviceStore.ts`, `challengeStore.ts`, `connectionStore.ts`, and `auditStore.ts` own trust, authentication challenges, WebSocket tickets, live connections, and audit events.

The browser remote app lives in `src/remote/`:

- `src/remote/App.tsx` renders pairing, QR scanning, terminal tabs, settings, and the xterm surface.
- `src/remote/services/auth.ts` posts to `/api/pairing/start`, `/api/pairing/complete`, `/api/auth/options`, and `/api/auth/verify`.
- `src/remote/services/socket.ts` connects to the host WebSocket URL returned by auth.
- `src/remote/protocol.ts` defines the terminal control protocol for listing, attaching, writing, resizing, and receiving output.

The current remote status UI lives in `src/App.tsx` and exposes available LAN addresses, pairing QR codes, active connections, paired devices, and audit state.

## Product Model

### Local Network Mode

Local Network mode remains the default and should keep its current behavior:

1. The user starts Remote Access from Terminay.
2. Terminay selects a reachable local HTTPS origin, usually a `192.168.*` or `10.*` address.
3. Terminay generates a QR code containing the full pairing URL.
4. The phone opens that URL directly.
5. The desktop app serves `remote.html`, assets, pairing/auth APIs, and `/ws`.
6. The phone pairs or authenticates and uses the existing WebSocket terminal protocol.

No WebRTC dependency should be introduced into this path.

### WebRTC Mode

WebRTC mode adds a second pairing option:

1. The user starts Remote Access and chooses the WebRTC option.
2. Terminay creates a short-lived WebRTC pairing session and connects to the public signaling relay.
3. Terminay shows a QR code for the hosted bootstrap page. The QR contains only the information needed to join the signaling room and prove possession of the pairing secret.
4. The user opens the QR URL on the phone, for example `https://<channel>.terminay.com/v1/#<qr-secret>`.
5. The hosted bootstrap page joins the signaling room, exchanges WebRTC offer/answer/ICE messages, and opens a data channel to the desktop app.
6. The bootstrap page requests the actual remote app bundle from the desktop over the data channel.
7. The hosted page installs or updates those assets under its own origin, then launches the real remote app.
8. Pairing, auth, terminal session control, and terminal output all flow between the phone and desktop over WebRTC data channels.

From the user's point of view, the terminal should feel like the existing remote app after pairing completes.

## Hosted Server Responsibilities

The hosted service should be intentionally small.

Required hosted pieces:

- A static bootstrap HTML page.
- A static bootstrap JavaScript bundle.
- A static web manifest and icons if needed for installability.
- A service worker that can serve desktop-provided assets from Cache Storage.
- A minimal WSS signaling relay for short-lived WebRTC rooms.

The hosted service may provide:

- STUN server configuration.
- TURN server configuration later, if NAT traversal needs it.
- Very small health and version endpoints.

The hosted service must not:

- Host the full Terminay remote terminal app.
- Serve terminal HTML, CSS, or JavaScript beyond the bootstrapper.
- Proxy terminal input/output.
- Store pairing tokens after room expiry.
- Store terminal session names, output, keystrokes, device private keys, or audit logs.
- Accept unauthenticated room joins.

## Desktop App Responsibilities

The desktop app remains the real remote host.

It must provide:

- The existing local HTTPS mode.
- WebRTC pairing session creation and QR generation.
- A signaling client that connects to the hosted relay only while WebRTC pairing is active.
- WebRTC peer connection creation, ICE handling, and data channel lifecycle.
- A virtual asset server over the WebRTC data channel.
- A virtual API and terminal transport over WebRTC.
- Device pairing, device authentication, audit logging, revocation, and connection management.

The desktop app should serve the same built remote bundle it already serves locally. The WebRTC path should not require maintaining a separate terminal UI implementation.

## QR Payloads

Local Network QR payloads remain full local pairing URLs:

```text
https://192.168.1.23:9443/?pairingSessionId=...&pairingToken=...&pairingExpiresAt=...
```

Production WebRTC QR payloads are defined by `REMOTE_REFACTOR.md`. The old shared-origin draft below is obsolete and should not be implemented for production. The current production plan uses a per-session channel subdomain plus a path protocol version:

```text
https://<channel>.terminay.com/v1/#<qr-secret>
```

The previous shared-origin draft was:

```text
https://app.terminay.com/connect?mode=webrtc&v=1&roomId=...#relayJoinToken=...&pairingSessionId=...&pairingToken=...&pairingExpiresAt=...&signalingAuthToken=...
```

That obsolete draft used query fields like:

- `mode=webrtc`
- protocol version, such as `v=1`
- `roomId`

And fragment fields like:

- `relayJoinToken`
- `pairingSessionId`
- `pairingToken`
- `pairingExpiresAt`
- `signalingAuthToken`
- optional `hostName` or user-facing desktop label

The QR should not include SDP blobs or individual protocol tokens. SDP payloads are too large and brittle for QR scanning, and individual tokens make the QR bigger than needed. The QR should identify a short-lived signaling room through the channel subdomain and carry one QR-only fragment secret that derives relay, pairing, signaling-HMAC, asset-install, and CSRF secrets.

The derived `relayJoinToken` should be separate from the derived `pairingToken`. The signaling relay can validate the relay token before forwarding messages, while the actual Terminay pairing token is only validated by the desktop app after the WebRTC data channel is open.

The QR should not include the user's pairing PIN. The PIN is a local desktop setting used as a second human-authentication factor after the phone scans the QR.

## Signaling Relay

The signaling relay should be a small WSS service.

Suggested endpoints:

- `GET /` serves the bootstrap page.
- `GET /sw.js` serves the service worker.
- `GET /healthz` returns server health.
- `GET /versionz` returns build/runtime version details.
- `GET /metrics` returns redacted operational metrics for the service.
- `WSS /signal` handles room signaling.

Suggested signaling messages:

```ts
type SignalMessage =
  | { type: 'host-ready'; roomId: string; relayJoinTokenHash: string; expiresAt: string }
  | { type: 'client-join'; roomId: string; relayJoinToken: string }
  | { type: 'client-accepted'; roomId: string }
  | { type: 'offer'; roomId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; roomId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; candidate: RTCIceCandidateInit; roomId: string }
  | { type: 'error'; message: string }
```

Room behavior:

- Rooms are created by the desktop app.
- Rooms expire at the pairing expiry time, with a hard maximum such as 10 minutes.
- A room accepts one active client during pairing.
- The relay validates that the client knows the relay join token before forwarding signaling messages.
- The relay deletes room state when the peer connection is established, the host disconnects, or the room expires.

The relay should forward signaling only. It should not inspect or proxy application data channels.

## WebRTC Data Channels

Use separate data channels so the terminal protocol cannot be blocked by large asset transfers.

Suggested channels:

- `control`: lifecycle messages, pings, version negotiation, and errors.
- `asset`: virtual static file requests and responses.
- `api`: pairing and auth request/response messages.
- `terminal`: the existing remote terminal protocol currently carried over WebSocket.

In the first implementation, `api` and `terminal` may share one reliable ordered channel if that simplifies the client adapter. Assets should remain separate because cached bundle downloads can be larger.

## Serving The Remote App Bundle Over WebRTC

The hosted bootstrap page should not include the real terminal app bundle. Instead:

1. The hosted bootstrap page opens WebRTC.
2. It requests an asset manifest from the desktop app over the `asset` channel.
3. The desktop returns a manifest describing the built `remote.html`, JavaScript, CSS, manifest, icons, and any hashed Vite assets.
4. The bootstrap page downloads those files over WebRTC.
5. The bootstrap page writes them into Cache Storage under paths such as `/remote-app/current/remote.html` and `/remote-app/current/assets/...`.
6. The service worker serves those cached files as same-origin resources.
7. The bootstrap page navigates to `/remote-app/current/remote.html`.

This keeps the hosted app server basic while still letting browser security treat the launched app as a secure same-origin application.

The service worker should:

- Only serve assets that came from an authenticated WebRTC desktop session.
- Keep assets scoped under a reserved path such as `/remote-app/`.
- Evict stale desktop-provided bundles after a successful update or after a short retention window.
- Fall back to the bootstrap page if no bundle is cached.

The desktop asset manifest should include:

- asset path
- content type
- byte length
- content hash
- cache policy
- remote app protocol version

## API Transport Adapter

The existing `src/remote/services/auth.ts` assumes HTTP `fetch` to same-origin endpoints. The WebRTC version should introduce a transport abstraction rather than duplicating the app.

Suggested shape:

```ts
type RemoteApiTransport = {
  postJson<TResponse>(pathname: string, body: unknown): Promise<TResponse>
}

type RemoteTerminalTransport = {
  connect(ticket: string): Promise<RemoteMessageSocket>
}
```

Local Network mode implements these with `fetch` and `WebSocket`.

WebRTC mode implements these with request/response messages over WebRTC data channels. The virtual paths should match existing paths:

- `/api/pairing/start`
- `/api/pairing/complete`
- `/api/auth/options`
- `/api/auth/verify`
- `/ws` equivalent for terminal messages

This lets the remote React app keep the same pairing, authentication, and terminal UI logic while swapping the transport underneath it.

## Pairing And Origin Security

The current implementation binds devices to `window.location.origin`. In WebRTC mode the phone's origin is the exact session subdomain, for example `https://<channel>.terminay.com`.

That keeps the manager isolated and changes what the desktop stores:

- Local Network paired devices are bound to the selected local origin.
- WebRTC paired devices are bound to the exact session origin plus a WebRTC transport marker.

Suggested stored identity fields:

```ts
type RemoteDeviceOrigin =
  | { kind: 'local'; origin: string }
  | { kind: 'webrtc'; origin: string; protocolVersion: 'v1' }
```

The pairing token still proves possession of the QR payload. The device key still proves the same browser/device on later connections. The WebRTC data channel should additionally verify that the remote app has completed the same pairing/auth flow before terminal messages are accepted.

WebRTC Relay mode also requires a 6-digit pairing PIN once the user has configured one. The first WebRTC QR generation should prompt for a PIN if none is stored. Terminay stores only a salted `scrypt` hash of that PIN in local settings. After scanning the QR and establishing the signed WebRTC data channel, the phone asks for the PIN and sends it with `/api/pairing/start`; the desktop verifies the PIN before accepting the pairing token or creating a pending device registration.

This PIN protects a different threat than the QR-only relay secrets. The relay token and signaling HMAC stop an untrusted relay from joining or rewriting the WebRTC handshake. The PIN protects against a nearby person scanning the QR code before the intended phone owner does. The PIN is not sent to the signaling relay, is not encoded in the QR, and is checked by the desktop as the final pairing gate.

The desktop should treat WebRTC connections exactly like WebSocket connections after authentication:

- issue a short-lived connection ticket
- register a connection id
- enforce monotonically increasing `seq`
- require attach before write/resize
- audit connection opened/closed
- support connection close from Settings
- support device revocation

## Content Security Policy

Local Network mode can keep its current strict CSP.

The hosted bootstrap CSP should allow only what the bootstrapper needs:

- scripts from self
- styles from self
- images from self and data URLs for lightweight status UI
- WebSocket connection to the signaling origin
- WebRTC connections
- service worker registration

The launched remote app should use the same or stricter CSP as the current local app. If module assets are served from Cache Storage under the hosted origin, they can remain same-origin and avoid broad script exceptions.

## NAT Traversal

Initial WebRTC mode should use public STUN servers or a configurable STUN list.

TURN should be planned as a follow-up capability:

- Add hosted or third-party TURN credentials.
- Keep TURN credentials short-lived.
- Surface a clear UI state when direct WebRTC connection fails and TURN is unavailable.

Without TURN, some networks will fail. The UI should say WebRTC could not connect and suggest Local Network mode when available.

## UX Requirements

Remote Access settings and the Remote menu should expose two clear connect options:

- **Local Network QR**
- **WebRTC QR**

The pairing modal should show:

- the selected mode
- a QR code
- expiry time
- connection state
- a short hint for when to choose the other mode

The WebRTC flow should show these states:

- waiting for phone to open QR URL
- phone connected, establishing secure channel
- loading remote app from this computer
- pairing or authenticating
- connected
- failed, with retry and local-network fallback

The hosted bootstrap page should be sparse:

- open QR URL
- show connection progress
- show a useful error
- retry

It should not look like a separate product surface.

## Settings

Add remote access settings for WebRTC:

```ts
type RemoteAccessMode = 'local' | 'webrtc'

type RemoteWebRtcSettings = {
  enabled: boolean
  hostedDomain: string
  stunUrls: string[]
  turnUrl: string
  turnUsername: string
  turnCredential: string
}
```

Recommended defaults:

- `enabled`: `true`
- `hostedDomain`: `terminay.com`
- `stunUrls`: include one default STUN endpoint or leave configurable for packaged builds
- TURN fields blank

The existing `remoteAccess.origin`, `bindAddress`, and TLS fields remain local-network settings.

## Architecture

### 1. Remote Transport Boundary

Introduce transport interfaces shared by the remote browser app:

- API transport for JSON request/response.
- Terminal transport for the existing protocol.
- Asset transport for WebRTC bootstrap only.

This keeps Local Network and WebRTC modes from forking the UI.

### 2. Desktop WebRTC Host Service

Add an Electron-side service, likely under `electron/remote/webrtcHost.ts`, responsible for:

- creating WebRTC pairing sessions
- joining signaling rooms as host
- creating peer connections
- opening data channels
- serving asset requests
- forwarding virtual API requests into the existing pairing/auth handlers
- forwarding terminal channel messages into the existing connection handling path

Where possible, refactor `RemoteAccessService` so request handlers can be called by both HTTP and WebRTC transports instead of copying the pairing/auth logic.

### 3. Hosted Bootstrap App

Create a tiny separate build target for the hosted page:

- compact QR URL parser
- QR parser
- signaling client
- WebRTC client
- asset downloader
- service worker installer
- launcher for cached desktop-provided app

This can live in the same repository if Terminay owns deployment, but it should be built as a separate artifact from the desktop-bundled remote app.

### 4. Asset Virtualization

Add a desktop-side virtual static file service that can read the same files currently served by `handleStaticRequest`.

It should expose:

- `GET_MANIFEST`
- `GET_ASSET`
- optional chunked asset transfer for larger files

The manifest should be generated from the packaged remote build output and public assets.

### 5. Remote Client Boot Mode

The launched remote app needs to know which transport to use.

Suggested options:

- Add a bootstrap-injected config object before launching the remote app.
- Store a short-lived WebRTC session id in IndexedDB.
- Infer WebRTC mode from the exact session origin and versioned path, such as `https://<channel>.terminay.com/v1/`.

Avoid storing pairing tokens in long-lived localStorage. Pairing tokens should stay in memory and expire quickly.

### 6. Connection Model

The existing `ConnectionStore` should remain the source of truth for live remote connections.

For WebRTC, add a socket-like adapter around the terminal data channel so existing connection registration and message handling can be reused. If direct reuse is awkward because `ConnectionStore` currently stores `ws` sockets, introduce a small `RemoteConnectionPeer` interface with `send`, `close`, and state callbacks, then adapt both WebSocket and WebRTC peers to it.

## Implementation Plan

### Phase 1: Refactor Existing Remote Transport

- Extract API route logic from `handleRequest` into reusable methods.
- Extract terminal connection logic from WebSocket-specific code into peer-agnostic helpers.
- Add transport interfaces in `src/remote/services/`.
- Keep Local Network behavior and tests passing.

### Phase 2: Hosted Bootstrap Prototype

- Add a minimal hosted bootstrap app.
- Add QR parsing for WebRTC payloads.
- Add signaling client.
- Add service worker and Cache Storage asset install flow.
- Add a local development harness for the hosted origin.

### Phase 3: Desktop WebRTC Host

- Add WebRTC settings and status fields.
- Add signaling relay client.
- Add WebRTC host peer connection and data channels.
- Add WebRTC QR generation.
- Add asset manifest and asset channel serving.

### Phase 4: Virtual API And Terminal Transport

- Implement WebRTC API request/response routing.
- Implement WebRTC terminal protocol routing.
- Reuse pairing, auth, tickets, session attach/write/resize, audit, revocation, and status updates.
- Add reconnection behavior or explicitly mark WebRTC sessions as one-shot for the first release.

### Phase 5: Product Polish And Failure States

- Add mode selection to the Remote menu and pairing modal.
- Add WebRTC connection state to `RemoteAccessStatus`.
- Add clear failure messages for expired QR, relay unavailable, WebRTC failed, and app bundle load failed.
- Document Local Network versus WebRTC setup.

## Remote Terminal Sizing

Mobile and desktop terminal screens usually have opposite shapes. Desktop terminals are often wide and short, while phones are narrow and tall. The remote app should not try to make the phone behave like a miniature desktop viewport.

The active mobile remote tab should become the temporary size owner for its terminal session:

1. When the mobile remote activates a terminal tab, that terminal session should resize to the mobile terminal area's calculated `cols` and `rows`.
2. The desktop app should keep the Dockview panel and app window at their existing desktop size.
3. The desktop xterm.js instance for that session should render at the mobile-owned `cols` and `rows`, centered inside the existing desktop terminal panel.
4. The visible area around the centered xterm should use the project or terminal background color so the desktop panel still looks intentional.
5. When the mobile remote switches to another tab, detaches, disconnects, or remote access stops, the previous desktop terminal should return to normal desktop-fit sizing.

This makes the terminal PTY geometry match the currently used input surface. Because the mobile remote only shows one terminal at a time, the active remote tab is a good proxy for the user's current terminal. Desktop users still keep their window layout, split panes, and panel sizes unchanged.

### Current Behavior To Replace

The current remote app treats the desktop session dimensions as authoritative:

- The desktop `TerminalPanel` fits to its Dockview panel and sends those `cols` and `rows` to Electron.
- `RemoteAccessService` broadcasts those dimensions to remote clients.
- The mobile remote resizes its xterm to the desktop `cols` and `rows`.
- The mobile UI compensates with scroll wrappers, zoom, and desktop-canvas measurements.

This causes awkward horizontal scrolling and brittle viewport matching on phones.

### Desired Size Ownership Model

Size ownership should be explicit and temporary:

- **Desktop-owned**: default state. The desktop `TerminalPanel` fits its local Dockview panel and resizes the PTY.
- **Remote-owned**: while a remote client has a session attached and active. The active remote xterm fits the phone terminal area and sends its calculated `cols` and `rows` to the host.

Only one remote tab should be size owner for a session at a time. If multiple remote clients exist, the most recently attached or activated remote tab can own the session until it detaches or another remote tab becomes active. A later implementation may add stronger multi-client rules, but the first version should optimize for the normal phone-as-controller case.

### Remote App Responsibilities

The remote browser app should calculate terminal geometry from its own visible terminal area:

- Use xterm.js sizing, likely through `FitAddon`, to calculate `cols` and `rows` from the mobile terminal container.
- Send a terminal protocol `resize` message whenever the active remote tab changes, the remote terminal area changes size, orientation changes, font settings change, or the accessory bar changes height.
- Attach to the selected session before sending input or resize messages.
- Stop sizing the mobile terminal from desktop `viewportWidth`, `viewportHeight`, or desktop `cols` and `rows`.
- Simplify the mobile scroll wrapper so normal terminal width and scrollback behavior can do most of the work.

The remote app can still keep zoom controls if they are useful, but zoom should change the phone-owned terminal geometry rather than scaling a desktop-sized terminal surface.

### Desktop Host Responsibilities

`RemoteAccessService` should treat a remote resize from the active attached session as a remote size override:

- Resize the PTY to the remote-provided `cols` and `rows`.
- Update the remote session record so other remote UI state sees the active dimensions.
- Notify the owning desktop renderer that a remote size override is active for that session.
- Clear the override when the remote detaches, switches away, disconnects, or remote access stops.
- Notify the owning desktop renderer when the override clears.

The desktop renderer needs a new IPC event for these override changes. The event should include the session id, whether the override is active, and the remote-owned `cols` and `rows` when active.

### Desktop Renderer Responsibilities

The desktop `TerminalPanel` should support two sizing modes:

- In normal mode, keep the existing `FitAddon.fit()` behavior and send desktop `cols` and `rows` to Electron.
- In remote override mode, call `terminal.resize(remoteCols, remoteRows)` and avoid sending desktop-fit resize messages back to Electron.

While remote override mode is active:

- Do not resize the Dockview group, app window, or desktop panel.
- Center the xterm element within the existing terminal panel.
- Fill the surrounding panel area with the project or terminal background color.
- Keep keyboard input, output rendering, search, copy, and terminal note UI working.

When the override clears, the panel should run the normal desktop fit path once so the PTY returns to the desktop terminal dimensions.

### Feedback Loop Avoidance

The implementation must avoid resize ping-pong:

- A remote-owned resize should not trigger the desktop `TerminalPanel` to immediately fit to desktop dimensions and overwrite it.
- A desktop panel resize observer should not send PTY resize messages while remote override mode is active.
- Remote clients should debounce or coalesce resize messages from viewport and layout changes.
- Session updates caused by remote-owned resize should not make the remote app resize from stale desktop metadata.

### Testing Requirements

Remote terminal sizing tests should cover:

- Mobile remote selecting a tab resizes the PTY to phone dimensions.
- Desktop xterm renders those phone dimensions centered without changing Dockview layout.
- Switching mobile tabs restores the previous desktop tab and applies remote sizing to the newly active tab.
- Disconnecting, detaching, stopping remote access, or closing the phone restores desktop-fit sizing.
- Phone rotation and remote font-size changes recompute mobile-owned dimensions.
- Scrollback works naturally on the phone without requiring desktop-width horizontal panning.

## Testing

Unit tests should cover:

- WebRTC QR payload creation and parsing.
- Pairing expiry and room expiry behavior.
- Pairing PIN validation, salted hashing, and constant-time verification.
- Transport selection in the remote app.
- Asset manifest generation and path safety.
- Origin binding for local versus WebRTC devices.

Integration tests should cover:

- Existing Local Network pairing still works.
- Hosted bootstrap accepts the current `/v1/` session-subdomain QR URL.
- WebRTC asset install writes files into Cache Storage.
- The launched remote app uses WebRTC transports.
- The desktop prompts for a first-use WebRTC pairing PIN before generating a QR and stores only the hash.
- Pairing requests with an incorrect configured PIN are rejected before device registration.
- Pairing, auth, session list, attach, write, resize, and output work over WebRTC.
- Device revocation closes a WebRTC connection.

E2E tests should mock the signaling relay and WebRTC primitives where possible so CI does not need real phones or public network infrastructure.

Manual QA should include:

- iOS Safari.
- Android Chrome.
- Desktop Chrome.
- Same-LAN WebRTC.
- Phone on cellular with desktop on home Wi-Fi.
- Relay unavailable.
- Expired QR.
- Camera permission denied.
- Local Network mode after WebRTC failure.

## Open Questions

- Should WebRTC mode be enabled by default in packaged builds or hidden behind an advanced setting until TURN support exists?
- Who operates the signaling relay and possible TURN service?
- Should a WebRTC paired device be allowed to reconnect later without opening a new QR URL, or should WebRTC always require a fresh QR?
- Should the manager support paste/manual entry for WebRTC URLs in addition to OS camera scanning?
- How long should desktop-provided remote app assets remain cached under the hosted origin?

## Implementation Checklist

### Existing Local Network Mode

- [ ] Preserve the current local HTTPS server and pairing QR flow.
- [ ] Preserve existing available-address selection.
- [ ] Preserve existing pairing/auth/WebSocket protocol behavior.
- [ ] Add regression tests before touching transport internals.

### Shared Remote Transport

- [ ] Define API and terminal transport interfaces for the remote browser app.
- [ ] Implement Local Network transport with `fetch` and `WebSocket`.
- [ ] Refactor auth and socket services to use the transport boundary.
- [ ] Keep the current remote UI behavior unchanged in Local Network mode.

### Hosted Bootstrap

- [ ] Create the hosted bootstrap build target.
- [ ] Implement `/v1/` session-subdomain QR parser for WebRTC payloads.
- [ ] Implement WSS signaling client.
- [ ] Implement WebRTC peer setup.
- [ ] Implement service worker asset serving under `/remote-app/`.
- [ ] Implement Cache Storage install/update for desktop-provided assets.

### Desktop WebRTC Host

- [ ] Add WebRTC settings and defaults.
- [ ] Add WebRTC status fields to `RemoteAccessStatus`.
- [ ] Add 6-digit pairing PIN storage, hashing, prompting, and `/api/pairing/start` verification.
- [ ] Add signaling relay client.
- [ ] Add WebRTC pairing session creation.
- [ ] Add WebRTC QR generation.
- [ ] Add WebRTC peer connection and data channels.
- [ ] Add virtual asset manifest and file-serving logic.

### WebRTC Remote Runtime

- [ ] Implement virtual API request/response over data channel.
- [ ] Implement terminal protocol over data channel.
- [ ] Reuse pairing, auth, tickets, connection registration, audit logging, and revocation.
- [ ] Add connection close/error propagation to the UI.

### Remote Terminal Sizing

- [x] Add an explicit remote size ownership model to `RemoteAccessService`.
- [x] Track the active remote-owned session per connection and clear ownership on detach, tab switch, disconnect, and remote access stop.
- [x] Make remote `resize` update the PTY, update the session record, broadcast session dimensions, and notify the owning desktop renderer.
- [x] Add a desktop renderer IPC event for terminal remote size override changes.
- [x] Expose the IPC event through `electron/preload.ts` and `src/types/terminay.ts`.
- [x] Update the remote app to calculate `cols` and `rows` from its visible mobile terminal area.
- [x] Send remote resize messages when the active remote tab, viewport, orientation, font settings, zoom, or accessory bar size changes.
- [x] Stop sizing the mobile xterm from desktop `cols`, `rows`, `viewportWidth`, or `viewportHeight`.
- [x] Simplify the mobile terminal scroll wrapper so the phone terminal fits width naturally.
- [x] Add remote override mode to desktop `TerminalPanel`.
- [x] In remote override mode, resize the desktop xterm instance to the remote-owned `cols` and `rows`.
- [x] In remote override mode, suppress desktop `FitAddon.fit()` PTY resize messages.
- [x] Center the remote-sized desktop xterm inside the existing terminal panel without resizing Dockview or the app window.
- [x] Fill the surrounding desktop panel area with the project or terminal background color.
- [x] Restore normal desktop-fit sizing when the remote override clears.
- [ ] Add tests for mobile tab activation, tab switching, disconnect, remote access stop, phone rotation, font-size changes, and natural phone scrollback.

### Docs And QA

- [ ] Update Remote Access docs with Local Network and WebRTC modes.
- [ ] Add troubleshooting for relay failures, expired QR, NAT failures, and TURN limitations.
- [ ] Add unit/integration/E2E coverage for both modes.
- [ ] Manually verify on iOS Safari and Android Chrome.
