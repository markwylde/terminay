# Canonical remote pairing and PWA manager

## Goal

Replace the current remote-access implementation with the single model defined
by the feature specifications. A direct pairing URL and the
`app.terminay.com` PWA both lead to the same session-origin enrollment. Later
connections authenticate with one origin-bound device signing key and receive
a short-lived connection ticket.

This is a clean cutover. Delete superseded code, storage schemas, settings,
routes, UI, tests, and deployment behavior. Do not preserve compatibility,
migration, import, alias, fallback, or dual-path behavior. Existing remote
browser and Desktop pairings may be invalidated and paired again.

## Governing specifications

- [Remote access](../features/remote-access.md)
- [Connections and client hosts](../features/connections-and-client-hosts.md)
- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)
- [Local Desktop diagnostics](../features/local-desktop-diagnostics.md)
- [Product core](../CORE.md)

## Current implementation gap

The implementation still contains several competing remote architectures:

- browser and server reconnect grants, derived HMAC proof keys, reconnect
  lifetimes, grant rotation, and grant-specific persistence;
- manager-origin pairing coordination, iframe/window messaging, workspace host
  bridges, and manager knowledge of session authentication state;
- profile metadata import and cross-origin manager migration between
  `app.terminay.com` and `web.terminay.com`;
- a direct-network/LAN listener, its settings and QR journey, alongside WebRTC;
- browser profile records and UI states that exceed the PWA's bookmark role;
- tests, release configuration, and diagnostics that require those discarded
  paths.

These mechanisms must be replaced, not adapted or retained behind flags.

## Implementation slices

### One device identity and reconnect protocol

- [x] Define one versioned remote enrollment and reconnect contract shared by
  browser, Desktop, server runtime, signaling bootstrap, and tests.
- [x] During enrollment, create one non-extractable signing private key at the
  exact session origin. Store only its public key, device id, name, timestamps,
  and revocation state on the server.
- [x] Make Desktop use the same logical identity contract while keeping its
  private key in OS-protected main-process storage.
- [x] Replace reconnect grants and derived proof/signaling keys with a
  server-issued nonce challenge signed by the registered device key.
- [x] Bind every challenge to the server identity, exact session origin, device
  id, nonce, and expiry. Reject replay, cross-origin, cross-server, expired, and
  revoked proofs.
- [x] Issue a short-lived, single-use connection ticket only after successful
  device proof. Bind it to the authenticated device and WebRTC peer and keep it
  out of durable client storage.
- [x] Make device revocation close live connections and reject future proofs
  without affecting other devices or server-owned PTYs.
- [x] Delete reconnect-grant stores, settings, summaries, lifetime controls,
  protocol fields, persistence inventories, adapters, UI, and production code.
  Do not read or migrate their stored records.

### Session-origin pairing journey

- [x] Make each server's stable `https://<server>.terminay.com` origin own the
  complete browser pairing, authentication, WebRTC, bundle, reconnect, status,
  and error journey.
- [x] Accept pairing authority only from a short-lived, single-use URL fragment.
  Consume it in memory and remove it from the visible URL and browser history
  before loading unrelated resources or emitting telemetry.
- [x] Require the fragment plus the configured six-digit PIN or explicit server
  approval before registering the device public key.
- [x] Mark the fragment consumed only as part of successful enrollment and give
  expired, consumed, malformed, denied, and network failures distinct errors.
- [x] Open the authenticated server-bundled workspace after pairing. A later
  visit to the stable origin must reconnect with the stored device key and no
  pairing URL.
- [x] Use the same protocol and server-side device/audit semantics for direct
  browser links, PWA navigation, and Desktop pairing.

### Thin `app.terminay.com` PWA

- [x] Reduce the PWA to an installable connection bookmark manager with Add,
  rename, open, forget, and explicit open-in-new-tab actions.
- [x] Store exactly label, canonical stable HTTPS origin, created time, and
  last-opened time in one browser-local profile schema.
- [x] On **Add connection…**, validate the complete pairing URL, derive and
  immediately save or update the stable-origin bookmark, then navigate the
  current tab to the unmodified pairing URL.
- [x] Never persist, log, copy into history, or send the pairing fragment from
  the manager. Reject URL credentials, queries, unsupported schemes, and
  unsupported origins.
- [x] Selecting a saved bookmark navigates directly to its stable session
  origin. The manager does not test or report paired, connected, offline,
  expired, or revoked state.
- [x] Cache the PWA application shell so the manager and saved bookmark list
  open offline. Do not claim that an unreachable session origin is connected.
- [x] Delete manager-side enrollment, reconnect vaults, device credentials,
  workspace loading, session host bridges, iframe/window messaging, pairing
  result callbacks, profile metadata import, and migration code.
- [x] Remove `web.terminay.com` migration behavior and all retired-manager
  constants, pages, routes, deployment rules, tests, and documentation from
  active product surfaces. No stored data is imported.

### One WebRTC exposure path

- [x] Keep WebRTC signaling and TURN relay as the only remote exposure and
  application transport path.
- [x] Delete the direct-network/LAN listener implementation, settings, QR flow,
  status, IPC, persistence, diagnostics, tests, and release configuration.
- [x] Make **Expose this server…** enable authenticated WebRTC signaling,
  pairing policy, pairing-link generation, device administration, connection
  status, and stop-exposure behavior through one server-owned authority.
- [x] Preserve server-owned work and PTYs across client disconnect, reload,
  reconnect, new pairing-link generation, and exposure changes.
- [x] Ensure automatic recovery and explicit Retry create the same fresh
  authenticated WebRTC generation and resume confirmed workspace revisions and
  terminal sequence positions before enabling input.

### UI and state convergence

