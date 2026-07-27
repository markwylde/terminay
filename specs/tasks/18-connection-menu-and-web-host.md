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

- [ ] Implement current profile/status, remembered profiles, add/import,
  open/focus/switch, manage, retry/disconnect, forget, revoke, and exposure
  actions through a host-neutral connection model.
- [ ] Label the header with **Local** or the selected server label rather than
  transport.
- [ ] Keep activity/notification count separate from connection state.
- [ ] Distinguish offline, relay, WebRTC route, expired, revoked, identity
  mismatch, and incompatible failures.
- [ ] Add accessible keyboard/touch menu, rename form, confirmation language,
  and responsive management cards.

### Desktop behaviour

- [ ] Show immutable Local plus remembered remote profiles.
- [ ] Focus an existing suitable window or open a new connection window by
  default; expose current-window rebinding explicitly.
- [ ] Support one Local plus several simultaneous remote server windows without
  credential/state leakage.
- [ ] Show **Expose this server…** only when the current connection has the
  administrative capability.
- [ ] Integrate deep links/pasted pairing URLs without leaving unconsumed
  fragments in logs/history/profile storage.

### Web host

- [ ] Deploy the stable connection shell/manager at `web.terminay.com`.
- [ ] Provide disconnected/empty, remembered, archived, offline, expired,
  revoked, and unreachable states.
- [ ] Open the selected server's bundled UI in the chosen safe
  navigation/embedding model and support an explicit new-browser-tab action.
- [ ] Implement the strict origin/source-checked host bridge from the foundation
  decision.
- [ ] Store non-secret metadata only and leave keys/grants on exact session
  origins.
- [ ] Provide a direct-session path back to connection management without
  transferring secrets.

### Existing manager migration

- [ ] Define migration/redirect from `app.terminay.com` manager metadata to
  `web.terminay.com` without attempting to copy cross-origin secrets.
- [ ] Preserve existing `<session>.terminay.com` origins and reconnect grants.
- [ ] Do not route QR fragment secrets through either manager origin.
- [ ] Retain clear forget-versus-revoke semantics and saved-session recovery UX.

### Tests

- [ ] E2E one Desktop Local window plus three distinct remote windows.
- [ ] Verify selecting an already open connection focuses rather than duplicates
  unless the user requests another logical view.
- [ ] Test web add/open/switch/new-tab/forget/revoke across isolated origins.
- [ ] Test malicious postMessage source/origin/payload and sandbox escapes.
- [ ] Verify no manager storage record contains token-like or workspace fields.

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
