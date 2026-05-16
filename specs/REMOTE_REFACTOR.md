# Remote Access Origin Isolation Refactor

## Summary

Terminay's WebRTC remote access model should keep the desktop app as the authority for terminal assets, pairing, authentication, and terminal traffic, while moving each browser remote session onto its own isolated HTTPS origin.

The current WebRTC design uses `app.terminay.com` as the hosted bootstrap origin. That is fine for a short-lived bootstrap, but it is not a safe long-term origin for desktop-provided remote apps, cookies, device sessions, or forked client assets. A remote app loaded from a user's desktop may be custom, forked, old, experimental, or malicious. It must not share storage, cookies, service workers, Cache Storage, IndexedDB, localStorage, or session state with other remote sessions.

The refactor target is:

- `app.terminay.com` is an untrusted CRUD-style session manager.
- `<channel>.terminay.com` is the only origin that runs a specific desktop-provided remote app.
- The QR code opens the per-session subdomain directly.
- The QR code carries a compact room identifier in the host and a QR-only secret in the fragment.
- The per-session subdomain handles WebRTC signaling, pairing, PIN entry, asset install, cookies, and session persistence.
- No handshake secret, pairing token, device secret, or terminal secret is stored by `app.terminay.com`.

This document supersedes the `app.terminay.com` shared-origin assumptions in `REMOTE.md` for production WebRTC mode. Local Network mode should remain unchanged.

## Goals

- Shrink WebRTC QR codes so they scan quickly and reliably.
- Isolate every remote session on a unique origin.
- Allow cookie-backed or session-backed browser features without leaking across sessions.
- Keep `app.terminay.com` useful as a manager without making it trusted.
- Preserve the desktop app as the authority for the terminal UI bundle and terminal APIs.
- Preserve forkability: desktop-provided remote assets may differ by version or fork.
- Make production WebRTC mode safe enough for persistent paired devices and future session-saving features.
- Keep explicit protocol versioning so future incompatible QR/bootstrap changes can coexist cleanly.

## Architecture Decisions

- The first production QR shape is `https://<channel>.terminay.com/v1/#<qr-secret>`.
- `<channel>` is the public, high-entropy relay/session channel. It is identical to `roomId` for the first production version.
- The first production `<channel>` is a lowercase 32-character hex DNS label produced from 128 bits of randomness.
- The production `qr-secret` is 32 random bytes encoded as base64url without padding.
- The URL path carries the protocol version. Future incompatible bootstrap protocols should use `/v2/`, `/v3/`, and so on.
- The old shared-origin `app.terminay.com/connect?...#relayJoinToken=...` shape is not a compatibility target. No users depend on it, so it should be removed rather than migrated.
- Remembered devices may persist a device key under the exact session subdomain, but a terminal connection still requires a fresh live desktop-authorized WebRTC room in the first production version.
- `app.terminay.com` is never a valid production device-pairing origin.

## Non-Goals

- Do not replace Local Network remote access.
- Do not make the hosted service a terminal proxy.
- Do not store terminal output, commands, file content, device private keys, or pairing secrets on hosted infrastructure.
- Do not require one global hosted remote app bundle.
- Do not trust `app.terminay.com` to handle pairing secrets.
- Do not treat DNS isolation alone as sufficient; browser storage, cookie, service worker, cache, and CSRF boundaries must also be designed.

## Current Baseline

The existing WebRTC scaffold already has important security properties:

- The QR payload avoids SDP blobs.
- The relay join token and signaling HMAC token are not placed in the URL query.
- The signaling relay validates a relay join token hash.
- SDP and ICE messages are HMAC-signed with a QR-only signaling secret.
- The desktop still serves remote assets over a WebRTC data channel.
- Pairing and auth can reuse the existing desktop-side device-key flow.

The production blocker is the shared hosted origin:

- Remote assets are cached under the same `app.terminay.com` origin.
- The hosted service worker scope is shared.
- Any cookies added to `app.terminay.com` would be visible to remote apps running there.
- Browser storage is shared across every remote session under that origin.
- A forked remote app could observe or mutate state meant for unrelated sessions.

## Threat Model Notes

- Malicious forked remote assets: contained to the single `<channel>.terminay.com` origin that installed them. They must not share cookies, service workers, Cache Storage, IndexedDB, localStorage, or sessionStorage with other sessions.
- Compromised manager origin: `app.terminay.com` may lose manager metadata, but it must not receive QR fragments, terminal cookies, device keys, pairing tokens, signaling HMAC keys, terminal tickets, or remote app caches.
- Malicious relay: can observe room ids and signaling timing, but cannot join without the derived relay token and cannot silently rewrite SDP or ICE because signaling messages are HMAC-signed.
- Shoulder-surfed QR: an attacker who scans the QR before the intended device can attempt pairing during the short expiry window, so the desktop-side PIN remains the human confirmation gate.
- Stolen paired phone: the attacker may hold the device private key for that exact session origin, so device revocation must close live WebRTC connections and block future auth challenges.
- Sibling-subdomain CSRF: `app.terminay.com` and two session subdomains are cross-origin but same-site, so cookie-backed HTTP endpoints need explicit CSRF and origin checks instead of relying on `SameSite` alone.