- [x] Remove reconnect-grant lifetime controls, grant badges, direct-listener
  tabs, metadata-import controls, migration notices, and any manager-side
  authentication status from shared and Desktop UI.
- [x] Present paired devices by device name, creation/last-seen metadata,
  current connection state, and revocation action without exposing credential
  details.
- [x] Keep forget, disconnect, revoke, and stop exposure as distinct confirmed
  operations with the scopes defined by the feature specs.
- [x] Ensure the disconnected session-origin pairing form and errors use the
  normal responsive product theme and remain usable on narrow mobile
  viewports. The public PWA theme is owned and verified in the repository that
  publishes `app.terminay.com`.

### Persistence, security, and diagnostics

- [x] Replace persisted remote-device state with an explicit current schema.
  Start clean when another schema is encountered; do not add migration code.
- [x] Keep browser private keys non-extractable and inaccessible to the PWA,
  signaling service, TURN service, workspace messages, logs, and analytics.
- [x] Keep Desktop private keys and pairing material out of renderers and
  preload APIs except for the narrow user-input invocation required to pair.
- [x] Redact pairing fragments, PINs, private keys, signed proofs, challenges,
  tickets, SDP/ICE credentials, and application data from diagnostics.
- [x] Preserve exact server, origin, project, terminal, window, and transport-
  generation boundaries in authorization and recovery.

### Tests and deployment proof

- [x] Replace tests that assert reconnect grants, proof keys, metadata import,
  manager migration, manager/session messaging, or direct-network behavior.
  Do not retain obsolete tests as skipped compatibility coverage.
- [x] Unit-test pairing URL validation and scrubbing, bookmark persistence
  before navigation, exact-origin deduplication, offline PWA restoration, and
  the manager's strict metadata allowlist.
- [x] Unit-test device enrollment, signed challenge verification, ticket
  expiry/single use, replay and cross-origin rejection, revocation, and
  credential redaction.
- [x] Add automated session-browser flow coverage for both journeys: a direct
  pairing link and PWA-initiated pairing use the same session-origin enrollment
  contract, then reconnect with the stored device key and a fresh ticket.
- [x] Cover expired/consumed links, wrong PIN, denied approval, missing key,
  revoked device, offline server, signaling failure, TURN failure, refresh,
  browser restart, and interrupted WebRTC recovery.
- [x] Cover Desktop pairing and reconnect through the same server contract and
  prove that credentials never enter renderer-visible state.
- [x] Keep Electron end-to-end execution container-only through
  `npm run test:e2e`; remote code-level coverage does not invoke Playwright's
  Electron runner on the host.
- [x] Keep deployment and manual verification out of this implementation task.
  Automated routing, header, PWA-shell, service-worker, archive, and retired-
  route checks remain in the two repository test suites; a release owner runs
  the published-artifact verifier separately.

## Acceptance checks

- Pasting a valid pairing URL into the PWA saves one bookmark before same-tab
  navigation; returning to the PWA shows it after success, failure, or offline
  interruption.
- Opening the pairing URL directly and opening it through the PWA execute the
  same session-origin enrollment and produce the same server-side device
  record.
- After enrollment, opening the stable session origin proves possession of the
  device key, receives a fresh ticket, and reconnects without the pairing URL.
- A consumed pairing URL cannot enroll another device, while generating a new
  URL does not disconnect registered devices or terminate PTYs.
- PWA storage contains only label, stable origin, and timestamps. Session-origin
  storage contains one non-extractable device private key and non-secret device
  metadata. The server contains the public key and revocation metadata.
- The PWA remains usable as a bookmark list offline and makes no claim about
  live server or authentication state.
- Remote application traffic has one WebRTC path. No LAN/direct listener or
  automatic transport fallback exists.
- No production path or active test contains reconnect grants, derived proof
  keys, profile import, cross-origin manager migration, pairing callbacks,
  manager workspace hosting, or retired-manager routing.
- The server-bundled responsive workspace behaves consistently in Local
  Desktop, remote Desktop, and browser sessions without crossing server,
  project, window, terminal, or credential boundaries.

## Definition of done

- Every implementation slice and acceptance check above is complete.
- All superseded production code, active tests, assets, routes, settings,
  storage schemas, and deployment configuration are deleted rather than left
  disabled or deprecated.
- Focused unit/integration suites, package builds, and `npm run test:e2e` pass.
- Public deployment verification proves the intended PWA at
  `app.terminay.com` and direct pairing/reconnect at a stable session origin.
- The task is moved to `../tasks_completed/` with concise implementation and
  verification evidence.

## Implementation evidence

- Device identity, challenge, ticket, revocation, and Desktop protected-store
  coverage: `packages/server-core/test/remote-device-authentication.test.mjs`,
  `scripts/device-pairing-flow.test.mjs`, and
  `scripts/desktop-device-credential-store.test.mjs`.
- One WebRTC exposure and relay-scoped signaling coverage:
  `scripts/webrtc-pairing.test.mjs`, `scripts/webrtc-service-runtime.test.mjs`,
  `scripts/task17-desktop-webrtc-bootstrap.test.mjs`, and
  `scripts/support/webRtcHostRuntime.ts`.
- PWA bookmark, session pairing PIN, direct-session, reconnect, routing,
  storage-isolation, service-worker, and archive coverage lives in
  `terminay.com-pwa-manager-model/specs/*.test.mjs`; its current suite is
  `npm run test:app`.
- Code-level validation completed with `npm run build:app`,
  `npm run build --workspace @terminay/server`, root TypeScript checking, the
  focused remote test suites, `npm run test:app`, `npm run build:app` in the
  Terminay.com worktree, and whitespace/static legacy sweeps. No deployment or
  manual verification is claimed here.

