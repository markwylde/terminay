# Connection menu and web host

## Goal

Replace the Desktop **Remote** control with the shared current-server connection
menu, deliver multi-server native-window behaviour, and deploy
`web.terminay.com` as the stable browser connection host with no Local option.

## Governing specifications

- [Connections and client hosts](../features/connections-and-client-hosts.md)
- [Remote access](../features/remote-access.md)
- [Settings, shortcuts, and desktop integration](../features/settings-shortcuts-and-desktop-integration.md)

## Why this is active

Desktop currently treats **Remote** as a toggle/settings surface for exposing
the current Electron terminal sessions. The hosted manager at
`app.terminay.com` remembers non-secret session origins but is separate from the
desktop journey. Neither host offers the intended Local-plus-many-remotes
current-server model.

## Dependencies

- [Desktop connection host and Local mode](./7-desktop-connection-host-and-local-mode.md)
- [Full WebRTC server connections](./17-full-webrtc-server-connections.md)

## Work slices

### Shared connection model and menu

- [x] Implement current profile/status, remembered profiles, add/import,
  open/focus/switch, manage, retry/disconnect, forget, revoke, and exposure
  actions through a host-neutral connection model.
- [x] Label the header with **Local** or the selected server label rather than
  transport. The Desktop production header now renders `Local` and a
  connection-menu label, with a focused renderer regression test in
  `scripts/connection-menu-renderer.test.mjs`.
  The narrow server-connection hand-off carries only a validated display label
  alongside its fixed server id, so a selected HTTP remote cannot continue to
  render as **Local** after its terminal transport is live.
- [x] Keep activity/notification count separate from connection state.
- [x] Distinguish offline, relay, WebRTC route, expired, revoked, identity
  mismatch, and incompatible failures.
- [x] Add a host-neutral accessible keyboard/touch menu model with stable
  ordering, focus wrapping, and explicit activation.
- [x] Add the rename form, confirmation language, and responsive management
  cards (`createConnectionRenameForm` and `createConnectionManagementModel` in
  `@terminay/responsive-ui`, covered by `packages/responsive-ui/test/ui.test.mjs`).

### Desktop behaviour

- [x] Show immutable Local plus remembered remote profiles.
- [x] Focus an existing suitable window or open a new connection window by
  default; expose current-window rebinding explicitly.
- [x] Support one Local plus several simultaneous remote server windows without
  credential/state leakage.
- [x] Show **Expose this server…** only when the current connection has the
  administrative capability (`createConnectionMenuModel` gates it on the
  `serverExposure` host capability and the current connected profile; covered
  by `packages/responsive-ui/test/ui.test.mjs`).
- [x] Integrate deep links/pasted pairing URLs without leaving unconsumed
  fragments in logs/history/profile storage.

### Web host

Operational follow-up: deploy the stable connection shell/manager at
`web.terminay.com` using
[the web-host deployment runbook](../operations/web-host-deployment.md).
Public DNS/CDN/origin changes and their live verification are release
operations rather than remaining project-code implementation.
- [x] Keep a deterministic local release-readiness contract for the web host
  (package exports, built artifacts, stable manager origin, and no Local
  profile); this does not claim public deployment, DNS, TLS, or CDN verification
  (`scripts/task18-web-host-readiness.mjs`).
- [x] Prove the local static web image can proxy an authenticated compose
  server connection and survive a server-only restart without restarting the
  web container; this is local Docker Compose evidence only and does not claim
  public `web.terminay.com` deployment (`scripts/docker-compose-web-server-smoke.mjs`,
  evidence: `specs/decisions/evidence/docker-compose-web-server-smoke.md`).
- [x] Provide disconnected/empty, remembered, archived, offline, expired,
  revoked, and unreachable states.
  - [x] Replace the temporary standalone browser "Connections" page with a
    Terminay-like disconnected host shell and connect modal. Evidence:
    `src/web/main.tsx`, `src/web/index.css`, and
    `scripts/web-disconnected-shell.test.mjs`; the browser host still exposes
    no Local server and stores only non-secret profile metadata.
- [x] Open the selected server's bundled UI in the chosen safe
  navigation/embedding model and support an explicit new-browser-tab action
  (`WebConnectionHost.open`/`sessionUrl` construct exact-origin, route-only
  URLs and select `_self`/`_blank`; covered by
  `apps/terminay-web/test/connection-host.test.mjs`).
