# Remote Access Specification

This is the canonical Terminay remote access spec. It replaces the older split
between `remote.md` and `REMOTE_REFACTOR.md`.

## Summary

Terminay has two remote access modes:

- **Local Network**: the desktop app serves the remote app, pairing APIs, auth
  APIs, and WebSocket terminal protocol from a local HTTPS origin such as
  `https://192.168.1.23:9443`.
- **WebRTC Relay**: the desktop app creates or reuses an isolated session origin
  such as `https://<session>.terminay.com/v1/`. The hosted service provides only a
  bootstrap app, a manager app, and a signaling relay. The desktop remains the
  authority for pairing, auth, terminal APIs, assets, audit, revocation, and
  live terminal traffic.

The production WebRTC model is:

- `app.terminay.com` is a non-secret session manager.
- `<session>.terminay.com` is the isolated remote session origin.
- A QR code opens the session origin directly and carries a one-time QR secret
  in the URL fragment.
- A session origin is reusable. Fresh QR codes create one-time pairing rooms for
  that session origin; they do not replace the origin and must not disturb live
  peers already connected to it.
- After pairing, the session origin can reconnect later without a fresh QR while
  its desktop-issued reconnect grant is valid.
- `app.terminay.com` never stores QR secrets, reconnect grants, device keys,
  pairing tokens, signaling HMAC keys, PINs, terminal tickets, cookies from
  session subdomains, terminal output, command history, cwd, or file names.

## Goals

- Preserve Local Network mode unchanged.
- Make WebRTC work from a public HTTPS origin when local HTTPS is unreachable.
- Isolate every WebRTC remote session by browser origin.
- Let a paired phone reconnect from a saved session link without rescanning a QR.
- Keep the hosted service thin and untrusted for terminal data.
- Keep terminal UI assets desktop-provided so forks and app versions remain
  desktop-owned.
- Keep paired-device security at least as strong as the existing RSA device-key
  challenge flow.
- Give users clear desktop and web UI for live sessions, saved sessions,
  expiry, and revocation.

## Non-Goals

- Do not make the hosted service a terminal proxy.
- Do not store terminal output, command history, cwd, file names, device private
  keys, PINs, pairing secrets, terminal tickets, or desktop audit data on hosted
  infrastructure.
- Do not trust `app.terminay.com` with session-subdomain secrets.
- Do not replace Local Network mode.
- Do not require TURN for the first reconnect-capable implementation, though
  the protocol must leave room for TURN.
- Do not support the obsolete shared-origin WebRTC URL shape
  `https://app.terminay.com/connect?...`.

## Origins

### `app.terminay.com`

The manager is a launcher and CRUD surface for remembered remote session
origins.

Allowed manager data:

- session origin, such as `https://<session>.terminay.com`
- user label
- desktop display name if the session origin explicitly shares it
- created, opened, connected, expired, revoked, and archived timestamps
- non-secret UI preferences
- status such as `known`, `online`, `offline`, `expired`, `revoked`, `archived`,
  or `unreachable`

Forbidden manager data:

- QR fragments or QR secrets
- full QR URLs that include fragments
- relay join tokens
- pairing tokens
- signaling HMAC keys
- reconnect grants or refresh tokens
- device private keys
- PINs or PIN hashes
- terminal connection tickets
- cookies, IndexedDB, localStorage, sessionStorage, Cache Storage, or service
  worker state from a session subdomain
- terminal output, command history, cwd, file names, or terminal session names

Manager actions navigate to session subdomains. The manager must not embed a
session subdomain unless a separate `postMessage` protocol with strict origin
checks is designed later.

The manager must not parse, import, redirect through, or otherwise handle full QR
URLs. QR URLs open the session origin directly. Saving to the manager happens
only after the session origin has stripped all secrets and provides a non-secret
manager import payload.

### `<session>.terminay.com`

Each WebRTC remote session gets a random, unguessable, DNS-safe subdomain. The
first protocol version uses a 32-character lowercase hex label generated from
128 bits of randomness.

The session subdomain is the long-lived browser origin for a remote relationship
between this browser and this desktop. A desktop may keep one active WebRTC
session origin and rotate one-time pairing rooms within it, or create a new
session origin when the user explicitly starts a separate saved remote session.
Creating a new QR for an existing saved session should create a fresh pairing
room under the existing session origin rather than replacing the origin.

Allowed session-origin responsibilities:

- serve the hosted bootstrap app
- register the remote service worker for this origin only
- join the signaling relay for initial pairing and later reconnect attempts
- verify and install desktop-provided remote app assets
- run the desktop-provided remote app
- store the device private key, reconnect grant, session expiry metadata, remote
  app cache, and session-local UI preferences for this one session
- pair, authenticate, enter PINs, reconnect, revoke, and attach terminal
  sessions over WebRTC

Forbidden session-origin responsibilities:

- read or mutate manager storage
- access another session origin's storage, cookies, service worker, or cache
- accept cross-session asset manifests or connection tickets
- share service worker scope with another session

## User Flows

### Local Network Pairing

1. The user starts Remote Access in Terminay.
2. Terminay chooses a reachable local HTTPS origin.
3. Terminay shows a Local Network QR code containing the full local pairing URL.
4. The phone opens the URL directly.
5. The phone pairs with the PIN or authenticates with its stored device key.
6. Terminal traffic uses the existing WebSocket protocol.

### First WebRTC Pairing

1. The user starts Remote Access and chooses WebRTC Relay.
2. Terminay creates a new session id if this desktop has no reusable WebRTC
   session origin, otherwise it reuses the existing session id.
3. Terminay creates a fresh one-time QR secret and registers a one-time pairing
   room with the relay for that session id.
4. Terminay shows `https://<session>.terminay.com/v1/#<qr-secret>` as a QR.
5. The phone opens the session subdomain, consumes the fragment in memory, and
   removes the fragment from browser history.
6. The bootstrap derives one-time relay, pairing, signaling, asset, and CSRF
   secrets from the QR secret.
7. The phone and desktop exchange signed WebRTC signaling through the relay.
8. The phone downloads and verifies the desktop-provided remote app bundle over
   the asset data channel.
9. The remote app asks for the desktop PIN and completes device pairing.
10. The desktop issues a reconnect grant scoped to this session origin and paired
    device, with a default 24-hour expiry.
11. The session origin saves the device private key and reconnect grant. The
    manager may save only the session origin and display metadata.
12. The relay room is completed and purged. The live WebRTC peer connection may
    continue after relay room purge.

### Adding Or Re-Adding Devices

Generating a new WebRTC QR for an existing saved session creates a fresh
one-time pairing room under the same session origin. It must not close or replace
existing live WebRTC peers for that origin.

Use a new session origin only when the user explicitly chooses to create a
separate saved remote session or when the previous session origin has been
revoked/deleted and should not be reused.

### Saved Session Reconnect

1. The user opens `app.terminay.com` and clicks a saved session, or opens the
   saved session subdomain directly.
2. The session subdomain checks its stored reconnect grant, expiry metadata, and
   device key.
3. If the grant is locally present and not known-expired, the session subdomain
   opens a reconnect request for the same session id.
4. The relay routes the reconnect request to the desktop instance that has
   advertised availability for that session. The relay does not receive or learn
   the raw reconnect grant.
5. The desktop returns a fresh reconnect challenge through the relay. The
   challenge includes session id, opaque reconnect handle, reconnect attempt id,
   protocol version, issued-at time, expiry, and random nonce.
6. The browser proves possession of the reconnect grant by signing or HMACing the
   full desktop challenge plus the browser's own fresh nonce. The desktop
   validates the proof, rejects replayed/expired attempt ids, and creates a fresh
   WebRTC peer connection.
7. After the data channel opens, the remote app authenticates with the existing
   RSA device-key challenge flow and a desktop PIN. The PIN may be read from a
   host-only cookie on the exact session subdomain. If the cookie is missing or
   the desktop rejects it, the session page prompts for the PIN and retries auth.
8. If auth succeeds, the desktop issues a fresh short-lived terminal connection
   ticket and may rotate or extend the reconnect grant according to policy.

Reconnect must not require a fresh QR while the reconnect grant is valid. If the
grant is expired, revoked, missing, or bound to a different session origin, the
session page must say a fresh QR is needed.

The session page must not fall back to the first-pairing QR form during saved
session reconnect. A saved session with a valid device key and reconnect grant
may require only the PIN. Submitting the PIN must retry desktop authentication,
and the Pair Device button must be enabled whenever a six-digit PIN can satisfy
the current reconnect-auth challenge.

### Saving To The Manager

The manager and session origin are cross-origin, so saving is explicit:

