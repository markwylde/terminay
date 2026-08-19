# Remote access

## Summary

Terminay Server exposes its complete workspace to authorized Desktop and
browser devices over WebRTC. Remote connections use the same server-owned
workspace, terminal sessions, application protocol, and responsive UI as the
Local Desktop connection.

Remote access has one transport, one device-enrollment model, and one durable
browser credential model. `app.terminay.com` is a PWA connection manager: it
stores bookmarks to stable server origins, frames those origins so an installed
iOS app stays chrome-less, and holds framed-session device credentials. It does
not enter PINs, run WebRTC, or render the workspace.

This feature works with
[connections and client hosts](./connections-and-client-hosts.md),
[server runtime and application protocol](./server-runtime-and-protocol.md),
and the [PWA framed session host](../decisions/pwa-framed-session-host.md)
decision.

## Model

Remote browser access uses five concepts:

- A **stable session origin** is the permanent HTTPS origin for one Terminay
  Server, such as `https://<server-id>.terminay.com`.
- A **pairing URL** is the advertised one-time enrollment link. Hosted servers
  advertise it on `https://app.terminay.com` so paste-into-browser lands on the
  PWA. The fragment is the one-time secret. A non-secret `s` query identifies
  the stable session origin. Direct `/v1/` session URLs still enroll a
  first-party session document, but they are not the copyable hosted link.
- A **browser device identity** is one non-extractable private key. A
  first-party session document stores it at the stable session origin. A PWA
  framed session stores it in the manager vault slot for that origin. The
  server stores the corresponding public key, device id, name, and revocation
  state.
- A **manager profile** is a non-secret bookmark stored by
  `app.terminay.com`. It contains a label, stable session origin, and local
  timestamps. When the PWA frames a session, the manager also holds that
  origin's device credential in a separate origin-keyed vault.
- A **server host key** is a long-lived key pair owned by Terminay Server for
  its stable session origin. Signaling stores the public key. The private key
  never leaves the server. This proves the WebRTC host is that server. It is
  not a browser device key.

The pairing secret enrolls a browser device once. It is not a reconnect
credential. Future connections prove possession of the browser device key. The
server host key is how signaling knows the reconnect host is the same server.

## Ownership

- Terminay Server owns pairing policy, device registration, public device keys,
  revocation, application authorization, workspace state, audit history, and
  the private host key for its session origin.
- The stable session origin owns browser pairing, WebRTC lifecycle,
  server-bundle installation, reconnect, and challenge signing. A first-party
  session document stores the device key at that origin. A PWA-framed session
  loads and saves that key through the manager vault.
- `app.terminay.com` owns the browser's list of manager profiles, the framed
  session iframe, and the origin-keyed device-credential vault used while a
  session is framed. It does not own pairing PIN entry, WebRTC, or the
  workspace.
- The signaling service routes authenticated WebRTC offers, answers, and ICE
  candidates for one server session. It admits a pairing client only with the
  fragment-derived join credential. It admits a reconnect host only when that
  host proves the registered server host key.
- TURN may relay encrypted WebRTC packets and does not terminate the Terminay
  application protocol.

Each server has one stable session origin. Credentials created at one origin or
for one server never authorize another.

## Exposure

Servers are not remotely reachable until an administrator enables **Expose
this server…**.

Exposure:

- connects the server to Terminay's authenticated WebRTC signaling service
  before advertising a pairing URL. Standalone `terminay-server` registers the
  fragment-derived pairing room (`host-ready`) the same way Desktop does, and
  registers its server host key before it is reachable for pairing or
  reconnect. A later host claim for the same session must prove the same
  private key. A different key does not replace a live registration;
- applies the configured six-digit PIN or explicit approval policy;
- generates a short-lived pairing URL and QR code. Hosted links are
  `https://app.terminay.com/?s=<session-id>&hostName=<optional>#<secret>`.
  The session subdomain stays the WebRTC peer. `hostName` is a non-secret
  default label from the exposing machine;
- keeps the advertised QR current: when a pairing room is within seconds of
  expiry, or after a pairing client has connected, Desktop mints a replacement
  room and the QR card visibly refreshes without disconnecting live clients or
  dropping reconnect availability;
- displays exposure expiry, signaling and relay health, paired devices, and
  live connections; and
- allows the administrator to generate another pairing URL, revoke a device,
  or stop exposure. **Create pairing link** while the server is already
  exposed mints a new one-time fragment and registers that room. It does not
  re-show a pairing room a client has already joined.

A pairing room is one-time and short-lived. Exposure and the signed reconnect
host (`device-host-ready`) stay up until the administrator stops exposure.
Pairing-room expiry, pairing-socket close, or minting a replacement QR must
not close live WebRTC peers or unregister the reconnect host. Desktop
refreshes `device-host-ready` before that registration expires.

