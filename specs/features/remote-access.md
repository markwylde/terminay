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

The server owns short-lived pairing rooms. It returns a one-time fragment
secret only when a room is created, retains only a digest, binds consumption to
the exact server/session origin, and exposes metadata without credentials.
Rotation invalidates active rooms without changing the stable session origin or
disconnecting existing peers; expired, consumed, and locked rooms are bounded
and reclaimed.

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

Desktop reports WebRTC exposure availability before an administrator starts
it. A build without the selected WebRTC runtime, authenticated per-peer
signaling registrar, or required hosted-service contract shows WebRTC as
unavailable and does not invite a start action. Availability failures never
allocate a pairing room, bind a substitute LAN port, or publish a pairing URL.

The same exposure and trust model applies to an embedded Local server and a
standalone `terminay-server` process. The standalone CLI prints the secure
pairing URL after exposure starts.

The standalone `--pairing` handoff contains the exact isolated session origin,
short-lived room id, expiry, and one-time URL fragment. `--status` reports only
redacted exposure state, room metadata, and connection counts; it never emits
the fragment or pairing secret.

Generating a new pairing URL does not replace the stable session origin,
invalidate paired devices, or disconnect live clients. Stopping exposure blocks
new pairing and reconnect attempts without stopping local use or terminating
server-owned PTYs.

When an exposure reaches its expiry, the server reports the same disabled/offline
state and rejects new pairing or reconnect admissions. Already-connected peers
remain transport-connected until they disconnect or are explicitly revoked, so
expiry does not interrupt server-owned work.

An optional advanced **Direct network listener** exposes the same protocol
directly over authenticated HTTPS/WebSocket transport on a user-selected
interface. It uses the same device, authorization, and audit rules, has its own
explicit start/stop state and origin-bound handoff, and never starts implicitly.
It is not a QR type, WebRTC fallback, or alternate meaning of **Expose this
server…**. WebRTC exposure does not bind a LAN listener, and enabling the direct
listener does not claim that WebRTC is available.

For an embedded Local server, starting the direct network listener binds the
configured interface and port to the embedded server's canonical
`ServerCore`. It does not create a second workspace, terminal authority, or
standalone server process. The listener starts only after its explicit advanced
action, stops only through its own lifecycle or server shutdown, rolls back its
pairing state when binding or TLS setup fails, and rejects remote traffic after
stop. Loopback HTTP is permitted only for local development; non-loopback
exposure requires HTTPS.
For local hosted-transport compatibility tests, HTTP names beneath the reserved
`.localhost` suffix are loopback origins. Each session subdomain remains a
distinct origin and must not be canonicalized to bare `localhost`.

Stopping WebRTC exposure does not stop an independently enabled direct listener,
and stopping the direct listener does not stop WebRTC or the private Local
connection. Each route reports its own admission, origin, expiry, and error
state while sharing server-owned device authorization and audit policy.

The direct-network pairing URL is usable by the shared Desktop/browser pairing
flow. The listener validates the one-time fragment material and pairing PIN,
enrolls a device, issues origin-bound reconnect material, and then carries the
same framed application protocol used by Local. A generated URL must never be
published for an address on which no listener is accepting the matching
protocol.

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

The server-core reconnect boundary issues an opaque grant and handle, binds a
short-lived challenge to the exact server/session origin and client nonce, and
verifies a proof without retaining the grant secret. Failed proofs leave the
challenge available for a bounded retry; a valid proof consumes it once.
Rotation, device revocation, and expiry fence later challenges. Durable
storage, signaling transport, and concrete WebRTC runtime adapters remain
host-owned boundaries around this primitive.
When the relay reports reconnect completion, the host retires only the
short-lived reconnect-attempt metadata and leaves the newly established WebRTC
runtime open.
After issuing a saved-session reconnect grant, the desktop treats reconnect
availability as established only after the hosted relay acknowledges the
initial reconnect-host registration. A fast browser reconnect must not race
ahead of relay-visible availability.
Browser-host reconnect on a WebRTC session origin uses the same authenticated
four-lane application transport as initial pairing; it does not downgrade the
server-bundled UI to a direct WebSocket connection.
When a hosted WebRTC bootstrap provides the browser enrollment bridge, that
bridge owns initial reconnection for the mounted server UI; saved-profile
auto-restore must not start a competing reconnect attempt in the same page.