## Target Origin Model

### `app.terminay.com`

`app.terminay.com` is a manager and launcher only.

Allowed responsibilities:

- List known remote sessions.
- Let the user rename, archive, hide, revoke, or forget sessions.
- Store non-secret user preferences for the manager UI.
- Show whether a session is known, stale, revoked, or recently used.
- Link the user to a per-session subdomain.
- Explain QR scanning, relay status, and troubleshooting.

Forbidden responsibilities:

- Handling QR fragments that contain pairing secrets.
- Hosting desktop-provided remote terminal assets.
- Registering the remote app service worker.
- Holding remote app Cache Storage entries.
- Persisting pairing tokens, relay tokens, signaling HMAC keys, PINs, WebRTC tickets, terminal tickets, or terminal session state.
- Reading cookies or storage for `<channel>.terminay.com`.

`app.terminay.com` must be considered untrusted by the desktop and by every per-session subdomain.

### `<channel>.terminay.com`

Each remote session gets a random, unguessable, DNS-safe subdomain.

Allowed responsibilities:

- Serve the small hosted bootstrap app.
- Register the remote service worker for that subdomain only.
- Join the signaling relay for its session.
- Verify and install desktop-provided assets.
- Run the desktop-provided remote app.
- Store session cookies and browser storage for that one session.
- Pair devices, authenticate devices, enter PINs, and attach terminal sessions over WebRTC.

Forbidden responsibilities:

- Accessing manager state on `app.terminay.com`.
- Accessing another session's cookies, storage, Cache Storage, or service worker.
- Sharing a service worker scope across sessions.
- Accepting cross-session asset manifests or connection tickets.

### Wildcard Hosting

Production DNS should point `*.terminay.com` at the hosted bootstrap service. The server should serve the same bootstrap shell for both:

- `app.terminay.com`
- `<channel>.terminay.com`

The bootstrap must branch by host:

- `app.terminay.com`: manager mode.
- `<channel>.terminay.com`: remote session mode.
- unknown or invalid hostnames: safe error page.

The service must not rely on a wildcard cookie. Sensitive cookies should be host-only cookies on the exact session host.

Local development should test manager and session origins as different hosts. Recommended mappings:

```text
127.0.0.1 app.terminay.test
127.0.0.1 session-a.terminay.test
127.0.0.1 session-b.terminay.test
```

Development proxies must preserve the incoming `Host` header so the hosted service can distinguish manager mode from session mode.

## Cookie And Storage Model

Sensitive cookies for a session subdomain must be host-only. That means the response omits the `Domain` attribute.

Preferred cookie shape:

```http
Set-Cookie: __Host-terminay_session=...; Secure; HttpOnly; Path=/; SameSite=Strict
```

Rules:

- Use the `__Host-` prefix for hosted session cookies.
- Always include `Secure`.
- Always include `HttpOnly` unless JavaScript truly needs the value.
- Always include `Path=/`.
- Never include `Domain` on sensitive cookies.
- Never set cookies for `.terminay.com`.
- Never use `app.terminay.com` cookies to authorize a session subdomain.
- Do not rely on `SameSite` as the only CSRF defense because sibling subdomains are same-site.
- Store private device keys in IndexedDB under the session subdomain, not under `app.terminay.com`.
- Store desktop-provided assets in Cache Storage under the session subdomain, not under `app.terminay.com`.
- Store UI preferences that apply only to a remote session under the session subdomain.

`app.terminay.com` may use its own host-only cookies or local storage for manager preferences, but those cookies must not authorize terminal access.

The current data-channel implementation does not use HTTP cookies for terminal authorization. The hosted server includes only a session-subdomain logout cookie expiry path and a host-only cookie builder for future session features.

## Compact QR Payload

The production QR should be small. The session subdomain carries the room identity, and the fragment carries one high-entropy QR secret.

Preferred production payload:

```text
https://<channel>.terminay.com/v1/#<qr-secret>
```

Rules:

- `<channel>` is the relay room id or maps one-to-one to it.
- `<channel>` must be high entropy and DNS-safe.
- `/v1/` is the first production origin-isolated WebRTC protocol. It is not the old shared-origin draft.
- Future incompatible protocols should use `/v2/`, `/v3/`, and so on, while keeping the QR secret in the fragment.
- `qr-secret` must be at least 32 random bytes encoded with base64url.
- The QR must not include SDP, ICE, JWTs, terminal tickets, user PINs, or cookie values.
- The QR should not put secrets in query parameters.
- The QR fragment must be consumed in memory and removed from browser history as soon as possible.
- The bootstrap should reject unknown protocol paths and should not accept the old shared-origin multi-token fragment shape in production.

### Secret Derivation

The desktop and browser derive all one-time secrets from the QR secret using HKDF-SHA256 or an equivalent domain-separated KDF.

Suggested labels:

```text
relayJoinToken     = HKDF(qrSecret, "terminay remote v1 relay join")
pairingToken       = HKDF(qrSecret, "terminay remote v1 pairing")
signalingAuthToken = HKDF(qrSecret, "terminay remote v1 signaling hmac")
assetInstallKey    = HKDF(qrSecret, "terminay remote v1 asset install")
csrfSeed           = HKDF(qrSecret, "terminay remote v1 csrf seed")
```

The exact labels should include the protocol id, for example `terminay remote v1 ...` for `/v1/`. Do not reuse labels across protocol versions if the derivation contract changes.

Benefits:

- QR payload is smaller.
- The relay still validates possession of a relay token.
- The desktop still validates a pairing token.
- Signaling messages remain protected from relay tampering.
- New purposes can be added without growing the QR.

The KDF output must be deterministic for the desktop and browser, but each label must produce a distinct value.

## Hosted Relay Model

The signaling relay remains a relay only.

Allowed relay state:

- `roomId`
- relay join token hash
- expiry
- host instance id
- signaling event messages
- optional client accepted/connected state
- operational metadata needed for abuse prevention

Forbidden relay state:

- raw QR secret
- raw pairing token
- raw signaling HMAC key
- PINs
- device private keys
- WebRTC data channel payloads
- terminal messages
- terminal session names

Room behavior:

- Rooms are created only by the desktop app.
- Rooms expire quickly, with a hard maximum such as 10 minutes.
- A room accepts one active client during initial pairing.
- A room should reject additional clients after the first accepted client unless the desktop rotates a fresh QR.
- Relay events should be deleted after pairing completes, host disconnects, or room expiry.
- Host and client should send a final `connected` or `room-complete` message so the relay can purge room state early.
- Multi-instance relay deployments should keep using durable room/event storage plus cross-instance notifications.

Production hardening:

- Rate-limit room creation by IP and account/session where available.
- Rate-limit failed joins by room and IP.
- Cap message size and event count per room.
- Reject malformed SDP/ICE bodies early.
- Log operational metadata without logging fragments or derived secrets.
- Expose health and metrics endpoints that do not leak active room secrets.

## WebRTC Handshake

The relay must not be trusted to preserve message integrity.

Rules:

- Offers, answers, and ICE candidates are signed with the derived `signalingAuthToken`.
- The browser verifies host messages before applying them.
- The desktop verifies browser messages before applying them.
- The room id must be covered by every signature.
- SDP fingerprints must be covered by the signature through the signed SDP body.
- A signaling message with an invalid signature must be ignored and should close the pairing attempt.
- The desktop must not accept API or terminal messages until the pairing/auth flow completes over the WebRTC data channel.

The hosted service can see room ids and WebRTC metadata. It must not be able to silently rewrite the peer connection.

## Remote App Asset Model

The desktop remains the source of the remote app bundle.

Asset install rules:

- The bootstrap requests an asset manifest over the `asset` data channel.
- The manifest includes path, content type, byte length, SHA-256 hash, protocol version, and bundle id.
- Every downloaded asset must be SHA-256 verified before it is cached.
- Asset paths must be scoped under a versioned bundle path.
- Avoid shared mutable paths such as `/remote-app/current/*` in production.
- Prefer `/remote-app/<bundle-id>/remote.html` and `/remote-app/<bundle-id>/assets/...`.
- The service worker must only serve assets under the session subdomain.
- Cache entries from old bundles should be pruned after a successful install or after a short retention window.
- The remote app must not be launched if any asset fails hash, size, path, content type, or protocol checks.

The bootstrap may mount the installed app in place or navigate to the cached entry, but it must not leave QR secrets in the URL.

## Manager CRUD Model

`app.terminay.com` should become a manager for remembered remote sessions.

Manager data may include:

- session subdomain
- user-provided label
- desktop display name if explicitly shared
- last opened time
- last successful connection time
- local manager UI state
- revoked or archived state

Manager data must not include:

- QR fragment secrets
- derived relay tokens
- pairing tokens
- signaling HMAC keys
- device private keys
- terminal tickets
- cookies from session subdomains
- terminal output, commands, cwd, file names, or session names unless explicitly designed later with separate consent

The manager should treat every session subdomain as untrusted. It should open session origins as navigations, not as same-origin embedded apps. If embedding is ever added, it needs a separate postMessage protocol with strict origin checks and no secret exchange.

## Device Pairing And Persistence

The existing RSA device-key challenge model should stay.

Rules:

- Device keys are scoped to the per-session origin.
- The desktop stores the paired device origin as the exact session origin or a structured equivalent.
- `app.terminay.com` is not a valid device origin for WebRTC production sessions.
- A paired device for one session subdomain must not authenticate to another session subdomain.
- Device revocation closes WebRTC connections and invalidates future challenges.
- Pairing tokens remain short-lived and one-use.
- Terminal connection tickets remain short-lived and one-use.
- PIN verification happens on the desktop after the data channel opens.
- The PIN is never in the QR and never sent to the signaling relay.

