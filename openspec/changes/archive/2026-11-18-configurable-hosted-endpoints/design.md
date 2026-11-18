## Context

Terminay Servers are open source and untrusted. When the hosted manager frames a server, that server's session code runs in the browser, so each session must have its own origin. Otherwise a malicious server could reach the manager's vault, or another server's session storage. ADR-0005 and ADR-0012 put the manager at `app.terminay.com` and each session at `<session-id>.terminay.com`.

Today one string, the "hosted domain" (`webRtcHostedDomain` in Desktop settings, `--hosted-domain` / `TERMINAY_HOSTED_DOMAIN` on the standalone server and in the daemon installer), drives both hosts. The rules are spread across the code:

- `packages/protocol/src/hostedPairingUrl.ts`: `managerHostnameFromSessionHostname` returns `app.` + the parent labels; `sessionHostnameFromManagerHostname` strips `app.`; `isManagerHostname` accepts any `app.*`; `sessionIdFromHostname` and `isKnownHostedSessionHostname` hardcode `.terminay.com`.
- `packages/protocol/src/managerOrigins.ts`: the constant `TERMINAY_MANAGER_ORIGIN`.
- `apps/terminay-server/src/remote/hostedPairingSecrets.ts` (`hostedSessionId`), `directSessionId.ts` (`relaySessionId`), `publicPairingUrl.ts`, `hostedPairingHost.ts` (`classifySignalingHost`): all hardcode `.terminay.com` / `app.terminay.com`.
- `apps/terminay-server/src/remote/sessionOrigin.ts`: mints `<uuid>.<domain>` and keeps a persisted origin while it ends in the domain.
- `apps/terminay-server/src/cli.ts`: the manager origin is `` `https://app.${hostedDomain}` ``; `pairingUrlFormatForOrigin` checks against `app.<domain>`.
- `electron/remote/webrtc.ts`: `createChannelUrl` builds `<id>.<domain>`; loopback `http://localhost:port` is handled separately.

A preview manager at `app-pr123.dev.terminay.com` with sessions at `<id>-pr123.dev.terminay.com` cannot be expressed under any of these rules. Those names are deliberately flat, so one `*.dev.terminay.com` wildcard DNS record and certificate serves every pull request.

## Goals / Non-Goals

**Goals:**

- Two explicit values, App Server and Session Server, replace the hosted domain everywhere in this repository, with production defaults that change nothing for existing users.
- One shared implementation in `packages/protocol` formats, parses, validates and matches both values. The server, Desktop and the web host all call it.
- Preserve the isolation boundary: the manager and every session keep distinct origins.

**Non-Goals:**

- The hosted manager and relay (`terminay.com` repository), and the preview workflow and infrastructure. They consume the same two values in a follow-up pull request.
- Letting a pairing link carry its own Session Server. A client reading a link uses its own configured endpoints (see Decisions).
- Changing the session-id format or the transcript and key derivation that use it.

## Decisions

### 1. A `HostedEndpoints` value in `@terminay/protocol`

Add `hostedEndpoints.ts` exporting:

- `PRODUCTION_HOSTED_ENDPOINTS = { appServer: 'https://app.terminay.com', sessionServer: 'https://<session>.terminay.com' }`
- `parseHostedEndpoints({ appServer, sessionServer })`: validates and normalises the pair, throwing a named error.
- `sessionOriginFor(endpoints, sessionId)`
- `sessionIdFromOrigin(endpoints, origin)`: returns `undefined` when the origin does not match.
- `isAppServerOrigin(endpoints, origin)`

Matching compiles the template's leftmost label into an anchored pattern: the literal prefix and suffix around `<session>`, with the session-id character class from `SESSION_ID_PATTERN`. The remaining labels, scheme and port must match exactly. Every existing caller takes the endpoints value, and none derives one host from the other.

*Alternative:* keep one domain and add a "preview suffix". Rejected because it is a second piece of special-casing, the problem we are removing.

**Boundary crossed:** origin isolation. Validation enforces:

- `<session>` appears exactly once and only in the leftmost label.
- The App Server never matches the template.
- HTTPS is required except for loopback hosts.
- No credentials, path, query or fragment.
- A minted label is at most 63 characters.

### 2. Clients parse links with their own configured endpoints

The pairing-link grammar is unchanged: `<app-server>/?s=<id>#<secret>`. A parser accepts a manager link only when its origin equals the configured App Server, and builds the session origin from the configured Session Server. Desktop uses its settings, and the web host and the hosted manager use their own configuration. A link from another manager is then classified as direct or rejected. It is never trusted as a manager.

*Alternative:* put the session template in the link. Rejected because a hostile link could then choose the session origin a client frames.

### 3. Loopback development expressed as ordinary endpoints

Today `localhost:5173` is special-cased in `createChannelUrl`. It becomes App Server `http://localhost:5173` and Session Server `http://<session>.localhost:5173`, and passes the same validation through the loopback-HTTP rule. The `.localhost` and `.127.0.0.1` branches in `relaySessionId` and `isLoopbackSessionHttp` stay only for direct-origin classification. They no longer imply a manager.

### 4. Session origin persistence keyed to the template

`loadOrCreateSessionOrigin(dataRoot, endpoints)` reuses the persisted origin only while `sessionIdFromOrigin(endpoints, persisted)` matches. Otherwise it mints `sessionOriginFor(endpoints, <uuid hex>)`. The file format (`remote-session-origin.v1.json`) is unchanged.

### 5. Settings and configuration surfaces

- Desktop settings: `remoteAccess.appServer` and `remoteAccess.sessionServer` replace `remoteAccess.webRtcHostedDomain` in `src/terminalSettings.ts` and `packages/server-core/src/settings/defaults.ts`. Invalid values are rejected by the settings normaliser, and the field shows the validation message.
- Standalone server: `--app-server` / `TERMINAY_APP_SERVER` and `--session-server` / `TERMINAY_SESSION_SERVER`.
- Daemon installer: `daemon install --app-server --session-server`, written to the environment file.

## Risks / Trade-offs

- [A wrong template could merge origins] → Validation is the only gate, and every component uses the same validator. Unit tests cover each rejection case: placeholder position, a manager that matches the template, label length, HTTP on a public host.
- [Existing standalone installs carry `TERMINAY_HOSTED_DOMAIN`] → See Migration Plan. The default `terminay.com` maps cleanly, and a custom domain fails loudly instead of silently moving to production.
- [A server and a client with different endpoints] → Pairing fails with "not a Terminay pairing link". This is intended: a developer testing a preview sets both ends.
- [The `terminay.com` hosted relay still hardcodes its domain] → Production is unaffected. Previews need the follow-up `terminay.com` change before they work end to end.

## Migration Plan

- Desktop settings: on load, a stored `webRtcHostedDomain` maps to the new pair. `terminay.com` (or empty) maps to the production defaults. A loopback value `localhost:<port>` maps to `http://localhost:<port>` and `http://<session>.localhost:<port>`. Any other value `<d>` maps to `https://app.<d>` and `https://<session>.<d>`, which is exactly what it meant before. The old key is then dropped.
- Standalone and daemon: if `--hosted-domain` / `TERMINAY_HOSTED_DOMAIN` is set to `terminay.com`, the server ignores it and starts normally. Any other value makes startup fail and names `--app-server` / `--session-server`. `daemon install` writes the new variables. `daemon upgrade` leaves an existing environment file alone, so an install made before this change keeps `TERMINAY_HOSTED_DOMAIN=terminay.com`, which the server ignores; re-running `daemon install` replaces it.
- Persisted session origins under the production defaults still match the template, so paired devices keep reconnecting.
- Rollback: an older build ignores the new keys and falls back to its `terminay.com` default, which is the same production behaviour.

## Open Questions

- ADR-0005 and ADR-0012 name `app.terminay.com` and `<session-id>.terminay.com` as the hosts. They are not wrong, because these stay the defaults, but a new ADR records that the hosts are configuration under fixed isolation rules. Neither ADR is superseded: their isolation decision stands.