Generating another pairing URL keeps the stable session origin, registered
devices, live connections, and server-owned PTYs unchanged. After a browser
pairs, the QR stays visible while a checkmark draws over it, then the modal
closes. The QR must not vanish or be replaced by a preparing message while
that overlay runs. Stopping exposure blocks pairing
and reconnect while leaving Local Desktop use and server-owned work running.

The same exposure model applies to an embedded Local server and standalone
`terminay-server`. Desktop and the CLI both start the server-owned hosted
pairing host: it registers the fragment-derived pairing room and the signed
reconnect host (`device-host-ready`) before a pairing URL is advertised. The
host accepts authenticated application transports on the `application` data
channel. Desktop always serves the built server UI archive; the CLI serves
that archive when `TERMINAY_UI_RENDERER_DIRECTORY` points at `dist-web`.

## Browser journey A: open the pairing link

1. The user copies the pairing URL from Terminay and pastes it into a browser,
   or opens the QR. The advertised hosted URL is on `app.terminay.com`.
2. The manager consumes the fragment in memory and strips query and hash from
   the visible URL and history.
3. The manager asks whether to **Save and connect**, with an optional title
   prefilled from `hostName` or the session id.
4. Cancel discards the pairing material and does not save a profile.
5. Confirm saves or updates the manager profile with that title, keeps
   `https://app.terminay.com` as the top-level document, and loads the
   reconstructed session pairing URL (`https://<session-id>.terminay.com/v1/#…`)
   in a fullscreen iframe without storing the fragment.
6. The framed session origin performs enrollment: WebRTC, PIN or approval,
   device key, and workspace install. It loads or saves that origin's device
   credential through the manager vault.

A legacy first-party visit to `https://<session-id>.terminay.com/v1/#…` still
enrolls at the session origin with session-origin IndexedDB and does not use
the manager vault.

The complete pairing URL cannot be used again. Opening the saved profile or
the stable session origin later uses the registered browser device identity.
A later **Create pairing link** advertises a new fragment; scanning or pasting
the previous code is rejected as already used.

## Browser journey B: `app.terminay.com` PWA add flow

1. The user opens `https://app.terminay.com`.
2. The PWA lists manager profiles stored in that browser.
3. The user chooses **Add new connection**, then scans the pairing QR with the
   device camera, chooses a photo of that QR, or pastes a pairing URL.
4. The PWA validates the URL, including manager-origin hosted links and legacy
   session-origin `/v1/` links, then uses the same **Save and connect** prompt
   as opening the link in a browser.
5. Confirm frames the reconstructed session pairing URL without leaving
   `app.terminay.com`.
6. **Back to connections** returns to the manager list without navigating
   `window.top`. From a connected workspace this is **Switch connections**
   and **File → Disconnect**. Desktop omits **Switch connections** because
   its connection menu lists every remembered profile.
7. Selecting a saved profile loads that stable session origin in the same
   fullscreen iframe. The session authenticates with the vaulted device key
   and reconnects.

If the framed session has no valid device identity, that session page asks
for a fresh pairing URL. The manager profile remains until the user chooses
**Forget**, which also deletes that origin's vault slot.

**Open in new tab** uses a first-party session document. That document stores
its device key in session-origin IndexedDB and does not share the manager
vault. Direct and framed credentials for the same origin are separate.

The framed host uses one closed, origin-checked `postMessage` schema for
device credentials, clipboard, microphone, notifications, and shell control.
It does not proxy WebRTC, workspace frames, or generic storage. The manager
keys vault entries only by `event.origin` and clones a credential only into
the iframe that matches that origin. Structured clone keeps the key
non-extractable. The manager never signs.

The PWA shows at most one framed session. Opening another connection replaces
that iframe. The session speaks to `parent` only when `parent.origin` is
`https://app.terminay.com`; it ignores any other embedder. Clipboard and
microphone messages require a user gesture in the manager or in the iframe
surface that requested them. The iframe `allow` list may include clipboard and
microphone and does not include camera. Camera stays on the manager for QR
scan.

The manager pins the titlebar and session iframe to the visual viewport,
including when the iOS keyboard is visible. The iframe sits below the
titlebar; the workspace inside it does not add `env(safe-area-inset-top)`
again. Session and workspace script never assign `window.top`
or use `target="_top"`. `target="_blank"` may open a first-party tab.

An iOS Home Screen PWA has storage isolated from Safari. Pairing in Safari
does not populate the PWA vault, and pairing in the PWA does not populate
Safari.

## Desktop journey

Terminay Desktop **Add connection** accepts the same pairing URL as the
browser, including hosted `https://app.terminay.com/?s=…#…` links. The
privileged connection host never treats `app.terminay.com` as the server. It
reads the session id from `s`, the one-time secret from the fragment, and
the default profile label from `hostName` when present.