- The manager must not import QR URLs. QR URLs may contain fragment secrets, and
  `app.terminay.com` JavaScript must never receive them.
- If the QR was scanned directly by the phone camera, the session page should
  show a Save action after successful pairing. That action navigates to
  `app.terminay.com` with only the session origin or a non-secret manager import
  payload.
- The non-secret manager import payload may include session origin, label,
  desktop display name if explicitly shared, expiry/status metadata, and a
  one-time UI import nonce. It must not include QR fragments, reconnect grants,
  device ids, device keys, pairing tokens, signaling keys, terminal tickets,
  terminal data, or cookies.
- The manager stores only non-secret metadata and navigates back to the session
  origin when the user opens it.

### Revocation

The desktop app is authoritative for revocation.

- Revoking a device in the desktop app closes any live WebRTC data channels for
  that device, deletes or marks the reconnect grant revoked, and prevents future
  auth challenges for that device.
- Revoking a saved session in the desktop app can revoke every device/grant bound
  to that session origin.
- A session-origin Revocation action can ask the desktop to revoke the current
  device if it can reconnect/authenticate.
- A manager Revocation action navigates to the session origin to perform the
  action. If the desktop is unreachable, the manager may mark the local record
  revoked, but this is only local manager state.

## Session Lifetime

Default WebRTC saved-session lifetime is **24 hours**.

The desktop should let the user choose a lifetime when pairing or in Remote
Access settings:

- 1 hour
- 24 hours, default
- 7 days
- Until revoked, optional advanced setting

The desktop stores the authoritative expiry for each reconnect grant. The session
origin may store a local copy for UI, but the desktop decision wins.

Recommended policy:

- Pairing rooms expire after 10 minutes or earlier when connected.
- Pairing tokens are one-use and invalidated after successful pairing.
- Terminal connection tickets are one-use and short-lived.
- Reconnect grants expire after the selected lifetime, rotate on successful
  reconnect when practical, and are deleted on revoke.
- The desktop should expose a global maximum lifetime setting for stricter
  environments.

## QR And Secret Derivation

Local Network QR payloads remain full local pairing URLs:

```text
https://192.168.1.23:9443/?pairingSessionId=...&pairingToken=...&pairingExpiresAt=...
```

Production WebRTC QR payloads use the session subdomain and a fragment secret:

```text
https://<session>.terminay.com/v1/#<qr-secret>
```

Rules:

- `<session>` is the public high-entropy session id.
- `/v1/` is the first production WebRTC protocol.
- Future incompatible protocols use `/v2/`, `/v3/`, and so on.
- `qr-secret` is at least 32 random bytes encoded as base64url without padding.
- Secrets stay out of query parameters.
- The QR must not include SDP, ICE, JWTs, terminal tickets, PINs, cookies, device
  keys, reconnect grants, or terminal data.
- The fragment is consumed in memory and removed with `history.replaceState`
  before pairing continues.
- The bootstrap rejects unknown protocol versions and the old shared-origin
  multi-token fragment format.

The desktop and browser derive one-time secrets from the QR secret with
HKDF-SHA256 and protocol-versioned labels:

```text
relayJoinToken     = HKDF(qrSecret, "terminay remote v1 relay join")
pairingToken       = HKDF(qrSecret, "terminay remote v1 pairing")
signalingAuthToken = HKDF(qrSecret, "terminay remote v1 signaling hmac")
assetInstallKey    = HKDF(qrSecret, "terminay remote v1 asset install")
csrfSeed           = HKDF(qrSecret, "terminay remote v1 csrf seed")
```

The reconnect grant is not derived from the QR secret. It is issued by the
desktop only after successful pairing and PIN verification.

## Reconnect Grant Model

The reconnect grant is the session-origin secret that enables QR-free reconnect.

Stored by the desktop:

- session origin
- device id
- opaque reconnect handle
- reconnect grant hash or public verifier
- expiry
- created, last used, and revoked timestamps
- optional display label and user-selected lifetime

Stored by the session subdomain:

- reconnect grant secret in IndexedDB, protected with WebCrypto where possible
- opaque reconnect handle paired with that grant
- device private key, scoped to the exact session origin
- grant expiry metadata for UI
- desktop/session display metadata if explicitly provided

Not stored by `app.terminay.com`:

- the reconnect grant or any verifier
- device private key
- cookies or storage from the session origin

Reconnect proof:

- The desktop advertises availability for a session id while Remote Access is
  running and that session has at least one valid grant.
