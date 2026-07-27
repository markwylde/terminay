# Remote access

## Summary

Terminay Server can expose its complete workspace to authorized Terminay
Desktop and browser clients. Remote connections use the same application
protocol and server-owned state as Local connections; WebRTC changes the
transport, not the product model or available workspace features.

The hosted Terminay service provides the web connection host, isolated session
origins, signed bootstrap assets, signaling, and relay coordination. It does not
terminate or store terminal, filesystem, project, settings, agent, recording,
or secret data.

This feature works with
[server runtime and application protocol](./server-runtime-and-protocol.md) and
[connections and client hosts](./connections-and-client-hosts.md).

## Roles and origins

- **Terminay Server** owns pairing policy, device trust, application
  authorization, workspace data, server-bundled UI assets, live connections,
  and audit history.
- **Terminay Desktop** supervises its embedded Local server, stores
  client-device credentials securely, and opens sandboxed windows for local or
  remote servers.
- **`web.terminay.com`** is a non-secret connection manager. It remembers
  sanitized connection profiles and launches a selected server session.
- **`https://<session>.terminay.com`** is the exact isolated browser origin for
  one server session identity. It stores that origin's device key and reconnect
  grant and runs the verified UI bundle supplied by the server.
- **The signaling service** routes authenticated WebRTC offers, answers, and
  candidates for one room. A room id is routing metadata, not authority.
- **TURN** can relay encrypted WebRTC packets when a direct route is
  unavailable. It does not terminate the Terminay application protocol.

Each server session has its own browser origin. Credentials issued for one
origin or server identity do not authorize another.

## Exposure

Servers are not remotely reachable by default.

An administrator uses **Expose this server…** to:

- configure or confirm the pairing PIN/approval policy;
- make the server available through WebRTC signaling;
- generate a short-lived pairing URL and QR code;
- inspect relay health, paired devices, and live connections;
- revoke devices or stop accepting remote connections.

The same exposure and trust model applies to an embedded Local server and a
standalone `terminay-server` process. The standalone CLI prints the secure
pairing URL after exposure starts.

Generating a new pairing URL does not replace the stable session origin,
invalidate paired devices, or disconnect live clients. Stopping exposure blocks
new pairing and reconnect attempts without stopping local use or terminating
server-owned PTYs.

An optional Local Network endpoint exposes the same protocol directly over
authenticated HTTPS/WebSocket transport on a user-selected interface. It uses
the same device, authorization, and audit rules and never starts implicitly.
WebRTC exposure does not bind a LAN listener.

## First pairing

1. The server creates a one-time pairing room with a short expiry.
2. The pairing URL contains the public session origin and a random one-time
   secret in the URL fragment.
3. The user opens or pastes the URL in Terminay Desktop or a browser, or scans
   its QR code.
4. The client keeps the fragment in memory and removes it from visible URL and
   history state before loading unrelated resources.
5. The signaling service admits the server and client to the room only after
   proof derived from the one-time secret.
6. WebRTC connects and the client verifies the server identity, protocol
   handshake, and server-bundled UI manifest.
7. The user enters the server PIN or receives explicit server-side approval.
8. The client creates an origin-bound device key pair and proves possession of
   the private key.
9. The server records the device and issues a scoped reconnect grant.
10. The one-time room and secret are consumed and cannot pair another device.

Possession of the public session URL, room id, server id, device id, or PIN
alone is insufficient. Pairing requires the one-time secret, server policy, and
proof of the new device key.

## Reconnect

A paired client reconnects from the stable session origin without a new QR
code:

1. The client loads its remembered connection profile.
2. The exact session origin reads its private key and reconnect grant.
3. The client opens a short-lived reconnect signaling room.
4. The server challenges the device and verifies its signed proof, grant,
   server identity, expiry, and revocation state.
5. The server issues a fresh single-use connection ticket.
6. The application handshake resumes workspace and terminal subscriptions from
   their last confirmed revisions and sequence positions.

Reconnect grants are random, hashed at rest by the server, scoped to one server
and device, rotated according to policy, and never accepted directly as an
application command credential. Connection tickets are short-lived,
single-use, and bound to the authenticated WebRTC peer.

Expired credentials request fresh pairing. Revoked credentials cannot be
renewed. A failed remote connection never falls back to Local or another
remembered server.

## Server-bundled workspace UI

The complete responsive workspace UI is part of the Terminay Server
distribution.

- The server publishes a signed/hash-addressed asset manifest that declares its
  server and protocol compatibility.
- The session bootstrap fetches assets through an isolated WebRTC asset
  channel, validates manifest paths, sizes, counts, hashes, and total limits,
  and installs them into the exact session origin's cache.
- The service worker serves only a committed, fully verified bundle. A partial
  or failed update leaves the last valid bundle available.
- Assets use bounded chunks, cancellation, timeout, retry, and backpressure.
- Large asset transfer cannot starve terminal control or application commands.
- Opening the session origin directly runs the exact UI bundled with that
  server.
- `web.terminay.com` remains a connection host; it is not a separately evolving
  full workspace application.

The server-provided UI receives no ambient Electron, Node, connection-manager,
or cross-origin credential authority. Desktop loads it in a sandboxed,
context-isolated window with Node integration disabled and a narrowly validated
host bridge.