For the local static-browser host, enrollment derives a non-extractable
WebCrypto HMAC proof key in IndexedDB, partitioned by the selected server
origin; the one-time pairing grant is discarded immediately. The standalone
server persists its protected reconnect records (handle, grant hash, and proof
verifier) in its data root so a server restart can validate a subsequent proof,
but it never persists a pairing URL, pairing secret, reconnect grant, or
short-lived application ticket. A successful proof returns a new short-lived
HTTP development ticket; it is never accepted as a reconnect grant.

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
- Static session UI responses set same-origin CSP, deny frame/object execution,
  send no referrer, and disable camera, microphone, geolocation, payment, USB,
  serial, and Bluetooth permissions.
- `web.terminay.com` remains a connection host; it is not a separately evolving
  full workspace application.

The stable browser host contains only connection management, pairing/reconnect,
compatible signaling/WebRTC bootstrap, verified bundle installation, and safe
launch/failure UI. After it establishes the authenticated asset channel, the
selected server supplies the full workspace implementation and matching
application client. The installed bundle executes in that server's exact
isolated session origin rather than the manager origin.

Terminay Desktop follows the same remote bootstrap and bundle-install flow. It
keeps protected credentials and transport authority in the main process,
launches the verified server bundle in a sandboxed origin/profile partition,
and supplies an opaque byte endpoint plus a separately negotiated native host
bridge. The renderer never receives reconnect grants, signaling secrets, or
generic Electron IPC.

The host need not understand the server bundle's feature-level application
protocol. Cross-version connection depends only on compatible
pairing/reconnect and signaling bootstrap, byte transport, bundle
manifest/transfer, execution runtime, and required host-bridge contracts. A
missing optional native capability uses browser-equivalent presentation; a
missing required compatibility boundary fails before launch with a typed
upgrade requirement.

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

The server transport boundary selects an explicitly configured headless runtime
(`node-datachannel`, `werift`, or a test/custom adapter) and admits it only
after the server/origin-bound connection proof succeeds. It requires the four
traffic channels, bounds each frame and runtime buffered amount, and tears down
all channels when the peer is revoked or a channel violates those limits. The
runtime adapter itself remains injected so server-core does not import a
concrete WebRTC implementation. Server-core's transport-neutral conformance
suite runs the same channel, backpressure, admission, origin, and cleanup
contract against every configured runtime label; this proves adapter parity,
not production TURN or hosted-runtime availability.

The standalone server may load an optional `node-datachannel` installation at
its privileged composition boundary. Its adapter validates the native module,
maps already-established binary data channels, and closes the server session
when native sends or messages violate the binary transport contract. Offer,
answer, ICE, signaling, and relay configuration stay injected host concerns
until their production integration is separately verified.

Every request is runtime-validated and authorized against the authenticated
device and exact server/project/panel/session scope. Client focus, tab title,
cwd text, or a copied object id does not confer access.

The server-core application conformance suite compares remote handshake and
resume responses with the canonical workspace delta/snapshot and exact
project-scoped terminal positions. A stale event window produces the same
bounded canonical snapshot that a server-owned local consumer would read; this
does not yet prove a full Local-versus-remote client E2E path.

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

Desktop automation uses an explicit test-process-only credential protector. It
encrypts and authenticates records with an ephemeral in-memory key, cannot
survive an application restart, and is never selected outside
`TERMINAY_TEST=1`. Production continues to fail closed when OS-backed secure
storage is unavailable or reports Electron's insecure `basic_text` backend.

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

The server transport adapter performs the application handshake only after its
device-key verifier and PIN/approval authority both accept the connection
proof. It then returns a bounded workspace delta (or a complete snapshot when
the retained event window is too old) together with exact project-scoped
terminal sequence positions. Reconnect state is never taken from a renderer
or window identity, and revoking a device aborts its application session while
leaving Local and other devices available.

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
