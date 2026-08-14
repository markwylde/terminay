# Desktop server-bundle host and state extraction

## Goal

Make every Local and remote Desktop connection window run the selected
server's exact verified UI bundle, and reduce Electron-owned persistence to the
documented connection, native-presentation, credential, cache, and OS allowlist.

## Governing specifications

- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)
- [Connections and client hosts](../features/connections-and-client-hosts.md)
- [Settings, shortcuts, and Desktop integration](../features/settings-shortcuts-and-desktop-integration.md)
- [Server-bundled clients and protocol-blind hosts](../decisions/server-bundled-client-hosts.md)

## Dependencies

- [Task 27: Server bundle and host contracts](../tasks_completed/27-server-bundle-host-contracts.md)
- [Task 16: Shared responsive server UI](./16-shared-responsive-server-ui.md)
- [Task 19: Migration and compatibility cleanup](./19-migration-and-compatibility-cleanup.md)
- [Task 23: Embedded Desktop WebRTC exposure](../tasks_completed/23-embedded-desktop-remote-exposure.md)
  for production remote WebRTC evidence
- [Task 41: Single-owner WebRTC transport generations](../tasks_completed/41-single-owner-webrtc-transport-generations.md)
  for the opaque replaceable WebRTC endpoint contract

## Current gap

Normal Electron startup still loads its packaged legacy renderer directly.
Remote Desktop forwards framed traffic into that renderer instead of installing
and launching the selected remote server's bundle. Desktop also retains broad
preload/settings and renderer persistence surfaces that have not been audited
against the server/host state classification.

## Implementation slices

### Local bundle launch

- [x] Resolve the exact manifest and immutable assets from the pinned embedded
  server artifact during normal Desktop startup; do not treat a separately
  packaged renderer as the Local workspace authority.
- [x] Verify the Local bundle before launch and pass it through the production
  sandboxed server-UI window composition with the private Local byte endpoint.
- [x] Create the immutable Local profile and window binding without copying the
  bootstrap credential or server workspace data into profile/window state.
- [x] Keep Local startup independent of network exposure, hosted services, and
  WebRTC. Loading the embedded bundle must not open a TCP listener.

### Remote bundle launch

- [x] After pairing/reconnect and WebRTC establishment, fetch the selected
  server's manifest/assets through its authenticated asset lane and atomically
  commit a content-addressed cache scoped to exact server identity.
- [x] Launch the remote bundle in a sandboxed, context-isolated, opaque
  per-profile partition with Node integration and the broad preload disabled.
- [x] Deliver only the Task 41 remote byte endpoint and negotiated host context;
  keep keys, reconnect grants, signaling credentials, WebRTC objects, and cache
  filesystem paths in Desktop main.
- [x] Retain the last complete verified bundle after interrupted/invalid
  replacement. Never run the embedded Local bundle against a remote profile.

### Native presentation

- [x] Route settings, auxiliary routes, popouts, menus, clipboard,
  notifications, approved file selection, updates, and OS integration through
  the semantic capabilities from Task 27.
- [x] Bind every native/auxiliary window to the same exact profile, server,
  verified bundle, credential partition, and optional server-owned logical
  view.
- [x] Keep native window identity separate from logical view identity. Window
  focus/close does not mutate or delete a view without a separate typed server
  command.
- [x] Use one production server-UI window owner for normal Local and remote
  connections; selecting one server never rebinds another window implicitly.

### State audit and migration

- [x] Enforce the Desktop allowlist: sanitized profiles, OS-protected device
  credentials, native window geometry, exact window-to-profile/view bindings,
  verified bundle-cache metadata, updates, OS permission decisions, and
  explicit device preferences.
- [x] Remove or idempotently migrate Electron-owned workspace snapshots,
  application DTOs, project roots, panel layouts, terminal state, server
  settings, and feature capability projections without overwriting newer server
  authority.
- [x] Add a static ownership check preventing new feature-specific persistence
  or broad host APIs without an updated classification contract.

### Deletion

- [x] Delete the legacy normal Electron renderer bootstrap after server-bundle
  Local/remote feature and visual parity is proven.
- [x] Delete feature-specific preload compatibility adapters, duplicate host
  stores, host-side application translators, and alternate workspace entrypoints
  once their final native/server authorities are adopted.
- [x] Keep only the Desktop connection/bootstrap/failure shell outside the
  selected server bundle; fail static dependency checks if a full workspace
  implementation re-enters it.

## Acceptance checks

- Local and remote Desktop use the same production server-UI window factory;
  only byte transport, connection identity, and capabilities differ.
- A remote profile always runs its remote server's verified bundle id, never
  the embedded server's renderer.
- A compatible older Desktop launches a newer fixture bundle whose application
  operations Desktop does not recognize.
- Restarting Desktop from only allowlisted host state recovers projects, panels,
  and terminals exclusively from the selected server.
- One Local plus three remote windows remain partitioned by exact server,
  credentials, bundle cache, and logical view.
- A hostile remote bundle cannot obtain Node, broad preload/IPC, credentials,
  native transports, arbitrary paths/windows, or another profile partition.

## Definition of done

Normal Desktop startup is a small protocol-blind host around the selected
server's exact bundle. Electron owns only the documented allowlist, both Local
and remote use the stable Task 27 contracts, and legacy renderer/state/
feature-adapter paths are deleted.