Open product decision:

- Decide whether a remembered phone should reconnect to the same desktop/session subdomain without scanning a fresh QR, or whether every WebRTC session requires a fresh QR. The origin-isolated model supports both, but the security and UX tradeoffs differ.

## CSRF And Cross-Origin Rules

Per-session subdomains are cross-origin from each other, but they are same-site under `terminay.com`. Therefore, cookie-backed APIs must use explicit CSRF defenses.

Rules:

- Any cookie-authorized HTTP endpoint must require a CSRF token or equivalent proof.
- CSRF tokens must be scoped to the session subdomain.
- CSRF tokens must not be readable by `app.terminay.com`.
- Use strict CORS defaults: no wildcard credentials.
- Avoid credentialed CORS between `app.terminay.com` and session subdomains.
- Reject unexpected `Origin` and `Sec-Fetch-Site` combinations for state-changing endpoints.
- Use `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, and `X-Content-Type-Options` where practical.

For the initial WebRTC data-channel API path, CSRF is less relevant because browser cookies are not the primary auth mechanism. It becomes mandatory when adding cookie-backed hosted HTTP features.

## CSP And Browser Security Headers

The hosted bootstrap and remote app should have strict but practical security headers.

Bootstrap headers:

- `Content-Security-Policy` allowing scripts and styles only from self.
- `connect-src` allowing the signaling WSS endpoint and WebRTC needs.
- `img-src` allowing self and data URLs for lightweight status UI.
- `object-src 'none'`.
- `base-uri 'none'`.
- `frame-ancestors 'none'` unless embedding is intentionally supported later.
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: no-referrer` or `strict-origin-when-cross-origin`.
- `Permissions-Policy` limiting camera, microphone, geolocation, and other powerful APIs.

Remote app headers:

- Serve cached remote assets with same-origin script loading.
- Do not allow inline scripts unless the desktop bundle architecture requires it and a nonce/hash strategy exists.
- Keep service worker scope narrow.
- Do not allow remote app assets from `app.terminay.com`.

## Protocol Versioning

There is no production backward-compatibility requirement for the old shared-origin WebRTC draft. No users depend on it, so the implementation should delete the old QR generator, old parser, old runtime assumptions, and old tests instead of carrying a migration layer.

The first production origin-isolated protocol is `/v1/`:

```text
https://<channel>.terminay.com/v1/#<qr-secret>
```

`<channel>` is the high-entropy relay/session channel. The path segment is the protocol version. The fragment is a single QR-only secret.

Future incompatible protocols should add a new path version:

```text
https://<channel>.terminay.com/v2/#<qr-secret>
https://<channel>.terminay.com/v3/#<qr-secret>
```

Versioning rules:

- The hosted bootstrap dispatches by path version before parsing the QR secret.
- Unknown versions fail closed with a clear "unsupported QR version" error.
- Secret derivation labels include the protocol version.
- Asset manifests include a remote app protocol version and bundle id.
- Old shared-origin URLs like `https://app.terminay.com/connect?...#relayJoinToken=...` are development history only and must not be accepted in production.
- Tests should cover current `/v1/` behavior and an unsupported future version. They should not preserve the old multi-token fragment flow.

## Deployment Runbook

Wildcard production deployment requires these concrete checks before origin-isolated WebRTC is enabled by default:

- DNS: `*.terminay.com` and `app.terminay.com` point at the hosted Terminay app service.
- TLS: the edge presents a valid certificate for both `app.terminay.com` and `*.terminay.com`.
- Proxy/CDN: the original `Host` header is preserved when requests reach the Node service.
- WebSockets: `/signal` supports WebSocket upgrade on valid session hosts and local development hosts, not on the manager host.
- Cache policy: HTML is `no-store`; hashed bootstrap assets may be immutable; remote app assets are served by the per-session service worker cache.
- Health checks: `/healthz` verifies liveness and `/versionz` verifies deployed app version without exposing room state.
- Database: deploy `server/schema.sql` before new relay instances so `client_accepted_at` exists.
- Cleanup: expired rooms and their signaling events are removed by the relay cleanup loop; production should also schedule a database-side cleanup job for defense in depth.
- Logging: request, relay, and CDN logs must redact URL fragments and any query parameter named like `secret`, `token`, `pairingToken`, `relayJoinToken`, `signalingAuthToken`, or `qrSecret`.
- Rollback: use the hosted wildcard/session feature flag to disable session subdomain serving. Do not roll back by re-enabling shared-origin desktop-provided assets on `app.terminay.com`.
- Verification: after DNS, TLS, and the hosted app service are deployed, run `npm run verify:remote-production` in `terminay.com`. The verifier must pass before checking off DNS, TLS, canary enablement, or production relay verification.

Production verification on 2026-05-16:

- `npm run verify:remote-production` proved `app.terminay.com` DNS, wildcard session DNS, manager TLS, wildcard TLS, and wildcard `/signal` upgrade are reachable.
- The same run failed because production is not yet serving the new hosted app behavior: wildcard `/versionz` returned non-JSON `Not found`, wildcard `/v1/` returned `404`, wildcard `/session/logout` returned `405`, and manager `/signal` still accepted WebSocket upgrade.
- Local Docker artifact smoke on 2026-05-16 passed after rebuilding the hosted app image: `docker build -t terminay-app-remote-refactor:local .`, `docker compose up -d --build app`, and `npm run verify:remote-container`. The verifier checks manager `/healthz`, wildcard `/versionz`, wildcard `/v1/`, wildcard `/session/logout`, manager WebSocket `/signal` rejection, and session WebSocket `/signal` upgrade.
- Final local verification on 2026-05-16 passed: hosted app tests, hosted docs build, hosted app build, verifier syntax checks, hosted `git diff --check`, hosted container smoke with cleanup, desktop remote unit tests, desktop TypeScript, desktop app build, desktop remote Playwright E2E, and desktop `git diff --check`.
- Final production verification on 2026-05-16 still failed for the same deployment gap: production must be updated and `npm run verify:remote-production` must pass before this checklist is fully complete.
- Do not check off canary enablement or production wildcard relay verification until the deployed hosted app has this refactor and the verifier passes end to end.

## Cookie And Storage Allocation

The initial origin-isolated WebRTC release should avoid cookies unless a feature specifically needs HTTP cookie semantics. The preferred allocation is:

- Device private keys: IndexedDB on the exact session subdomain.
- Remote app UI preferences: localStorage or IndexedDB on the exact session subdomain.
- Bootstrap pairing material: memory only; URL fragment is removed from history before pairing work continues.
- Terminal connection tickets: memory only; short-lived and one-use.
- Manager session list: manager-local storage containing only non-secret metadata.
- Future HTTP session cookies: host-only `__Host-` cookies on the exact session subdomain, never `Domain=.terminay.com`.

Cookie-backed features must not be introduced until the CSRF design below is implemented.

## CSRF Design

Any future cookie-backed HTTP endpoint on a session subdomain must use all of these controls:

- Host-only `__Host-` session cookie with `Secure`, `HttpOnly`, `Path=/`, and `SameSite=Strict`.
- A per-session CSRF token derived from or bound to server-side session state, not readable by `app.terminay.com`.
- State-changing requests must include the CSRF token in a header such as `x-terminay-csrf`.
- Reject state-changing requests with an unexpected `Origin`.
- Reject unsafe `Sec-Fetch-Site` values where browser support exists.
- Do not enable credentialed wildcard CORS.
- Do not allow credentialed CORS from `app.terminay.com` to session subdomains.
- Test sibling-subdomain request attempts before shipping any cookie-backed endpoint.

The current WebRTC data-channel API does not use cookies for terminal authorization, so these controls are a gate for future HTTP features rather than a blocker for the current data-channel flow.

## Manager Storage Schema

`app.terminay.com` may store only non-secret session manager records.

Suggested local record:

```ts
type ManagedRemoteSession = {
  id: string
  sessionOrigin: string
  label: string
  desktopName?: string
  createdAt: string
  lastOpenedAt?: string
  lastConnectedAt?: string
  status: 'known' | 'stale' | 'revoked' | 'archived'
}
```

Forbidden manager fields:

- QR fragments or QR secrets
- relay join tokens
- pairing tokens
- signaling HMAC keys
- device private keys
- PINs or PIN hashes
- terminal connection tickets
- terminal output, command history, cwd, file names, or terminal session names

Manager actions should navigate to session subdomains. They should not embed session subdomains until a separate, strictly origin-checked `postMessage` protocol exists.

## Implementation Checklist

### 1. Specs And Architecture

- [x] Add this refactor spec to `terminay/specs/`.
- [x] Update `REMOTE.md` to reference `REMOTE_REFACTOR.md` as the production origin-isolation plan.
- [x] Decide final versioned QR URL shape.
- [x] Decide final channel id format and length.
- [x] Decide whether `<channel>` is identical to relay `roomId` or maps to it server-side.
- [x] Decide whether remembered WebRTC devices can reconnect without a fresh QR.
- [x] Write explicit threat model notes for malicious forks, compromised manager origin, malicious relay, shoulder-surfed QR, stolen phone, and sibling-subdomain CSRF.

### 2. DNS, TLS, And Hosting

- [x] Configure wildcard DNS for `*.terminay.com`.
- [x] Configure wildcard TLS certificate coverage for `*.terminay.com`.
- [x] Ensure hosted service receives the original `Host` header.
- [x] Route `app.terminay.com` to manager mode.
- [x] Route valid `<channel>.terminay.com` hosts to remote bootstrap mode.
- [x] Reject invalid hostnames safely.
- [x] Add local development host mapping for wildcard-like session testing.
- [x] Add deployment docs for wildcard DNS, TLS, CDN/proxy behavior, and host header preservation.

### 3. Hosted Server Refactor

