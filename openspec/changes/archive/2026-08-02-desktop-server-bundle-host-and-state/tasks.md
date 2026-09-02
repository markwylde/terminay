## 1. Local bundle launch

- [x] 1.1 Resolve the exact manifest and immutable assets from the pinned
  embedded server artifact during normal Desktop startup, verified by asserting a
  separately packaged renderer is never the Local workspace authority
- [x] 1.2 Verify the Local bundle before launch and pass it through the
  production sandboxed server-UI window composition with the private Local byte
  endpoint, verified by window-composition tests
- [x] 1.3 Create the immutable Local profile and window binding without copying
  the bootstrap credential or server workspace data into profile/window state,
  verified by profile-content assertions
- [x] 1.4 Keep Local startup independent of network exposure, hosted services,
  and WebRTC, verified by asserting the embedded bundle load opens no TCP
  listener

## 2. Remote bundle launch

- [x] 2.1 After pairing/reconnect and WebRTC establishment, fetch the selected
  server's manifest and assets through its authenticated asset lane and
  atomically commit a content-addressed cache scoped to exact server identity,
  verified by cache commit tests
- [x] 2.2 Launch the remote bundle in a sandboxed, context-isolated, opaque
  per-profile partition with Node integration and the broad preload disabled,
  verified by partition and preload assertions
- [x] 2.3 Deliver only the remote byte endpoint and negotiated host context,
  keeping keys, reconnect grants, signaling credentials, WebRTC objects, and
  cache filesystem paths in Desktop main, verified by renderer-visible surface
  tests
- [x] 2.4 Retain the last complete verified bundle after an interrupted or
  invalid replacement and never run the embedded Local bundle against a remote
  profile, verified by interrupted-replacement tests

## 3. Native presentation

- [x] 3.1 Route settings, auxiliary routes, popouts, menus, clipboard,
  notifications, approved file selection, updates, and OS integration through the
  semantic host capabilities, verified by capability-gate tests
- [x] 3.2 Bind every native and auxiliary window to the same exact profile,
  server, verified bundle, credential partition, and optional server-owned
  logical view, verified by binding tests
- [x] 3.3 Keep native window identity separate from logical view identity so
  focus or close does not mutate or delete a view without a typed server command,
  verified by view lifecycle tests
- [x] 3.4 Use one production server-UI window owner for normal Local and remote
  connections so selecting one server never rebinds another window, verified by
  multi-window tests

## 4. State audit and migration

- [x] 4.1 Enforce the Desktop allowlist — sanitized profiles, OS-protected device
  credentials, native window geometry, exact window-to-profile/view bindings,
  verified bundle-cache metadata, updates, OS permission decisions, and explicit
  device preferences — verified by persistence inventory tests
- [x] 4.2 Remove or idempotently migrate Electron-owned workspace snapshots,
  application DTOs, project roots, panel layouts, terminal state, server
  settings, and feature capability projections without overwriting newer server
  authority, verified by migration tests
- [x] 4.3 Add a static ownership check preventing new feature-specific
  persistence or broad host APIs without an updated classification contract,
  verified by the check failing on a seeded violation

## 5. Deletion

- [x] 5.1 Delete the legacy normal Electron renderer bootstrap after Local and
  remote feature and visual parity is proven
- [x] 5.2 Delete feature-specific preload compatibility adapters, duplicate host
  stores, host-side application translators, and alternate workspace entrypoints
  once their final native/server authorities are adopted
- [x] 5.3 Keep only the Desktop connection/bootstrap/failure shell outside the
  selected server bundle, verified by static dependency checks that fail if a
  full workspace implementation re-enters it

## 6. Acceptance

- [x] 6.1 Local and remote Desktop use the same production server-UI window
  factory, differing only in byte transport, connection identity, and
  capabilities
- [x] 6.2 A remote profile always runs its remote server's verified bundle id,
  never the embedded server's renderer
- [x] 6.3 A compatible older Desktop launches a newer fixture bundle whose
  application operations Desktop does not recognize
- [x] 6.4 Restarting Desktop from only allowlisted host state recovers projects,
  panels, and terminals exclusively from the selected server
- [x] 6.5 One Local plus three remote windows remain partitioned by exact server,
  credentials, bundle cache, and logical view
- [x] 6.6 A hostile remote bundle cannot obtain Node, broad preload/IPC,
  credentials, native transports, arbitrary paths or windows, or another
  profile's partition
