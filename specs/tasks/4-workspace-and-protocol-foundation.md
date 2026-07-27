# Workspace and protocol foundation

## Goal

Create the independently buildable application/package boundaries and the
versioned, runtime-validated client/server protocol used by every later slice,
without changing user-facing behaviour.

## Governing specifications

- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)
- [Connections and client hosts](../features/connections-and-client-hosts.md)

## Why this is active

The repository is one Electron/Vite package, renderer APIs are Electron
preload calls, and the remote protocol is terminal-specific. Server extraction
needs enforceable dependency direction and one transport-neutral contract
before service ownership can move safely.

## Dependencies

- [Server architecture decision spikes](./3-server-architecture-decision-spikes.md)

## Work slices

### Workspace shape

- [ ] Convert the repository into one workspace with independently buildable
  `terminay-desktop`, `terminay-server`, and `terminay-web` applications.
- [ ] Add shared protocol, client-core, responsive UI, and server-core
  packages with explicit public entry points.
- [ ] Keep all shared source in this workspace while the three applications
  remain independently packageable and deployable.
- [ ] Preserve existing Desktop builds, packaging, and tests during the move.

### Dependency boundaries

- [ ] Prevent server-core from importing Electron.
- [ ] Prevent protocol, client-core, and responsive UI from importing Node,
  Electron, WebRTC, WebSocket, or a concrete local transport.
- [ ] Prevent Desktop host code from becoming a second copy of application
  services.
- [ ] Add boundary checks to normal CI.

### Protocol

- [ ] Define handshake, capability, command, response, event, stream,
  binary-transfer, cancellation, and structured-error envelopes.
- [ ] Add runtime validators, deterministic encoding, version negotiation, and
  resource limits.
- [ ] Define expected revisions, idempotent command ids, deadlines,
  backpressure, and reconnect/resync semantics.
- [ ] Keep Electron window ids, browser ids, titles, and transport-specific
  authorization out of the contract.

### Client and transports

- [ ] Define the `TerminayClient` queries, commands, subscriptions, connection
  state, and error surface.
- [ ] Define the framed transport lifecycle and backpressure interface.
- [ ] Implement in-memory and compatibility Electron-IPC adapters.
- [ ] Add a conformance harness reusable by Local and WebRTC transports.

### Tooling and versions

- [ ] Define supported Node, Electron, browser, and platform versions.
- [ ] Produce deterministic protocol/client artifacts for server and UI builds.
- [ ] Add compatibility fixtures for one prior protocol version and explicit
  incompatible-version errors.

## Acceptance checks

- Existing Desktop smoke and focused feature tests remain green.
- Package-boundary tests reject representative forbidden imports.
- One protocol conformance suite passes over in-memory and framed compatibility
  transports.
- Duplicate, stale, malformed, cancelled, oversized, slow-consumer, and
  incompatible cases have deterministic test outcomes.
- Each application builds independently from the workspace.

## Definition of done

The workspace has enforceable deployable/shared boundaries and one tested
application protocol. Later tasks can move one service at a time without
creating another renderer API or transport-specific product contract.