- [x] Add hostname parser for manager host versus session host.
- [x] Serve manager shell on `app.terminay.com`.
- [x] Serve remote bootstrap shell on session subdomains.
- [x] Serve `/signal` only from local development hosts and valid session subdomains with strict allowlist rules.
- [x] Reject `/signal` on `app.terminay.com`.
- [x] Remove `/connect` static alias for the old shared-origin QR format.
- [x] Add security headers for bootstrap and manager responses.
- [x] Add no-store caching for bootstrap HTML.
- [x] Keep immutable caching only for static bootstrap assets with hashed filenames.
- [x] Prevent session subdomains from reading or serving manager-only routes.
- [x] Add health and version endpoints that do not expose room data.

### 4. Compact QR And Secret Derivation

- [x] Add a versioned compact QR payload design.
- [x] Generate a high-entropy DNS-safe channel id.
- [x] Generate a 32-byte or larger QR secret.
- [x] Build `https://<channel>.terminay.com/v1/#<qr-secret>` URLs for the first production protocol.
- [x] Remove old shared-origin multi-token QR generation entirely.
- [x] Implement HKDF-SHA256 derivation in desktop code.
- [x] Implement matching HKDF-SHA256 derivation in browser bootstrap code.
- [x] Derive relay join token, pairing token, signaling HMAC token, asset install key, and CSRF seed.
- [x] Remove the compatibility QR version setting; keep only protocol-versioned URL paths.
- [x] Keep QR error correction and rendered size tuned for fast scanning.

### 5. Bootstrap Parser And History Hygiene

- [x] Add `/v1/` parser for session subdomain URL plus fragment secret.
- [x] Reject old shared-origin `app.terminay.com/connect?...#relayJoinToken=...` payloads in production.
- [x] Reject unknown protocol paths such as `/v999/` with a clear unsupported-version error.
- [x] Validate channel id format against hostname.
- [x] Validate QR secret length and base64url shape.
- [x] Reject secrets in query params.
- [x] Consume the fragment into memory.
- [x] Immediately remove the fragment from browser history with `history.replaceState`.
- [x] Ensure status/error UI never renders the secret.
- [x] Ensure logs never include full QR URLs.

### 6. Signaling Relay Hardening

- [x] Allow rooms identified by high-entropy channel ids.
- [x] Store only relay join token hashes.
- [x] Enforce one active client per room.
- [x] Reject additional clients after first accepted join.
- [x] Add explicit room completion/purge path after WebRTC connects.
- [x] Delete signaling events when rooms complete or expire.
- [x] Add per-room message count caps.
- [x] Add IP and room rate limits for failed joins.
- [x] Add room creation rate limits.
- [x] Keep message byte limits for SDP/ICE.
- [x] Add structured operational logging with secret redaction.
- [x] Add metrics for rooms created, joined, expired, completed, failed, and rate-limited.

### 7. WebRTC Signature And Channel Security

- [x] Sign offer, answer, and ICE with derived signaling HMAC token.
- [x] Include room id and message type in every signed payload.
- [x] Verify signatures before applying remote descriptions or ICE candidates.
- [x] Close pairing on invalid signature.
- [x] Add replay protection with nonces or monotonic message ids if needed.
- [x] Ensure terminal/API data channels are ignored until pairing/auth completes.
- [x] Keep asset transfer on a separate data channel from terminal traffic.
- [x] Add data channel close/error propagation to UI and desktop audit state.

### 8. Per-Session Service Worker And Cache

- [x] Register service worker only on session subdomains.
- [x] Do not register remote app service worker on `app.terminay.com`.
- [x] Narrow service worker scope as much as practical.
- [x] Use versioned bundle paths such as `/remote-app/<bundle-id>/remote.html`.
- [x] Stop using shared `/remote-app/current/*` paths for production.
- [x] Cache only assets listed in the verified manifest.
- [x] Prune stale bundle caches after successful install.
- [x] Add retention policy for failed/old installs.
- [x] Add service worker tests for host scoping and cache pruning.

### 9. Asset Manifest Integrity

- [x] Include bundle id in asset manifest.
- [x] Include SHA-256 hash for every asset.
- [x] Include size, content type, and protocol version for every asset.
- [x] Verify every asset hash before `cache.put`.
- [x] Verify every asset byte length.
- [x] Reject unsafe paths, query strings, fragments, dot segments, and unexpected prefixes.
- [x] Reject protocol version mismatches.
- [x] Reject missing remote app entry file.
- [x] Add tests that tampered asset bodies fail install.
- [x] Add tests that wrong-path responses fail install.

### 10. Remote Runtime Refactor

- [x] Generalize WebRTC runtime detection away from hardcoded `app.terminay.com`.
- [x] Treat session subdomains as WebRTC remote origins.
- [x] Bind device pairing origin to the exact session origin or a structured session-origin descriptor.
- [x] Prevent a device paired on one session origin from authenticating on another.
- [x] Ensure `app.terminay.com` is never stored as the WebRTC device origin.
- [x] Keep Local Network origin binding unchanged.
- [x] Remove old shared-origin WebRTC origin binding.
- [x] Add transport runtime tests for `/v1/`, unsupported future versions, local network, and invalid hosts.