It then pairs against the stable session origin using the existing device-enroll
exchange on that origin. The device key stays in OS-protected storage. The
saved remote profile is the session origin plus that label. The selected
server's verified workspace bundle opens in a sandboxed window.

Desktop renderers receive an opaque authenticated byte endpoint and non-secret
profile identity. Pairing secrets and private device keys remain in the
privileged connection host.

## Reconnect

1. The user opens a stable session origin directly, selects its PWA manager
   profile, or opens its Desktop profile.
2. The server sends a short-lived challenge containing the server identity,
   session origin, device id, nonce, and expiry.
3. The client signs the challenge with its device private key.
4. The server verifies the signature with the registered public key and checks
   expiry and revocation state.
5. The server issues a short-lived, single-use connection ticket bound to that
   authenticated device and WebRTC peer.
6. The client opens the application transport and resumes workspace and
   terminal subscriptions from confirmed revisions and sequence positions.

Standalone `terminay-server` keeps a device-authentication signaling session
(`device-host-ready`) for the stable session origin while the process is
exposed. Signaling accepts that registration only when the host proves
possession of the same server host key that was registered for that origin.
Opening that origin later joins it with `device-join` and then proves the
browser device key to that server. Pairing rooms stay one-time and are not
reused for reconnect.

The pairing fragment authenticates a one-time pairing client. After it is
consumed, reconnect cannot reuse it. The server host key is the durable proof
that this process is still the WebRTC host for that origin. Knowing the public
session hostname is not enough to become that host. The browser device key
still answers a different question: whether this is the same paired device.

The device private key is the only durable browser authentication secret.
Connection tickets exist only for individual connection attempts.

## PWA connection manager

`app.terminay.com` is installable as a PWA and works as a local connection
manager. It uses the same dark workspace chrome, mark, and compact controls as
the connected Terminay workspace. It provides:

- **Add new connection**, which opens a dedicated page to **Scan QR code**
  (camera or photo) or **Paste pairing URL**;
- a list of saved manager profiles;
- **Open** as the primary row action, which frames the session origin in the
  current PWA view, with **Open in new tab**, rename, and forget in an
  overflow menu; and
- same-document PWA chrome by default, with that explicit first-party
  open-in-new-tab action.

Its application shell and saved profile list remain available offline. Opening
a profile still requires that profile's stable session origin to be reachable.

The manager profile store contains only:

- label;
- canonical stable session origin; and
- created and last-opened timestamps.

The manager accepts hosted pairing URLs on `app.terminay.com` and legacy
session-origin `/v1/` URLs. It stores only the reconstructed stable session
origin as the bookmark. A non-secret `hostName` query may supply the default
local label. Opening or pasting a pairing URL asks **Save and connect** before
that bookmark is written; the user may set a title there. The manager rejects
URL credentials, unsupported schemes, and any query other than `s`,
`hostName`, and `pairingExpiresAt`. It never stores the pairing fragment or
complete pairing URL.

The framed-session vault is separate from the bookmark list. It stores only
that origin's non-extractable device private key plus the non-secret device
id/name needed to reconnect. It lives in manager-origin IndexedDB, not
`localStorage`. The manager never signs with those keys; the session iframe
does. Pairing fragments, PINs, tickets, terminal data, and workspace data
never enter the vault.

## Server-bundled workspace

The server distribution contains the complete responsive workspace UI and its
matching application-protocol client. The stable session origin authenticates
the device, obtains the selected server bundle through the WebRTC asset lane,
validates its declared contract and resource bounds, and launches it under that
same origin.

`/api/host-context` is a closed host-context schema. Display names travel on
the pairing URL and session-host `hostName`, never as extra host-context
fields.

WebRTC DataChannel payloads stay within the negotiated SCTP maximum message
size. The UI archive is transferred as acknowledged binary chunks of at most
64 KiB on the `asset` and `assets` lanes, with at most four unacknowledged
chunks in flight. Archive transfer failures send typed JSON
`asset:bundle-error` (`cancelled`, `timeout`, `unavailable`, `invalid-request`,
or `internal`) and do not take down the host process. The application protocol
frame budget is separate from this SCTP limit; a send that would exceed the
negotiated SCTP maximum fails that channel with a visible error instead of
aborting Electron.

`app.terminay.com` contains the connection manager only. Desktop and browser
hosts do not supply another workspace implementation or interpret feature-level
application messages.

## Connection recovery

The stable session origin owns one WebRTC connection generation for its mounted
workspace. Network loss keeps server-owned PTYs and work running. The browser
shows reconnecting state, creates a fresh authenticated generation, restores
subscriptions, and enables input only after hydration completes.

Automatic recovery and **Retry connection** use the same reconnect operation.
Expired or revoked device identity stops recovery and requests pairing. Closing
one browser tab or Desktop window affects only that client connection.

