## 1. Shared connection model and menu

- [x] 1.1 Implement current profile/status, remembered profiles, add/import, open/focus/switch, manage, retry/disconnect, forget, revoke, and exposure actions through a host-neutral connection model, verified by the shared connection-model tests
- [x] 1.2 Label the header with **Local** or the selected server label rather than transport, verified by `scripts/connection-menu-renderer.test.mjs` and by the hand-off carrying only a validated display label beside a fixed server id
- [x] 1.3 Keep activity/notification count separate from connection state, verified by the connection menu model tests
- [x] 1.4 Distinguish offline, relay, WebRTC route, expired, revoked, identity mismatch, and incompatible failures, verified by the connection diagnostics tests
- [x] 1.5 Add a host-neutral accessible keyboard/touch menu model with stable ordering, focus wrapping, and explicit activation, verified by `packages/responsive-ui/test/ui.test.mjs`
- [x] 1.6 Add the rename form, confirmation language, and responsive management cards, verified by `createConnectionRenameForm` and `createConnectionManagementModel` coverage in `packages/responsive-ui/test/ui.test.mjs`

## 2. Desktop behaviour

- [x] 2.1 Show immutable Local plus remembered remote profiles, verified by `apps/terminay-desktop/test/connection-host.test.mjs`
- [x] 2.2 Focus an existing suitable window or open a new connection window by default and expose current-window rebinding explicitly, verified by `apps/terminay-desktop/test/connection-host.test.mjs`
- [x] 2.3 Support one Local plus several simultaneous remote server windows without credential or state leakage, verified by the deterministic host/window integration coverage
- [x] 2.4 Show **Expose this server…** only when the current connection has the administrative capability, verified by the `serverExposure` capability gate in `packages/responsive-ui/test/ui.test.mjs`
- [x] 2.5 Integrate deep links and pasted pairing URLs without leaving unconsumed fragments in logs, history, or profile storage, verified by the connection-host pairing tests

## 3. Web host

- [x] 3.1 Keep a deterministic local release-readiness contract for the web host covering package exports, built artifacts, stable manager origin, and absence of a Local profile, verified by `scripts/task18-web-host-readiness.mjs`; this does not claim public deployment, DNS, TLS, or CDN verification
- [x] 3.2 Prove the local static web image can proxy an authenticated compose server connection and survive a server-only restart without restarting the web container, verified by `scripts/docker-compose-web-server-smoke.mjs` and its recorded evidence
- [x] 3.3 Provide disconnected/empty, remembered, archived, offline, expired, revoked, and unreachable states, verified by the web connection-host tests
- [x] 3.4 Replace the temporary standalone browser Connections page with a Terminay-like disconnected host shell and connect modal, verified by `scripts/web-disconnected-shell.test.mjs`
- [x] 3.5 Open the selected server's bundled UI in the chosen safe navigation/embedding model and support an explicit new-browser-tab action, verified by `WebConnectionHost.open`/`sessionUrl` coverage in `apps/terminay-web/test/connection-host.test.mjs`
- [x] 3.6 Implement the strict origin- and source-checked host bridge from the foundation decision, verified by the host-bridge tests
- [x] 3.7 Store non-secret metadata only and leave keys and grants on exact session origins, verified by the origin-keyed IndexedDB proof key, discarded pairing grant, and metadata-only `localStorage` coverage in `apps/terminay-web/test/connection-host.test.mjs` plus the live restart evidence
- [x] 3.8 Prevent a proof already in WebCrypto signing from being released after a newer pairing replaces that origin's credential, verified by the focused stale-proof rejection test
- [x] 3.9 Restrict the non-extractable proof key to canonical v1 reconnect challenges for its exact session origin and reconnect handle, verified by the focused signing-oracle rejection test
- [x] 3.10 Upsert a fresh pairing against the existing exact browser origin instead of creating duplicate saved-server cards, verified by `apps/terminay-web/test/connection-host.test.mjs`
- [x] 3.11 Provide a direct-session path back to connection management without transferring secrets, verified by the web connection-host tests

## 4. Existing manager migration

- [x] 4.1 Define migration and redirect from the legacy manager metadata to the stable manager origin without attempting to copy cross-origin secrets, verified by `WebConnectionHost.migrateLegacyManagerRecord` and server-side `sanitizeManagerProfiles` coverage
- [x] 4.2 Preserve existing session origins and reconnect grants, verified by the migration fixture proving the exact session URL is retained, grant material stays usable at that origin, and manager storage never receives it
- [x] 4.3 Do not route QR fragment secrets through either manager origin, verified by `consumePairingUrl` consuming the fragment in memory and by assertions that it is absent from profile storage and session URLs
- [x] 4.4 Retain clear forget-versus-revoke semantics and saved-session recovery UX, verified by the distinct confirmation copy and explicit confirmation in the shared and web connection models

## 5. Tests

- [x] 5.1 Cover one Desktop Local window plus three distinct remote windows, verified by `apps/terminay-desktop/test/connection-host.test.mjs`
- [x] 5.2 Verify selecting an already open connection focuses rather than duplicates unless another logical view is requested, verified by `apps/terminay-desktop/test/connection-host.test.mjs`
- [x] 5.3 Test web add/open/switch/new-tab/forget/revoke across isolated origins, verified by `apps/terminay-web/test/connection-host.test.mjs`
- [x] 5.4 Test malicious postMessage source, origin, and payload plus sandbox escapes, verified by `apps/terminay-web/test/connection-host.test.mjs`
- [x] 5.5 Verify no manager storage record contains token-like or workspace fields, verified by `apps/terminay-web/test/connection-host.test.mjs`
