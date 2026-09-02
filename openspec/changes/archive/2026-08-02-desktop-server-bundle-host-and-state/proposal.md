## Why

Normal Electron startup still loaded its packaged legacy renderer directly, and
remote Desktop forwarded framed traffic into that renderer instead of installing
and launching the selected remote server's bundle. Desktop also retained broad
preload, settings, and renderer persistence surfaces that had never been audited
against the server/host state classification.

## What Changes

- Make normal Desktop startup resolve, verify, and launch the pinned embedded
  server artifact's bundle through the production sandboxed server-UI window
  composition over the private Local byte endpoint, with no TCP listener and no
  dependency on network exposure, hosted services, or WebRTC.
- After pairing/reconnect and WebRTC establishment, fetch a remote server's
  manifest and assets through its authenticated asset lane and atomically commit
  a content-addressed cache scoped to exact server identity. Launch that bundle
  in a sandboxed, context-isolated, opaque per-profile partition with Node
  integration and the broad preload disabled.
- Deliver only the remote byte endpoint and negotiated host context to the
  bundle; keys, reconnect grants, signaling credentials, WebRTC objects, and
  cache filesystem paths stay in Desktop main.
- Route settings, auxiliary routes, popouts, menus, clipboard, notifications,
  approved file selection, updates, and OS integration through the semantic host
  capabilities, binding every native and auxiliary window to the same exact
  profile, server, verified bundle, credential partition, and optional
  server-owned logical view.
- **BREAKING** Enforce the Desktop persistence allowlist and delete the legacy
  normal Electron renderer bootstrap, feature-specific preload compatibility
  adapters, duplicate host stores, host-side application translators, and
  alternate workspace entrypoints.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `connections-and-client-hosts`: Desktop launches the selected server's bundle,
  the verified bundle cache, remote code containment, native window server
  binding, and the Desktop persistence allowlist.
- `server-owned-workspace-state`: the Desktop persistence allowlist and
  client-host native-only operations.

## Impact

Electron main window composition and bootstrap, the preload surface, the Desktop
bundle cache, Desktop-owned stores and settings, and the static dependency
checks that keep a workspace implementation out of the host shell.