- The browser sends an unauthenticated reconnect intent containing only session
  id, opaque reconnect handle, protocol version, and client nonce. It must not
  include the device id unless a later design proves the privacy tradeoff is
  necessary.
- The opaque reconnect handle is random, non-secret, scoped to one session
  origin, not useful without the reconnect grant, and rotated whenever the grant
  rotates.
- The desktop maps the reconnect handle to the candidate grant/device record and
  replies with a reconnect challenge containing session id, reconnect handle,
  reconnect attempt id, protocol version, issued-at time, expiry, and a fresh
  desktop nonce.
- The browser signs or HMACs the canonical reconnect challenge and its client
  nonce with the reconnect grant.
- The desktop verifies the proof, checks the challenge expiry, checks that the
  attempt id has not been used before, and rejects proofs for a different
  session id, reconnect handle, origin, or protocol version.
- The relay may route reconnect messages by session id but must not receive a
  raw long-lived reconnect grant or any bearer token that would allow it to
  reconnect on its own.
- The desktop verifies the proof before creating a fresh WebRTC offer.
- The normal RSA device-key auth still runs after the data channel opens. The
  device id is proven inside that authenticated data-channel flow, not exposed to
  the relay during reconnect routing.

The reconnect grant should rotate after successful reconnect when both sides can
confirm receipt. If rotation cannot be made atomic in the first implementation,
the grant may stay stable until expiry, but revocation must still work.

Reconnect proof material must be domain-separated from QR pairing secrets,
terminal tickets, device-key signatures, and signaling HMACs.

## Signaling Relay

The relay forwards signaling only.

Allowed relay state:

- session id or room id
- relay join token hash for one-time pairing rooms
- host instance id
- expiry
- signaling events
- optional non-secret availability state for reconnectable sessions
- operational metadata needed for rate limits and metrics

Forbidden relay state:

- raw QR secret
- raw pairing token
- raw signaling HMAC key
- raw reconnect grant
- PINs
- device private keys
- WebRTC data channel payloads
- terminal messages
- terminal session names

Pairing room behavior:

- Rooms are created only by the desktop.
- Rooms expire quickly, with a default/hard maximum of 10 minutes.
- A room accepts one active client during initial pairing.
- Additional clients are rejected after the first accepted client.
- Events are deleted when the room completes, the host disconnects, or the room
  expires.
- Host or client sends `room-complete` once the peer connection is established.

Reconnect behavior:

- Desktop instances advertise availability for existing session ids while Remote
  Access is running.
- Browser reconnect starts with an intent/challenge/proof exchange. Proofs are
  bound to a desktop-issued challenge and cannot be replayed as new attempts.
- Reconnect requests are rate-limited by session id and client address.
- The relay routes reconnect signaling to the desktop but does not authorize
  terminal access.
- The desktop validates reconnect proof and device auth.
- Reconnect signaling events are purged once the fresh peer connection is
  established.

Signaling messages that carry SDP or ICE must be signed with the appropriate
signaling HMAC. For initial QR pairing that HMAC is derived from the QR secret.
For reconnect it is derived from a fresh secret established by the
challenge/proof handshake and is scoped to one reconnect attempt. It must not be
derived from manager state or reused across reconnect attempts.

## WebRTC Data Channels

Use separate data channels so asset transfer cannot block terminal traffic:

- `control`: lifecycle, reconnect, version negotiation, pings, errors
- `asset`: virtual static file requests and responses
- `api`: pairing and auth request/response messages
- `terminal`: the existing remote terminal protocol currently carried over
  WebSocket

The desktop must ignore API and terminal messages until pairing/auth completes.

## Remote App Assets

The hosted bootstrap does not contain the full terminal app. The desktop supplies
the remote app bundle over WebRTC.

Asset install rules:

- The bootstrap requests an asset manifest over the `asset` channel.
- The manifest includes bundle id, protocol version, path, content type, byte
  length, and SHA-256 hash.
- Every asset body is size-checked and hash-verified before `cache.put`.
- Asset paths are scoped under `/remote-app/<bundle-id>/`.
- Avoid shared mutable paths such as `/remote-app/current/*` for production.
- Cache entries from old bundles are pruned after successful install or after a
  short retention window.
- The remote app is not launched if any asset fails validation.
- The service worker is registered only on session subdomains, never on
  `app.terminay.com`.

## Device Pairing And Auth

The existing RSA device-key challenge model remains.