## Application traffic

After authentication, WebRTC carries the complete versioned Terminay
application protocol:

- workspace snapshots, revisions, commands, and events;
- terminal input, resize, output, replay, and lifecycle;
- project, panel, file, folder, and Git operations;
- agent and terminal-activity state;
- recordings, settings, macros, AI metadata, dictation, and MCP status where
  the device is authorized;
- device, exposure, and connection administration for administrative devices;
  and
- bounded binary file, preview, recording, audio, and UI-asset transfer.

Traffic classes use separate ordered channels or an equivalent prioritized
multiplexing scheme:

- connection and authentication control;
- application commands and state events;
- terminal streams; and
- assets and bounded binary content.

Every request is runtime-validated and authorized against the authenticated
device and exact server/project/panel/session scope. Client focus, tab title,
cwd text, or a copied object id does not confer access.

## Credentials and browser storage

`web.terminay.com` may store only sanitized connection metadata:

- stable server id/fingerprint;
- exact non-secret session origin;
- user label and explicitly shared server display name;
- created, last-opened, and last-connected timestamps; and
- non-secret connection state such as offline, expired, or revoked.

The exact session origin stores its non-extractable device private key and
reconnect material using IndexedDB and WebCrypto. Terminay Desktop stores its
equivalent credentials using OS-backed secure storage where available.

The following never appear in connection-manager localStorage, query strings,
cross-origin host messages, referrers, analytics, clipboard history, or normal
logs:

- unconsumed pairing URL fragments;
- PINs;
- device private keys;
- reconnect grants;
- proof or signaling keys;
- connection tickets;
- terminal or workspace data; and
- server secrets.

Public-key material may be transmitted where the protocol requires it. Private
keys remain non-extractable when the platform supports that property.

## Device and connection management

The server records paired devices with a stable id, user label, key
fingerprint, created time, last-seen time, grant expiry, revocation state, and
bounded audit metadata.

An authorized user can:

- rename a device;
- inspect live and recently seen connections;
- revoke one device;
- revoke all other devices;
- rotate exposure or pairing policy; and
- stop remote exposure.

Revocation closes the device's live peers, invalidates its reconnect grants and
tickets, and writes an audit event. Forgetting a local connection profile only
removes that client's metadata and credentials; the UI does not describe it as
server-side revocation.

Audit history records security events and metadata, not terminal content,
project paths, filenames, command history, PINs, tokens, or private keys.

## Reliability and recovery

- Network loss leaves PTYs and server-side work running.
- Reconnect resumes from confirmed workspace revisions and terminal sequence
  positions without duplicating mutations or PTYs.
- A stale or duplicated command id returns its recorded result or a structured
  conflict; it is not blindly applied again.
- Relay unavailable, server offline, route failure, expired grant, revoked
  device, incompatible protocol, and invalid bundle are distinct user-visible
  states.
- An incompatible client can open the direct session origin to use the UI
  bundled with the server.
- An interrupted bundle install keeps the prior verified bundle and offers a
  retry.
- Signaling rooms, pending requests, and orphaned peer state expire with
  explicit limits.
- Failure in one traffic class or application service does not silently widen
  authorization or corrupt unrelated sessions.

## Security invariants

- Remote access is disabled until the user explicitly exposes the server.
- Hosted services are data-blind for Terminay application content.
- Signaling membership is authenticated and isolated per one-time room.
- Pairing URLs are short-lived and single-use; their fragment is never sent as
  an HTTP request component.
- PIN verification is rate-limited and does not disclose whether another
  credential component was correct.
- Device keys, reconnect grants, and connection tickets have distinct roles and
  lifetimes.
- All cryptographic comparisons use constant-time operations where applicable.
- All random credentials use a cryptographically secure random source.
- UI assets are verified before execution and cannot escape the session cache
  namespace.
- Remote server code inside Desktop has no Node integration or generic preload
  API.
- Device revocation takes effect for live and later connections.
- Full-control remote access is described as equivalent to interactive shell
  access to the server machine.

## Non-goals

- No hosted terminal or workspace proxy.
- No cloud persistence of project or connection-manager secrets.
- No trust based only on possession of a public session URL.
- No independent latest workspace build at `web.terminay.com`.
- No browser-owned Local server.
- No requirement that a client stay connected for its PTYs to continue.

## Acceptance outcomes

- An embedded or standalone server can be exposed and paired from Terminay
  Desktop or a browser using the same server-side trust model.
- A paired device reconnects from the stable session origin without rescanning
  a QR code while its grant remains valid.
- A pairing room is single-use, but issuing another pairing URL does not disturb
  the session origin or existing peers.
- WebRTC carries the full application protocol and exact server-bundled
  responsive UI.
- Local and remote clients observe the same server-owned projects, panels,
  sessions, settings, agents, recordings, and mutations.
- Closing a window, browser tab, or network connection does not terminate an
  active PTY.
- `web.terminay.com`, signaling storage, access logs, and analytics contain no
  terminal data, device private keys, reconnect grants, pairing fragments, or
  server secrets.
- Revoking one device closes it and prevents reconnect without affecting other
  authorized devices.
- A malicious server bundle cannot access Node, Electron privileges, another
  server origin's credentials, or connection-manager secrets.
