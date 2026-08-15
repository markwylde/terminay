# Remote access

## Summary

Terminay Server exposes its complete workspace to authorized Desktop and
browser devices over WebRTC. Remote connections use the same server-owned
workspace, terminal sessions, application protocol, and responsive UI as the
Local Desktop connection.

Remote access has one transport, one device-enrollment model, and one durable
browser credential model. `app.terminay.com` is a PWA connection manager: it
stores bookmarks to stable server origins and does not participate in device
authentication.

This feature works with
[connections and client hosts](./connections-and-client-hosts.md) and
[server runtime and application protocol](./server-runtime-and-protocol.md).

## Model

Remote browser access uses four concepts:

- A **stable session origin** is the permanent HTTPS origin for one Terminay
  Server, such as `https://<server-id>.terminay.com`.
- A **pairing URL** is that stable origin plus a short-lived, single-use secret
  in the URL fragment.
- A **browser device identity** is one non-extractable private key stored by the
  browser at the stable session origin. The server stores the corresponding
  public key, device id, name, and revocation state.
- A **manager profile** is a non-secret bookmark stored by
  `app.terminay.com`. It contains a label, stable session origin, and local
  timestamps.

The pairing secret enrolls a browser device once. It is not a reconnect
credential. Future connections prove possession of the browser device key.

## Ownership

- Terminay Server owns pairing policy, device registration, public device keys,
  revocation, application authorization, workspace state, and audit history.
- The stable session origin owns browser pairing, its non-extractable private
  device key, WebRTC lifecycle, server-bundle installation, and reconnect.
- `app.terminay.com` owns only the browser's list of manager profiles.
- The signaling service routes authenticated WebRTC offers, answers, and ICE
  candidates for one server session.
- TURN may relay encrypted WebRTC packets and does not terminate the Terminay
  application protocol.

Each server has one stable session origin. Credentials created at one origin or
for one server never authorize another.

## Exposure

Servers are not remotely reachable until an administrator enables **Expose
this server…**.

Exposure:

- connects the server to Terminay's authenticated WebRTC signaling service;
- applies the configured six-digit PIN or explicit approval policy;
- generates a short-lived pairing URL and QR code;
- displays exposure expiry, signaling and relay health, paired devices, and
  live connections; and
- allows the administrator to generate another pairing URL, revoke a device,
  or stop exposure.

Generating another pairing URL keeps the stable session origin, registered
devices, live connections, and server-owned PTYs unchanged. Stopping exposure
blocks pairing and reconnect while leaving Local Desktop use and server-owned
work running.

The same exposure model applies to an embedded Local server and standalone
`terminay-server`. The standalone CLI prints the pairing URL after exposure is
ready.

## Browser journey A: direct pairing link

1. The user opens the pairing URL directly.
2. The stable session origin reads the fragment into memory and immediately
   removes it from the visible URL and browser history.
3. The browser establishes WebRTC and verifies the server identity.
4. The user enters the server PIN or receives explicit server approval.
5. The browser creates one non-extractable signing key.
6. The server verifies the pairing secret and PIN/approval, registers the
   public device key, and marks the pairing secret consumed.
7. The authenticated session installs and opens the server's workspace bundle.

The complete pairing URL cannot be used again. Opening the stable session
origin later uses the registered browser device identity.

## Browser journey B: `app.terminay.com` PWA

1. The user opens `https://app.terminay.com`.
2. The PWA lists manager profiles stored in that browser.
3. The user chooses **Add connection…** and pastes a pairing URL.
4. The PWA validates the URL, extracts its stable HTTPS origin, and immediately
   saves or updates a manager profile for that origin.
5. The PWA navigates the current browser view to the complete pairing URL
   without storing its fragment.
6. The stable session origin performs the direct pairing journey.
7. When the user returns to `app.terminay.com`, the saved profile remains in the
   connection list.
8. Selecting the profile navigates to the stable session origin, which
   authenticates with its browser device key and reconnects.

The PWA completes this flow with ordinary top-level navigation. It never knows
whether a browser device key exists. If the session origin has no valid device
identity, that session page asks for a fresh pairing URL. The manager profile
remains until the user chooses **Forget**.

## Desktop journey

Terminay Desktop accepts the same pairing URL. Its privileged connection host
consumes the fragment, creates a device key in OS-protected storage, enrolls
the device, saves the stable origin as a remote profile, and opens the selected
server's verified workspace bundle in a sandboxed window.

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

The device private key is the only durable browser authentication secret.
Connection tickets exist only for individual connection attempts.

## PWA connection manager

`app.terminay.com` is installable as a PWA and works as a local connection
manager. It provides:

- **Add connection…** using a pairing URL;
- a list of saved manager profiles;
- rename, open, and forget actions; and
- same-tab navigation by default, with an explicit open-in-new-tab action.

Its application shell and saved profile list remain available offline. Opening
a profile still requires that profile's stable session origin to be reachable.

The manager profile store contains only:

- label;
- canonical stable session origin; and
- created and last-opened timestamps.

The manager accepts the pairing URL path needed for enrollment but stores only
its stable origin. It rejects queries, URL credentials, and unsupported schemes
and never stores the pairing fragment or complete pairing URL.

## Server-bundled workspace

The server distribution contains the complete responsive workspace UI and its
matching application-protocol client. The stable session origin authenticates
the device, obtains the selected server bundle through the WebRTC asset lane,
validates its declared contract and resource bounds, and launches it under that
same origin.

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

The stable session origin may store:

- device id and name;
- the non-extractable browser private key; and
- non-secret server identity metadata.

The server may store:

- device id and name;
- public device key;
- creation, last-seen, and revocation metadata; and
- security audit events.

The manager origin, signaling service, TURN service, logs, analytics, URLs, and
host messages never contain private device keys, pairing fragments, PINs,
connection tickets, terminal output, project names, paths, filenames, command
history, recordings, settings, or secrets.

## Failure behaviour

- An expired or consumed pairing URL asks the user to generate another one.
- A missing browser device key asks for a fresh pairing URL.
- A revoked device cannot reconnect until enrolled as a new device.
- Offline server, signaling failure, relay failure, invalid server identity,
  invalid bundle, and revoked device are distinct visible errors.
- Failed pairing leaves any PWA manager profile available for retry or forget.
- Failed reconnect keeps the mounted workspace read-only until recovery or
  explicit disconnect.
- Failure never selects another server or terminates server-owned PTYs.

## Security invariants

- Pairing URLs are short-lived and single-use.
- The fragment is consumed in memory and is never sent in an HTTP request.
- Pairing requires the fragment plus PIN or explicit approval.
- A public session origin, server id, device id, or PIN alone grants no access.
- Browser private keys are non-extractable and origin-bound.
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

## Acceptance outcomes

- Opening a pairing URL directly enrolls the browser and opens the workspace.
- Opening that stable session origin later reconnects without the pairing URL.
- Adding a pairing URL in the PWA immediately saves its stable-origin profile
  and performs the same session-origin enrollment.
- Returning to the PWA lists the saved profile, and selecting it reconnects
  through the stable session origin.
- The pairing fragment never appears in manager storage, session URLs after
  consumption, requests, logs, or analytics.
- The browser stores one durable private device key; the server stores its
  public key and revocation state.
- Revoking one device closes it without affecting other devices, Local Desktop,
  or server-owned PTYs.
- Local Desktop, remote Desktop, and browser clients connected to one server
  observe the same workspace and terminal sessions.
- Network interruption reconnects without duplicating PTYs or workspace
  mutations.