Rules:

- Device keys are scoped to the exact session origin.
- The desktop stores WebRTC devices as exact session-origin devices or a
  structured equivalent such as `{ kind: 'webrtc', origin, protocolVersion }`.
- A paired device for one session origin cannot authenticate to another session
  origin.
- `app.terminay.com` is not a valid device-pairing origin.
- Device revocation closes live WebRTC connections and invalidates future
  challenges and reconnect grants.
- PIN verification happens on the desktop after the first WebRTC data channel
  opens.
- The PIN is never in the QR, never stored by the hosted service, and never sent
  to the signaling relay.
- WebRTC terminal authentication requires both the paired device key and the
  desktop PIN. The desktop must refuse a WebRTC terminal ticket when the PIN is
  missing, wrong, or expired according to desktop policy.
- The first successful PIN entry may be cached only on the exact session
  subdomain so later saved-session reconnects can authenticate without asking
  again.
- If the cached PIN is rejected, the session origin must clear it and prompt the
  user for a fresh PIN. A wrong or missing PIN must not delete the paired device
  key or reconnect grant.
- Disconnecting a live saved session is not revocation. It closes the current
  terminal connection and returns the browser to the manager saved-session list.
  Forget/revoke remain separate destructive actions.

## Cookies, Storage, CSRF, And CORS

Preferred storage allocation:

- Device private keys: IndexedDB on the exact session subdomain.
- Reconnect grants: IndexedDB on the exact session subdomain by default,
  protected with WebCrypto where possible.
- Opaque reconnect handles: IndexedDB or localStorage on the exact session
  subdomain. They are non-secret, but still must not be stored by the manager.
- Remote app assets: Cache Storage on the exact session subdomain.
- Remote app UI preferences: localStorage or IndexedDB on the exact session
  subdomain.
- Bootstrap QR material: memory only.
- Terminal tickets: memory only.
- Manager session list: manager-local storage with non-secret metadata only.

Reconnect grants and reconnect-proof material must not be stored in cookies,
including encrypted or sealed cookie blobs. A cookie may hold only one of these:

- a non-secret local UI/session handle
- the desktop PIN for the exact session subdomain, after successful pairing or
  auth, when used as an auth factor alongside the IndexedDB device key and
  reconnect grant
- future HTTP session state that is not sufficient to reconnect, authenticate a
  device, or obtain a terminal ticket without the IndexedDB/WebCrypto grant and
  device-key flow

If cookies are used for session-subdomain features:

```http
Set-Cookie: __Host-terminay_session=...; Secure; HttpOnly; Path=/; SameSite=Strict
Set-Cookie: __Host-terminay_pin=...; Secure; Path=/; SameSite=Strict
```

Rules:

- Use the `__Host-` prefix for sensitive hosted session cookies.
- Include `Secure`, `Path=/`, and `SameSite=Strict`.
- Include `HttpOnly` when browser JavaScript does not need to read the cookie.
  The PIN cache is the one allowed non-HttpOnly sensitive cookie because the
  remote app must submit it to the desktop over the authenticated data channel.
- Omit the `Domain` attribute.
- Never set sensitive cookies for `.terminay.com`.
- Never use `app.terminay.com` cookies to authorize a session subdomain.
- Never send a raw reconnect grant, device private key, terminal ticket, QR
  secret, pairing token, reconnect-proof key material, or signaling HMAC key as a
  cookie value.
- Never set the PIN cookie before successful PIN verification by the desktop.
- Clear the PIN cookie when the desktop rejects it.
- Any cookie-authorized state-changing endpoint requires a CSRF token or
  equivalent proof scoped to the session subdomain.
- Reject unexpected `Origin` and unsafe `Sec-Fetch-Site` values where supported.
- Do not enable credentialed wildcard CORS.
- Avoid credentialed CORS between manager and session origins.

## Security Headers

The hosted bootstrap and manager should use strict headers:

- CSP allowing scripts and styles from self only where practical
- `object-src 'none'`
- `base-uri 'none'`
- `frame-ancestors 'none'` unless embedding is deliberately designed later
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer` or `strict-origin-when-cross-origin`
- `Permissions-Policy` limiting camera, microphone, geolocation, and other
  powerful APIs

Remote app assets must be served only from session subdomains and must not be
served from `app.terminay.com`.

## Desktop UX

Remote Access in the desktop app should show:

- mode selector: Local Network QR or WebRTC Relay
- QR code and expiry
- current relay/signaling state
- live connections
- paired devices
- saved WebRTC session origins
- reconnect grant expiry for each device/session
- actions to revoke device, revoke session, rotate QR, copy/open link, and stop
  Remote Access

The desktop should make the distinction clear:

- QR pairing is for adding or re-adding a device.
- Saved session reconnect is for already paired devices.
- Revocation and expiry are enforced by the desktop.
- If a user generates a fresh QR, it must not break existing live WebRTC
  sessions.

## Web App UX

### Manager App

`app.terminay.com` should provide:

- saved session list
- empty state that explains saving happens after pairing or import
- open, rename, archive, restore, forget, and revoke actions
- status labels for online, offline, expired, revoked, archived, and unreachable
- last opened and last connected timestamps
- no visible copy suggesting the manager itself holds terminal access

Opening a session navigates to its session origin. Revoking navigates to the
session origin or marks the local manager record revoked when the desktop cannot
be reached.

### Session App

`<session>.terminay.com` should provide:

- first-pairing progress from QR scan through PIN, asset load, and connected
- reconnect progress when opened without a QR fragment
- clear states for expired grant, revoked grant, desktop offline, relay
  unavailable, WebRTC failed, TURN unavailable, and asset verification failed
- Save to Manager action after successful pairing if the manager did not already
  import the session
- sign out / forget this browser action that deletes local grant, device key,
  cached app assets, and session-local preferences after confirmation

The hosted bootstrap should be sparse and utilitarian. It should not look like a
separate product surface from Terminay.

## NAT, STUN, TURN, And Reliability

Initial WebRTC can use configurable STUN with no bundled TURN provider. Some
networks will fail without TURN, so the UI must distinguish relay failure,
direct WebRTC failure, and TURN unavailable.

Production TURN should use either a managed TURN service with regional points of
presence or a Terminay-owned coturn cluster. TURN credentials must be short-lived
and must not reuse QR secrets, pairing tokens, reconnect grants, terminal
tickets, or device keys.

Mobile background behavior is best effort. If the browser suspends the page and
the data channel dies, reopening the saved session should use the reconnect
flow, not the old purged relay room.

## Remote Terminal Sizing

Remote clients can temporarily own terminal size.

- Desktop-owned is the default: the desktop xterm fits its Dockview panel and
  resizes the PTY.
- Remote-owned applies while a remote client has a terminal session attached and
  active: the phone calculates `cols` and `rows` from its visible terminal area
  and sends resize messages.
- Only one remote tab should own a session size at a time. The most recently
  attached or activated remote tab wins until it detaches, switches away,
  disconnects, or Remote Access stops.
- While remote-owned sizing is active, the desktop renderer resizes its xterm to
  the remote dimensions, suppresses desktop-fit PTY resize messages, centers the
  xterm in the existing panel, and restores normal fit when the override clears.

## Deployment

Production requirements:

- `app.terminay.com` and `*.terminay.com` point at the hosted app service.
- TLS covers both manager and wildcard session hosts.
- The edge preserves the original `Host` header.
- `/signal` upgrades only on valid session hosts and local development hosts,
  never on `app.terminay.com`.
- HTML is `no-store`; hashed bootstrap assets may be immutable.
- Remote app assets are served from per-session service worker cache.
- `/healthz`, `/versionz`, and `/metrics` expose no secrets or active room data.
- Relay database migrations are deployed before app instances that need them.
- Expired rooms/events are cleaned by the relay loop and a defense-in-depth
  database cleanup job.
- Logs redact URL fragments and fields named like secret, token, key, pin,
  pairing, relay, signaling, ticket, or grant.
- `terminay.com` production verification must pass before release.

Incident procedure for compromised hosted bootstrap assets:

1. Stop deploys and revoke the affected hosted bundle by removing it from the
   asset manifest and edge cache.
2. Deploy a clean bootstrap with a new bundle id, force `no-store` HTML, and
   purge CDN cache for `/v1/`, `/remote-app/current/`, `/sw.js`, and affected
   versioned asset paths.
3. Rotate relay signing/runtime credentials and invalidate reconnect
   availability rows and pending signaling events.
4. Publish user guidance to revoke paired browsers, generate fresh QR codes, and
   clear saved session cache if the affected window included successful pairing.
5. Run production verification, asset hash checks, and log review before
   resuming deploys.

## Testing

Unit tests should cover:

- Local Network pairing URL creation and parsing.
- WebRTC `/v1/` QR creation and parsing.
- old shared-origin QR rejection.
- unsupported future protocol rejection.
- HKDF derivation compatibility.
- relay token hash validation.
- HMAC signing, replay protection, and tamper rejection.
- reconnect grant proof validation.
- reconnect grant expiry, rotation, and revocation.
- exact session-origin device binding.
- asset manifest and path validation.
- asset hash and byte-length verification.
- manager storage rejecting secret-like fields.

Integration and E2E tests should cover:

- Local Network pairing still works.
- first WebRTC QR pair/auth/connect flow.
- saved session reconnect without QR.
- expired grant requires a fresh QR.
- revoked grant cannot reconnect.
- second client is rejected for the same one-time pairing room.
- generating a fresh QR does not break existing live WebRTC sessions.
- manager cannot read session cookies, IndexedDB, Cache Storage, or service
  worker state.
- two session subdomains cannot read each other's storage or cookies.
- service worker scope is per-session.
- tampered SDP/ICE fails before WebRTC descriptions or candidates are applied.
- tampered assets fail install.
- device revocation closes live WebRTC terminal data channels.
- mobile background/resume uses reconnect flow.

Manual QA should include iOS Safari, Android Chrome, desktop Chrome, same-LAN
WebRTC, phone on cellular with desktop on home Wi-Fi, restrictive guest Wi-Fi,
VPN/proxy environments, relay unavailable, TURN unavailable, expired QR, expired
grant, revoked device, camera permission denied, and Local Network fallback.

## Implementation Checklist

### Documentation And Cleanup

- [x] Merge the old remote access specs into this canonical `REMOTE.md`.
- [x] Delete stale `remote.md` and `REMOTE_REFACTOR.md` from `terminay/specs/`.
- [x] Update repository references to point at `terminay/specs/REMOTE.md`.
- [x] Update user-facing docs to explain manager versus session subdomain,
  QR pairing versus saved reconnect, and the 24-hour default expiry.

### Manager App

- [x] Remove any manager flow that accepts full QR URLs or QR fragments.
- [x] Import only non-secret session-origin payloads produced by the session
  origin after QR secrets have been stripped.
- [x] Add Save to Manager after successful direct QR pairing.
- [x] Show empty, online, offline, expired, revoked, archived, and unreachable
  states.
- [x] Add open, rename, archive, restore, forget, and revoke actions.
- [x] Ensure revoke navigates to the session origin for real desktop revocation.
- [x] Keep manager records free of secret-like fields.
- [x] Add tests proving manager cannot read session-origin storage or cookies.

### Session Origin Persistence

- [x] Define reconnect grant record shape and storage API.
- [x] Store device private keys under the exact session origin.
- [x] Store reconnect grants under the exact session origin.
- [x] Store reconnect grants in IndexedDB/WebCrypto by default, not raw cookies.
- [x] Store opaque reconnect handles separately from grant secrets.
- [x] Never store reconnect grants, reconnect-proof material, or encrypted grant
  blobs in cookies.
- [x] Add expiry metadata and UI.
- [x] Add sign out / forget this browser cleanup for grant, device key, cache,
  and preferences.
- [x] Add host-only `__Host-terminay_pin` cookie support for exact
  session-subdomain PIN reuse after successful desktop verification.

### Desktop Session And Grant Management

- [x] Extend desktop device/session store with reconnect grant hashes,
  expiries, labels, created/last-used/revoked timestamps, and origin binding.
- [x] Issue reconnect grants after successful WebRTC pairing.
- [x] Default reconnect grant lifetime to 24 hours.
- [x] Add lifetime choices: 1 hour, 24 hours, 7 days, and optional until revoked.
- [x] Rotate or extend grants on successful reconnect.
- [x] Revoke grants when devices or session origins are revoked.
- [x] Close live WebRTC connections when their device/session is revoked.
- [x] Surface saved session origins and grant expiry in desktop Remote Access UI.

### Reconnect Signaling Protocol

- [x] Add desktop availability registration for reconnectable session ids.
- [x] Add browser reconnect request without QR fragment.
- [x] Use an opaque reconnect handle in relay-visible reconnect messages instead
  of exposing device id.
- [x] Add desktop-issued reconnect challenge with attempt id, nonce, issued-at,
  expiry, session id, reconnect handle, origin, and protocol version.
- [x] Add browser reconnect proof bound to the full desktop challenge and client
  nonce.
- [x] Reject replayed, expired, wrong-origin, wrong-handle, wrong-device, or
  wrong-protocol reconnect attempts.
- [x] Ensure the relay never receives raw long-lived reconnect grants.
- [x] Route reconnect signaling to the correct desktop instance.
- [x] Derive fresh reconnect signaling auth for offer, answer, and ICE.
- [x] Purge reconnect signaling events after connection.
- [x] Rate-limit reconnect attempts by session id and client address.

### WebRTC Host Runtime

- [x] Support multiple live WebRTC peers per desktop Remote Access run.
- [x] Ensure generating or rotating a fresh QR does not close existing peers.
- [x] Keep one-time pairing rooms single-client.
- [x] Keep live peer connections running after relay room purge.
- [x] Reuse existing pairing, auth, tickets, terminal protocol, audit, and
  revocation paths.
- [x] Add clear close/error propagation to both desktop and web UI.
- [x] Require desktop PIN during WebRTC terminal auth, using the cached
  session-subdomain PIN when present and prompting when missing or rejected.

### Security And Isolation

- [x] Keep QR secrets in fragments and remove them from history.
- [x] Reject old shared-origin WebRTC URLs.
- [x] Keep `app.terminay.com` out of device-origin binding.
- [x] Keep sensitive cookies host-only if cookies are introduced.
- [x] Store cached PINs only in an exact-origin, host-only, `Secure`,
  `SameSite=Strict`, `__Host-` cookie with no `Domain`.
- [x] Forbid raw reconnect grants in cookies.
- [x] Forbid encrypted/sealed reconnect grant blobs in cookies.
- [x] Ensure relay-visible reconnect payloads contain no stable device id.
- [x] Add CSRF protection before any cookie-backed state-changing endpoint.
- [x] Keep credentialed CORS disabled between manager and session origins.
- [x] Keep asset hash/size/path verification before cache install.
- [x] Add log redaction for reconnect grant fields.

### UX Polish

- [x] Desktop pairing modal explains QR is for adding devices.
- [x] Desktop Remote Access panel shows live connections, paired devices, saved
  sessions, expiry, and revoke controls.
- [x] Session web app shows reconnect progress and precise failure states.
- [x] Manager web app copy avoids implying it stores terminal access.
- [x] Expired/revoked states clearly tell the user when a fresh QR is needed.
- [x] WebRTC failure states distinguish relay, NAT/TURN, desktop offline, and
  asset verification failures.
- [x] Saved-session PIN prompt works without a QR fragment and enables submit
  when a six-digit PIN is entered.
- [x] Disconnect returns a saved WebRTC session to `app.terminay.com` instead of
  showing the pairing/PIN screen.

### NAT, TURN, And Operations

- [x] Keep configurable STUN list.
- [x] Decide TURN provider or self-hosted coturn plan.
- [x] Deliver short-lived TURN credentials without reusing terminal secrets.
- [x] Add relay metrics for pairing rooms, reconnect attempts, failures,
  expiries, revocations, and rate limits.
- [x] Keep production verification as a release gate.
- [x] Add incident procedure for compromised hosted bootstrap assets.

### Tests

- [x] Unit test reconnect grant issue, proof, expiry, rotation, and revocation.
- [x] Unit test reconnect handles are opaque, non-secret, rotated with grants,
  and not sufficient to reconnect alone.
- [x] Unit test manager secret-field filtering.
- [x] Unit test exact origin binding for device and reconnect grants.
- [x] Integration test saved session reconnect without QR.
- [x] Integration test manager never receives QR fragments during save/import.
- [x] Integration test relay-visible reconnect messages do not contain device id.
- [x] Integration test expired grant requires fresh QR.
- [x] Integration test revoked session cannot reconnect.
- [x] E2E test QR pairing followed by manager save and reopen.
- [x] E2E test fresh QR rotation does not break a live WebRTC session.
- [x] E2E test Local Network mode remains unchanged.
- [x] E2E test first saved-session reconnect uses the cached PIN cookie without
  prompting.
- [x] E2E test missing PIN cookie prompts for PIN and retries auth
  without requiring a fresh QR.
- [ ] E2E test rejected PIN cookie prompts for PIN and retries auth without
  requiring a fresh QR.
- [ ] E2E test disconnect from a saved WebRTC session returns to the manager
  saved-session list.