Detailed ordering, congestion, and terminal resynchronization are governed by
[terminal stream congestion and recovery](./terminal-stream-congestion-and-recovery.md).

## Persistence and privacy

The stable session origin may store, when it is a first-party document:

- device id and name;
- the non-extractable browser private key; and
- non-secret server identity metadata.

When the session is framed by the PWA, that credential lives in the manager
vault.

The manager origin may store:

- manager profiles (label, origin, timestamps); and
- per-origin framed-session device credentials in IndexedDB.

The server may store:

- device id and name;
- public device key;
- the private host key for its session origin;
- creation, last-seen, and revocation metadata; and
- security audit events.

The signaling service may store the public host key or fingerprint for a
session. It never stores the private host key.

The signaling service, TURN service, logs, analytics, and URLs never contain
private device keys, private host keys, pairing fragments, PINs, connection
tickets, terminal output, project names, paths, filenames, command history,
recordings, settings, or secrets. Host `postMessage` carries only the closed
framed-host schema. The manager vault may hold per-origin device credentials
for framed sessions and may clone a credential only to the matching session
origin.

## Failure behaviour

- An expired or consumed pairing URL asks the user to generate another one.
  The exposing Desktop host auto-rotates its advertised QR before that
  happens, so a QR left on screen remains a live room.
- A missing browser device key asks for a fresh pairing URL.
- A revoked device cannot reconnect until enrolled as a new device.
- A host that cannot prove the registered server host key cannot take over
  that session's signaling registration. Exposure fails closed if a different
  key is already registered.
- Offline server, signaling failure, relay failure, invalid server identity,
  invalid bundle, archive transfer failure, and revoked device are distinct
  visible errors.
- Failed pairing leaves any PWA manager profile available for retry or forget.
- Failed reconnect keeps the mounted workspace read-only until recovery or
  explicit disconnect.
- Failure never selects another server or terminates server-owned PTYs.

## Security invariants

- Pairing URLs are short-lived and single-use.
- The fragment is consumed in memory and is never sent in an HTTP request.
- Pairing requires the fragment plus PIN or explicit approval. Pairing PIN
  fields use a password input so the six-digit code is not shown in the clear.
- A public session origin, server id, device id, or PIN alone grants no access.
- Signaling admits a reconnect host only with proof of the registered server
  host key. A public session origin or server id cannot become the WebRTC host
  for that session.
- Browser private keys are non-extractable. A first-party session document
  binds them to that session origin. A framed PWA session binds them to the
  manager vault slot for that exact origin.
- The manager clones a vaulted key only to `event.origin` of the requesting
  session iframe. An iframe cannot name another origin's slot.
- The session posts to `parent` only when that parent is `app.terminay.com`.
- Device revocation affects live and future connections.
- Hosted services remain data-blind for Terminay application content.
- Remote server code inside Desktop has no Node integration or generic preload
  authority.
- Full-control remote access is equivalent to interactive shell access to the
  selected Terminay Server.

## Non-goals

- No cloud account or cloud-synchronized connection list.
- No browser-owned Local server.
- No reusable pairing link.
- No independent workspace application at `app.terminay.com`.
- No generic storage, IndexedDB, or cookie proxy between manager and session.
- No merging of PWA vault credentials with first-party session-origin
  IndexedDB or with Safari's copy of the same origin.

## Acceptance outcomes

- Opening a hosted pairing URL lands on `app.terminay.com`, asks **Save and
  connect** with an optional title, and frames session-origin enrollment
  without leaving the manager.
- Cancel on that prompt does not save a profile or consume the pairing as a
  stored bookmark.
- Opening that stable session origin later, or selecting the saved profile,
  reconnects without the pairing URL.
- A second host that knows only the session origin cannot replace the
  registered reconnect host.
- Scanning or pasting the same pairing URL in the PWA uses the same save
  prompt and frames enrollment without leaving `app.terminay.com`.
- Returning to the PWA list unloads the iframe; selecting the profile frames
  the stable session origin and reconnects from the manager vault.
- **Open in new tab** and a legacy first-party `/v1/` pairing URL enroll at
  the session origin with session-origin IndexedDB.
- Desktop **Add connection** accepts the same hosted pairing URL, pairs
  against the session origin, and never enrolls against `app.terminay.com`.
- The pairing fragment never appears in manager storage, session URLs after
  consumption, requests, logs, or analytics.
- The browser stores one durable private device key per session origin
  (first-party document) or per manager-vault slot (framed PWA); the server
  stores its public key and revocation state.
- Revoking one device closes it without affecting other devices, Local Desktop,
  or server-owned PTYs.
- Local Desktop, remote Desktop, and browser clients connected to one server
  observe the same workspace and terminal sessions.
- Network interruption reconnects without duplicating PTYs or workspace
  mutations.
