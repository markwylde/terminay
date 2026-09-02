## Context

See proposal.md. This change completed the server-bundled client model for
Desktop: the bundle and host contracts already existed, and remote WebRTC
exposure and the opaque replaceable WebRTC endpoint contract were already
delivered, so what remained was to make Local startup use the same production
window factory as remote and to reduce Electron-owned persistence to a
documented allowlist.

## Goals / Non-Goals

Goals: one production server-UI window owner for normal Local and remote
connections, with only byte transport, connection identity, and capabilities
differing; and a Desktop that owns nothing beyond the documented connection,
native-presentation, credential, cache, and OS allowlist.

Non-Goals: changing the bundle manifest or host capability contracts, which were
already stable, and changing server-side workspace behaviour.

## Decisions

- **The embedded server artifact is the Local workspace authority.** A
  separately packaged renderer is not; Local resolves the exact manifest and
  immutable assets from the pinned artifact and verifies before launch. Local
  startup must not open a TCP listener, so loading the bundle stays independent
  of exposure and hosted services.
- **The remote bundle cache is content-addressed and scoped to exact server
  identity**, committed atomically. An interrupted or invalid replacement leaves
  the last complete verified bundle in place, and the embedded Local bundle is
  never run against a remote profile.
- **The bundle receives an opaque byte endpoint and a negotiated host context,
  nothing else.** This is the security boundary: keys, reconnect grants,
  signaling credentials, WebRTC objects, and cache filesystem paths never cross
  into the renderer. The remote bundle runs sandboxed and context-isolated in an
  opaque per-profile partition with Node integration and the broad preload
  disabled.
- **Native window identity stays separate from logical view identity.** Window
  focus or close does not mutate or delete a server-owned view without a
  separate typed server command, and selecting one server never implicitly
  rebinds another window.
- **A static ownership check guards the allowlist**, so new feature-specific
  persistence or broad host APIs cannot be added without updating the
  classification contract, and the dependency check fails if a full workspace
  implementation re-enters the host shell.
- **Legacy paths are deleted, not disabled**, and only after Local and remote
  feature and visual parity was proven.

## Risks / Trade-offs

Deleting the packaged renderer removes the fallback that would have hidden a
bundle verification or transfer failure, so failure reporting had to live in the
small Desktop connection/bootstrap/failure shell that remains outside the
bundle. Migration of previously Electron-owned workspace state must be
idempotent and must never overwrite newer server authority.

## Migration Plan

Electron-owned workspace snapshots, application DTOs, project roots, panel
layouts, terminal state, server settings, and feature capability projections are
removed or idempotently migrated, never overwriting newer server authority.
