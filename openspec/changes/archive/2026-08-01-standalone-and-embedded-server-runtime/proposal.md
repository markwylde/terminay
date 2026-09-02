## Why

Electron main was the process authority and service container. The PTY host was
already a child process, but server lifecycle, paths, settings, trust, and
renderer wiring still depended on Electron APIs, so Terminay Server could not
start headlessly and Desktop effectively hosted a second implementation.

## What Changes

- Ship one server runtime that starts either standalone and headless or as a
  Desktop-supervised Local child, from the same composition code.
- **BREAKING** Replace `app.getPath(...)` dependencies with injected, validated
  `ServerPlatformPaths`, and move service construction out of Electron main.
- Add readiness, version, health, and structured diagnostics that redact
  workspace, path, and secret data, plus signal handling and bounded graceful
  shutdown.
- Supervise exactly one Local server from Desktop with a private bootstrap
  channel, a random short-lived credential, an atomic mode-0600 data-root
  lease, and crash-versus-shutdown detection.
- Add a standalone CLI with `start`, `status`/`version`, pairing and exposure
  entry points, documented flag/environment/config precedence, foreground
  operation, and a one-container Compose example.
- Serve the exact bundled responsive workspace manifest and assets from an
  authenticated local origin, and carry the shared protocol handshake,
  query/command envelopes, bounded binary bodies, deadlines, and cancellation
  over that local HTTP transport with framed-transport parity.
- Compose optional server-owned authorities (settings, macros, recordings, Git,
  AI, file catalog and sessions, activity) and advertise a capability only when
  its concrete authority is supplied.
- Add a reproducible standalone artifact pipeline with deterministic manifests,
  pinned Node metadata, release-integrity verification, Electron-import
  rejection, and native Linux x64/arm64 CI evidence.

## Capabilities

### New Capabilities
- _None._

### Modified Capabilities
- `server-runtime-and-protocol`: one runtime in two deployment modes, embedded
  supervision and bootstrap credential, standalone operation and diagnostics,
  the authenticated local UI transport, capability advertisement, and release
  packaging validation.

## Impact

`apps/terminay-server` (runtime composition, bootstrap, local UI server, health
server, CLI, release integrity, Docker contract), `apps/terminay-desktop`
(Local supervisor, embedded runtime adapter, packaged-artifact proofs),
`packages/server-core` (shared composition, protocol registry, cancellation
transport), `packages/client-core`, the standalone artifact and CI scripts, and
the packaging manifests.