### 11. Cookie And Session Support

- [x] Define which features need cookies versus IndexedDB/sessionStorage.
- [x] Add host-only `__Host-` cookies for session subdomains when needed.
- [x] Omit `Domain` on sensitive cookies.
- [x] Add `Secure`, `HttpOnly`, `Path=/`, and `SameSite=Strict`.
- [x] Never set sensitive cookies on `.terminay.com`.
- [x] Never use `app.terminay.com` cookies for terminal authorization.
- [x] Add logout/revoke path that expires session-subdomain cookies.
- [x] Add tests or browser checks proving cookies do not leak between two session subdomains.

### 12. CSRF, CORS, And Browser Isolation

- [x] Add CSRF token design for any cookie-backed HTTP endpoint.
- [x] Scope CSRF tokens to the session subdomain.
- [x] Reject unexpected `Origin` headers on state-changing HTTP endpoints.
- [x] Reject unsafe `Sec-Fetch-Site` combinations where browser support exists.
- [x] Disable credentialed wildcard CORS.
- [x] Avoid credentialed CORS between manager and session origins.
- [x] Add `frame-ancestors 'none'` unless embedding is intentionally designed.
- [x] Add `X-Content-Type-Options: nosniff`.
- [x] Add `Referrer-Policy`.
- [x] Add `Permissions-Policy`.
- [x] Add tests for sibling-subdomain CSRF attempts.

### 13. Manager CRUD App

- [x] Define manager storage schema for non-secret session records.
- [x] Add create/import session entry flow if needed.
- [x] Add rename session.
- [x] Add archive/forget session.
- [x] Add revoke/close action that delegates to the session/desktop without sharing secrets.
- [x] Add stale session cleanup.
- [x] Add manager UI state for unreachable, expired, revoked, and recently used sessions.
- [x] Ensure manager never parses or stores QR fragments.
- [x] Ensure manager links navigate to session subdomains instead of embedding them.
- [x] Add tests that manager data contains no known secret fields.

### 14. Desktop App Changes

- [x] Add remote setting for production hosted base domain, defaulting to `terminay.com`.
- [x] Remove remote setting for compatibility connect URL once shared-origin payload support is deleted.
- [x] Generate production `/v1/` channel ids and QR secrets.
- [x] Register relay rooms with derived relay token hash.
- [x] Adopt pairing session using derived pairing token.
- [x] Pass session origin into WebRTC host config.
- [x] Update pairing QR status fields for `/v1/` URLs.
- [x] Ensure audit logs never include full QR secret.
- [x] Rotate QR codes on expiry.
- [x] Invalidate pairing session after successful pairing.
- [x] Close old host windows and relay sockets on rotation.
- [x] Keep Local Network startup behavior unchanged.

### 15. PIN And Device Auth

- [x] Keep PIN out of QR payloads.
- [x] Continue requiring PIN during `/api/pairing/start` when configured.
- [x] Prompt for first-use WebRTC PIN before generating production QR if required by product policy.
- [x] Store only salted `scrypt` PIN hashes locally.
- [x] Add rate limiting or delay for failed PIN attempts.
- [x] Ensure failed PIN does not reveal whether a relay/session is otherwise valid.
- [x] Keep RSA device challenge signing flow unchanged.
- [x] Add tests for wrong PIN, missing PIN, correct PIN, revoked device, and wrong-origin device.

### 16. NAT, STUN, TURN, And Reliability

- [x] Keep configurable STUN list.
- [x] Decide production TURN provider or self-hosted TURN plan.
- [x] Add TURN credentials delivery strategy that does not leak terminal secrets.
- [x] Add clear UI for direct WebRTC failure versus relay failure versus TURN unavailable.
- [x] Add retry behavior for transient signaling disconnects.
- [x] Decide whether connected sessions can survive relay room purge.
- [x] Add mobile background/reconnect behavior requirements.
- [x] Add network matrix testing for same LAN, cellular, corporate NAT, and restrictive Wi-Fi.

Production TURN decision:

- The first origin-isolated release can ship with configurable STUN and no bundled TURN provider.
- Production TURN should be either a managed TURN service with regional POPs or a self-hosted coturn cluster behind Terminay-owned DNS.
- TURN credentials must be short-lived, scoped to WebRTC relay use, and delivered from hosted bootstrap or relay config. They must never reuse QR secrets, pairing tokens, terminal tickets, or device keys.
- Connected WebRTC sessions are one-shot in the first origin-isolated release. Once the relay room is completed and purged, the already-established peer connection may continue, but reconnect requires a fresh QR and a fresh room.
- Mobile background behavior for the first release is best effort: if the browser suspends the page or data channel, the UI should report disconnect and require a fresh QR rather than silently reusing old room state.
- Required network matrix before broad rollout: same LAN, phone on cellular, home NAT, corporate NAT, restrictive guest Wi-Fi, and VPN/proxy environments.

Operational policy:

- Alert when relay error rates, room cleanup failures, database errors, or rate-limit events exceed baseline.
- Keep manager metadata local-only unless server-side manager sync is introduced. If server-side sync is added, define backup/restore and privacy policy language before launch.
- Treat compromised hosted bootstrap assets as an incident: disable wildcard session serving, rotate deployment credentials, publish a clean build, invalidate CDN cache, inspect relay logs with redaction, and advise users to revoke suspicious devices.
- Hosted signing/build artifacts need key rotation before signed bootstrap artifacts are introduced.

### 17. Documentation And UX

- [x] Update Remote Access docs to explain manager versus session subdomain.
- [x] Document that QR secrets stay in the fragment and are removed from history.
- [x] Document that Local Network mode is unchanged.
- [x] Document how wildcard DNS/TLS deployment works.
- [x] Document cookie/session isolation decisions.
- [x] Add troubleshooting for expired QR, wrong host, relay unavailable, WebRTC failed, TURN unavailable, and asset verification failed.
- [x] Update screenshots when the QR and manager UI change.
- [x] Ensure UI copy does not expose implementation secrets.

### 18. Tests

- [x] Unit test `/v1/` QR generation.
- [x] Unit test `/v1/` QR parsing.
- [x] Unit test old shared-origin QR rejection.
- [x] Unit test unsupported future protocol version rejection.
- [x] Unit test HKDF derivation compatibility between desktop and browser.
- [x] Unit test relay token hash validation.
- [x] Unit test HMAC signing and tamper rejection.
- [x] Unit test asset manifest validation.
- [x] Unit test asset hash verification.
- [x] Unit test unsafe asset path rejection.
- [x] Unit test exact session-origin device binding.
- [x] Remove old shared-origin compatibility tests.
- [x] Integration test two session subdomains cannot see each other's storage.
- [x] Integration test two session subdomains cannot see each other's cookies.
- [x] Integration test manager cannot read session cookies or Cache Storage.
- [x] Integration test service worker scope is per-session.
- [x] E2E test full `/v1/` pair/auth/connect flow with mocked WebRTC/signaling.
- [x] E2E test expired QR.
- [x] E2E test second client rejected for same room.
- [x] E2E test tampered SDP rejected.
- [x] E2E test tampered asset rejected.
- [x] Test device revocation closes the WebRTC terminal data channel through the host bridge.
- [x] E2E test Local Network mode still works.

### 19. Production Operations

- [x] Add deployment checklist for relay database migrations.
- [x] Add cleanup job for expired rooms and events.
- [x] Add alerting for relay error rates and room cleanup failures.
- [x] Add logs with QR and token redaction.
- [x] Add abuse controls for room spam and join guessing.
- [x] Add backup/restore policy for non-secret manager data if server-side manager storage is introduced.
- [x] Add privacy policy notes if manager metadata is stored server-side.
- [x] Add incident procedure for compromised hosted bootstrap assets.
- [x] Add key rotation story for hosted signing/build artifacts if used later.

### 20. Release Plan

- [x] Land spec and tests for versioned compact URL parsing/derivation first.
- [x] Ship hosted wildcard bootstrap behind a feature flag.
- [x] Ship desktop `/v1/` QR generation as the sole WebRTC QR path.
- [x] Delete old shared-origin QR generation, parser, settings, and tests before canary.
- [x] Enable `/v1/` origin-isolated WebRTC for canary builds.
- [ ] Verify production wildcard DNS/TLS/relay behavior.
- [x] Enable `/v1/` origin-isolated WebRTC by default for packaged builds.
- [x] Keep URL path versioning in place for future `/v2/` and later protocols.

## Production Readiness Criteria

Production WebRTC origin isolation is complete when:

- New QR codes target `<channel>.terminay.com/v1/`, not `app.terminay.com`.
- New QR codes contain only a compact room URL and QR-only fragment secret.
- `app.terminay.com` can manage sessions but cannot read session cookies, storage, Cache Storage, service workers, pairing secrets, or terminal state.
- Remote assets run only under per-session subdomains.
- Sensitive cookies are host-only and use the `__Host-` prefix.
- Asset hashes are verified before caching.
- The relay accepts only one active client per room and purges room state early.
- Signaling tampering fails before WebRTC descriptions or ICE candidates are applied.
- Pairing and device auth are bound to the exact session origin.
- Local Network mode remains unchanged and covered by tests.
- The test suite covers the current `/v1/` production protocol, rejects unknown future versions, and rejects the old shared-origin draft payload.

## Open Questions

- Should the channel id remain the relay room id directly, or should the relay map a public channel host id to an internal room id?
- Should session subdomains be reusable for remembered devices, or should every QR produce a one-shot origin?
- Should cookies be introduced immediately, or should the first refactor only create the origin boundary and keep persistence in IndexedDB?
- Should the manager store records locally in the browser, server-side under a user account, or both?
- Should the hosted bootstrap be signed or pinned by the desktop in addition to being served over HTTPS?
- What TURN provider and credential lifetime should production use?
- How long should old desktop-provided bundles remain cached on a session subdomain?