- [x] Implement the strict origin/source-checked host bridge from the foundation
  decision.
- [x] Store non-secret metadata only and leave keys/grants on exact session
  origins. The static browser host derives and persists a non-extractable
  origin-keyed WebCrypto proof key in IndexedDB, discards the pairing grant,
  and keeps `localStorage` metadata-only; focused proof compatibility and
  origin-isolation coverage is in `apps/terminay-web/test/connection-host.test.mjs`.
  A live Compose server-only restart then accepted the saved proof and issued a
  fresh ticket without another pairing URL; see
  [restart evidence](../decisions/evidence/web-reconnect-server-restart.md).
  - [x] Prevent a proof already in WebCrypto signing from being released after
    a newer pairing replaces that origin's credential. Both browser vault
    implementations tag each enrollment, re-check the durable/current record
    before returning a proof, and reject the stale request; focused coverage:
    `browser reconnect vault never releases an in-flight proof after fresh
    pairing replaces it` in `apps/terminay-web/test/connection-host.test.mjs`.
  - [x] Restrict the non-extractable proof key to canonical v1 reconnect
    challenges for its exact session origin and reconnect handle. The browser
    vault rejects arbitrary, cross-origin, cross-handle, and appended signing
    payloads rather than acting as a signing oracle; focused coverage:
    `browser reconnect vault signs only the canonical exact-origin challenge`
    in `apps/terminay-web/test/connection-host.test.mjs`.
- [x] Upsert a fresh pairing against the existing exact browser origin instead
  of creating duplicate saved-server cards. The retained profile id and
  metadata stay non-secret, while reconnect enrollment continues to use the
  origin-keyed vault; covered by
  `apps/terminay-web/test/connection-host.test.mjs`.
- [x] Provide a direct-session path back to connection management without
  transferring secrets.

### Existing manager migration

- [x] Define migration/redirect from `app.terminay.com` manager metadata to
  `web.terminay.com` without attempting to copy cross-origin secrets
  (`WebConnectionHost.migrateLegacyManagerRecord`, with server-side
  `sanitizeManagerProfiles` as the canonical migration contract; covered by
  the web and server migration tests).
- [x] Preserve existing `<session>.terminay.com` origins and reconnect grants
  (focused web-host migration fixture proves the exact session URL is retained,
  origin-bound grant material remains usable at that origin, and manager
  storage never receives it).
- [x] Do not route QR fragment secrets through either manager origin
  (`consumePairingUrl` consumes the fragment in memory and the web/desktop
  connection-host tests assert it is absent from profile storage and session
  URLs).
- [x] Retain clear forget-versus-revoke semantics and saved-session recovery UX
  (distinct confirmation copy plus explicit confirmation in the shared/web
  connection models and focused connection-host tests).

### Tests

- [x] E2E one Desktop Local window plus three distinct remote windows (deterministic
  host/window integration coverage in `apps/terminay-desktop/test/connection-host.test.mjs`).
- [x] Verify selecting an already open connection focuses rather than duplicates
  unless the user requests another logical view
  (`apps/terminay-desktop/test/connection-host.test.mjs`).
- [x] Test web add/open/switch/new-tab/forget/revoke across isolated origins
  (`apps/terminay-web/test/connection-host.test.mjs`).
- [x] Test malicious postMessage source/origin/payload and sandbox escapes
  (`apps/terminay-web/test/connection-host.test.mjs`).
- [x] Verify no manager storage record contains token-like or workspace fields
  (`apps/terminay-web/test/connection-host.test.mjs`).

## Acceptance checks

- Desktop startup shows **Local**, not **Remote**.
- The same menu component/model drives Desktop and web journeys with
  host-capability differences.
- Desktop safely maintains one Local and at least three remote windows.
- Web offers no Local server but can add/manage/switch remote connections.
- The selected workspace always comes from that server's verified bundle.
- Existing saved session origins reconnect or receive a clear one-time manager
  migration path.

## Definition of done

Connections are the primary navigation model across Desktop and web; exposure
is an administrative action on a selected server, not the identity of the
current UI.
