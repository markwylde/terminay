## Why

Desktop treated **Remote** as a toggle and settings surface for exposing the
current Electron terminal sessions, and the hosted manager remembered session
origins on a journey separate from Desktop. Neither host offered the intended
"one Local plus many remembered remotes" current-server model.

## What Changes

- **BREAKING** Replace the Desktop **Remote** control with a shared
  current-server connection menu. The header now names **Local** or the
  selected server label rather than the transport, and exposure becomes an
  administrative action on the selected server rather than the identity of the
  current UI.
- Add a host-neutral connection model covering current profile and status,
  remembered profiles, add and import, open/focus/switch, manage, retry and
  disconnect, forget, revoke, and exposure, with an accessible keyboard and
  touch menu model.
- Give Desktop an immutable Local profile plus several simultaneous remote
  server windows, focusing an existing suitable window by default and exposing
  current-window rebinding explicitly.
- Deploy the browser connection host with no Local option: disconnected shell,
  connect modal, remembered/archived/offline/expired/revoked/unreachable
  states, exact-origin session launch, a strict origin- and source-checked host
  bridge, and metadata-only storage.
- Give the browser host a non-extractable origin-keyed reconnect proof key in
  IndexedDB, discarding the pairing grant and keeping `localStorage`
  metadata-only.
- Define a one-time migration of manager metadata to the stable manager origin
  without attempting to copy cross-origin secrets, preserving existing session
  origins and their reconnect grants.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `connections-and-client-hosts`: the connection menu, Desktop multi-window
  behaviour, browser host scope and storage split, and manager migration.
- `remote-access`: browser reconnect credential handling and the manager's
  exclusion from the credential path.

## Impact

Desktop header and menu composition, `@terminay/responsive-ui` connection
models (`createConnectionMenuModel`, `createConnectionRenameForm`,
`createConnectionManagementModel`), `apps/terminay-desktop` connection host,
`apps/terminay-web` connection host and browser reconnect vault, `src/web`
disconnected shell, and the server-side `sanitizeManagerProfiles` migration
contract. Public DNS, TLS, and CDN work is a release operation covered by the
web-host deployment runbook rather than project code.
