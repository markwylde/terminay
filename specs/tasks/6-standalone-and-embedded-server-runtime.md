# Standalone and embedded server runtime

## Goal

Ship one Terminay Server runtime that can start headlessly or as a
Desktop-supervised Local child, serve its matching workspace bundle, and expose
the shared application protocol over an authenticated local transport.

## Governing specifications

- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)
- [Terminal workspace](../features/terminal-workspace.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)

## Why this is active

Electron main is currently the process authority and service container. The PTY
host is a child process, but server lifecycle, paths, settings, trust, and
renderers still depend on Electron APIs.

## Dependencies

- [Workspace and protocol foundation](../tasks_completed/4-workspace-and-protocol-foundation.md)
- [Server-owned workspace model](./5-server-owned-workspace-model.md)

## Work slices

### Runtime composition

- [x] Create a server entry with explicit configuration for data root, runtime
  mode, log sink, UI bundle, local endpoint, and shutdown policy.
- [ ] Replace `app.getPath(...)` dependencies with injected platform paths.
- [ ] Move service construction out of Electron main into server composition.
- [x] Add readiness, version, health, and structured diagnostics that redact
  workspace and secret data.
- [x] Handle signals and graceful shutdown with bounded timeouts.

### Embedded supervision

- [ ] Start exactly one Local server from Desktop with a private bootstrap
  channel and random short-lived local credential.
- [ ] Select a collision-safe loopback/OS-local endpoint.
- [x] Prevent another process from reusing the data root concurrently with an
  atomic mode-0600 `FileDataRootLease`; stale locks are never silently stolen.
- [x] Report readiness and stable server identity before opening the workspace.
- [x] Detect crash versus deliberate shutdown and provide retry/recovery without
  starting two authorities.
- [ ] Keep the server alive through renderer/window reload and close according
  to the selected Desktop lifecycle policy.

### Standalone CLI

- [x] Implement clear `start`, `status/version`, and pairing/exposure entry
  points without requiring a display.
- [x] Print readiness, data/log paths, and pairing instructions without leaking
  secrets into unrelated diagnostics.
- [x] Support configuration through documented flags/environment/config with
  deterministic precedence and validation.
- [x] Provide foreground operation first and example service-manager units
  without making daemonization part of application correctness.

### Local protocol and UI bundle

- [x] Serve the exact bundled responsive workspace manifest/assets from an
  authenticated local origin.
- [x] Implement the shared protocol handshake on the selected local transport.
- [x] Expose bounded authenticated query/command envelopes for registered
  server-core operations on the local HTTP transport, binding each request to
  a completed client handshake and its current authorization scope; command
  idempotency is retained per authenticated client.
- [ ] Complete parity for every shared query/command operation, binary bodies,
  cancellation transport, and remote/local conformance on this HTTP boundary.
- [x] Establish a client handshake with server identity, negotiated
  capabilities, bounded limits, and bootstrap authorization before workspace
  access.
- [x] Add bounded output/event replay and subscriptions with snapshot resync
  across a local UI transport restart.
- [x] Ensure endpoint/token URLs are not retained in normal browser history,
  logs, or connection metadata; credentials are header-only and responses use
  `Referrer-Policy: no-referrer`.

### Packaging

- [ ] Build reproducible standalone artifacts for the agreed initial platforms.
- [ ] Bundle the same server runtime and UI artifact inside Desktop without
  maintaining an Electron-only server fork.
- [ ] Verify `node-pty`, provider CLIs, hook scripts, MCP entry, and unpacked
  assets resolve in development, packaged Desktop, and standalone layouts.
- [x] Add deterministic standalone artifact version/manifest checks with
  payload hashes, pinned Node metadata, required entrypoints, provenance
  pointers, and Electron-import rejection; signing and native certification
  remain separate release gates.

## Acceptance checks

- One server test suite runs against both headless and Embedded launch modes.
- Desktop can restart a crashed Local server without corrupting state or
  duplicating it.
- Closing every renderer leaves the server and PTYs alive while the selected
  Desktop lifecycle remains active.
- `./terminay-server`-style foreground startup works on a clean supported Linux
  host.
- A browser loads the server's exact local bundled UI and completes the shared
  protocol handshake.
- No Electron import exists in the standalone server dependency graph.

## Definition of done

Terminay Server is a real independently startable product runtime, and Desktop
uses that same runtime for Local rather than hosting a second implementation in
Electron main.
