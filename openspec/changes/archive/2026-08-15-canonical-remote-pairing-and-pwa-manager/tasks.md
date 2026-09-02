## 1. One device identity and reconnect protocol

- [x] 1.1 Define one versioned remote enrollment and reconnect contract shared by
  browser, Desktop, server runtime, signaling bootstrap, and tests, verified by
  `packages/server-core/test/remote-device-authentication.test.mjs`
- [x] 1.2 Create one non-extractable signing private key at the exact session
  origin during enrollment and store only its public key, device id, name,
  timestamps, and revocation state on the server, verified by storage assertions
- [x] 1.3 Make Desktop use the same logical identity contract with its private key
  in OS-protected main-process storage, verified by
  `scripts/desktop-device-credential-store.test.mjs`
- [x] 1.4 Replace reconnect grants and derived proof and signaling keys with a
  server-issued nonce challenge signed by the registered device key, verified by
  challenge verification tests
- [x] 1.5 Bind every challenge to the server identity, exact session origin,
  device id, nonce, and expiry and reject replay, cross-origin, cross-server,
  expired, and revoked proofs, verified by rejection tests
- [x] 1.6 Issue a short-lived single-use connection ticket only after a successful
  device proof, bound to the authenticated device and WebRTC peer and kept out of
  durable client storage, verified by ticket expiry and single-use tests
- [x] 1.7 Make device revocation close live connections and reject future proofs
  without affecting other devices or server-owned PTYs, verified by revocation
  tests
- [x] 1.8 Delete reconnect-grant stores, settings, summaries, lifetime controls,
  protocol fields, persistence inventories, adapters, UI, and production code
  without reading or migrating their stored records, verified by static sweeps

## 2. Session-origin pairing journey

- [x] 2.1 Make each server's stable `https://<server>.terminay.com` origin own the
  complete browser pairing, authentication, WebRTC, bundle, reconnect, status,
  and error journey, verified by session-browser flow coverage
- [x] 2.2 Accept pairing authority only from a short-lived single-use URL
  fragment, consumed in memory and removed from the visible URL and history
  before loading unrelated resources or emitting telemetry, verified by scrubbing
  tests
- [x] 2.3 Require the fragment plus the configured six-digit PIN or explicit
  server approval before registering the device public key, verified by pairing
  tests
- [x] 2.4 Mark the fragment consumed only as part of a successful enrollment and
  give expired, consumed, malformed, denied, and network failures distinct
  errors, verified by error-path tests
- [x] 2.5 Open the authenticated server-bundled workspace after pairing and make a
  later visit to the stable origin reconnect with the stored device key and no
  pairing URL, verified by `scripts/device-pairing-flow.test.mjs`
- [x] 2.6 Use the same protocol and server-side device and audit semantics for
  direct browser links, PWA navigation, and Desktop pairing, verified by the
  shared contract tests

## 3. Thin `app.terminay.com` PWA

- [x] 3.1 Reduce the PWA to an installable connection bookmark manager with Add,
  rename, open, forget, and explicit open-in-new-tab actions, verified by the PWA
  suite
- [x] 3.2 Store exactly label, canonical stable HTTPS origin, created time, and
  last-opened time in one browser-local profile schema, verified by the strict
  metadata allowlist test
- [x] 3.3 On **Add connection…** validate the complete pairing URL, derive and
  immediately save or update the stable-origin bookmark, then navigate the
  current tab to the unmodified pairing URL, verified by
  bookmark-persistence-before-navigation tests
- [x] 3.4 Never persist, log, copy into history, or send the pairing fragment from
  the manager, and reject URL credentials, queries, unsupported schemes, and
  unsupported origins, verified by pairing URL validation and scrubbing tests
- [x] 3.5 Make selecting a saved bookmark navigate directly to its stable session
  origin without testing or reporting paired, connected, offline, expired, or
  revoked state, verified by manager behaviour tests
- [x] 3.6 Cache the PWA application shell so the manager and bookmark list open
  offline without claiming an unreachable session origin is connected, verified
  by offline restoration tests
- [x] 3.7 Delete manager-side enrollment, reconnect vaults, device credentials,
  workspace loading, session host bridges, iframe and window messaging, pairing
  result callbacks, profile metadata import, and migration code, verified by
  static sweeps
- [x] 3.8 Remove `web.terminay.com` migration behaviour and all retired-manager
  constants, pages, routes, deployment rules, tests, and documentation from
  active product surfaces, importing no stored data, verified by
  retired-route checks

## 4. One WebRTC exposure path

