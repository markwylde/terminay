## Why

Server composition had an internal operation merge seam but no public extension contract:
no manifest, no provider registry, no scoped vault broker, no child host, and no fixed
extension-management protocol. Third parties could not supply a project-environment provider
without editing the server.

## What Changes

- Publish a dependency-light `@terminay/extension-api` with types, runtime schemas,
  fixtures, a conformance CLI, and manifest/API/version/namespacing rules.
- Define fixed `extensions.*` and `project-environments.*` DTOs, policies, permissions,
  idempotency, revisions, deadlines, and ordered events.
- Define a bounded declarative UI contribution surface — forms, options, cards, progress,
  actions — with no renderer code and no raw HTML or assets.
- Supervise each extension in an isolated server child process over private framed IPC with
  bounded admission, messages, timeouts, shutdown, and crash-loop control.
- Expose only namespaced config/data/cache, scoped log and vault resolution, provider
  registration and dependency calls, cancellation, and lifecycle callbacks.
- Complete embedded and headless vault composition and unlock so both runtime modes satisfy
  the same secret-broker contract.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `extension-platform`: gains the public API, manifest validation, child host lifecycle,
  scoped brokers, and the fixed management protocol.
- `project-environments`: environment providers become extension contributions registered
  through the extension host.

## Impact

The new public extension API package and conformance CLI, server extension host and IPC
framing, manifest and entrypoint validation, the scoped vault broker in both embedded and
headless composition, protocol DTOs for extension and environment operations, and hostile
extension fixtures.