- [x] 4.1 Keep WebRTC signaling and TURN relay as the only remote exposure and
  application transport path, verified by `scripts/webrtc-pairing.test.mjs` and
  `scripts/webrtc-service-runtime.test.mjs`
- [x] 4.2 Delete the direct-network LAN listener implementation, settings, QR
  flow, status, IPC, persistence, diagnostics, tests, and release configuration,
  verified by static sweeps
- [x] 4.3 Make **Expose this server…** drive authenticated WebRTC signaling,
  pairing policy, pairing-link generation, device administration, connection
  status, and stop-exposure through one server-owned authority, verified by
  `scripts/task17-desktop-webrtc-bootstrap.test.mjs`
- [x] 4.4 Preserve server-owned work and PTYs across client disconnect, reload,
  reconnect, new pairing-link generation, and exposure changes, verified by
  recovery tests
- [x] 4.5 Ensure automatic recovery and explicit Retry create the same fresh
  authenticated WebRTC generation and resume confirmed workspace revisions and
  terminal sequence positions before enabling input, verified by
  `scripts/support/webRtcHostRuntime.ts` driven recovery coverage

## 5. UI and state convergence

- [x] 5.1 Remove reconnect-grant lifetime controls, grant badges, direct-listener
  tabs, metadata-import controls, migration notices, and manager-side
  authentication status from shared and Desktop UI, verified by UI sweeps
- [x] 5.2 Present paired devices by device name, creation and last-seen metadata,
  current connection state, and revocation action without exposing credential
  details, verified by UI tests
- [x] 5.3 Keep forget, disconnect, revoke, and stop exposure as distinct confirmed
  operations with the specified scopes, verified by scope tests
- [x] 5.4 Ensure the disconnected session-origin pairing form and errors use the
  normal responsive product theme and remain usable on narrow mobile viewports;
  the public PWA theme is owned and verified in the repository that publishes
  `app.terminay.com`

## 6. Persistence, security, and diagnostics

- [x] 6.1 Replace persisted remote-device state with an explicit current schema
  that starts clean when another schema is encountered, adding no migration code,
  verified by schema tests
- [x] 6.2 Keep browser private keys non-extractable and inaccessible to the PWA,
  signaling service, TURN service, workspace messages, logs, and analytics,
  verified by storage-isolation tests
- [x] 6.3 Keep Desktop private keys and pairing material out of renderers and
  preload APIs except for the narrow user-input invocation required to pair,
  verified by renderer-visible surface tests
- [x] 6.4 Redact pairing fragments, PINs, private keys, signed proofs,
  challenges, tickets, SDP and ICE credentials, and application data from
  diagnostics, verified by redaction tests
- [x] 6.5 Preserve exact server, origin, project, terminal, window, and
  transport-generation boundaries in authorization and recovery, verified by
  boundary tests

## 7. Tests and deployment proof

- [x] 7.1 Replace tests asserting reconnect grants, proof keys, metadata import,
  manager migration, manager/session messaging, or direct-network behaviour,
  retaining none as skipped compatibility coverage
- [x] 7.2 Unit-test pairing URL validation and scrubbing, bookmark persistence
  before navigation, exact-origin deduplication, offline PWA restoration, and the
  manager's strict metadata allowlist
- [x] 7.3 Unit-test device enrollment, signed challenge verification, ticket
  expiry and single use, replay and cross-origin rejection, revocation, and
  credential redaction
- [x] 7.4 Add automated session-browser flow coverage proving a direct pairing
  link and PWA-initiated pairing use the same session-origin enrollment contract
  and then reconnect with the stored device key and a fresh ticket
- [x] 7.5 Cover expired and consumed links, wrong PIN, denied approval, missing
  key, revoked device, offline server, signaling failure, TURN failure, refresh,
  browser restart, and interrupted WebRTC recovery
- [x] 7.6 Cover Desktop pairing and reconnect through the same server contract and
  prove credentials never enter renderer-visible state
- [x] 7.7 Keep Electron end-to-end execution container-only through
  `npm run test:e2e`, with remote code-level coverage not invoking Playwright's
  Electron runner on the host
- [x] 7.8 Keep deployment and manual verification out of this task, leaving
  automated routing, header, PWA-shell, service-worker, archive, and retired-route
  checks in the two repository test suites and the published-artifact verifier to
  a release owner
- [x] 7.9 Complete code-level validation with `npm run build:app`,
  `npm run build --workspace @terminay/server`, root TypeScript checking, the
  focused remote test suites, `npm run test:app`, `npm run build:app` in the
  Terminay.com worktree, and whitespace and static legacy sweeps
