## Why

A user can only get agent awareness for the providers Terminay happens to have
hard-coded, and a third party cannot add one: Codex, Claude Code, Cursor Agent,
and omp detection, journal binding, and record parsing live inside Server Core,
and SSH and Puzed have a private production composition of their own. That makes
every new provider a core change, keeps provider file formats inside the trusted
core, and leaves no public contract a third-party author could build against.

## What Changes

- Add an additive Extension API v1 agent surface: an `agentProviders`
  contribution, the `agent-observation` permission, `context.agents.registerProvider`,
  an environment-routed observation broker, a lifecycle publisher, bounded model
  and diagnostic metadata, and a driver toolkit with an in-memory test harness.
- Move SSH, Puzed, Codex, Claude Code, Cursor Agent, and omp into `extensions/*`
  as independently publishable npm packages that import only
  `@terminay/extension-api`, keeping their npm names and immutable extension and
  provider ids.
- Bundle packed, verified artifacts for every built-in into each Electron and
  standalone server distribution, materialize them offline on first run, enable
  them by default, and keep the bundled slot as an immutable rollback floor
  beneath any compatible npm override.
- Compose agent providers with the exact project environment and terminal
  incarnation, and route non-local observation through environment capabilities
  with no local PID, cwd, home, or path substitution.
- **BREAKING** Remove Server Core's closed provider union, hard-coded agent
  drivers and journal sources, the legacy PTY agent bridge, and the private
  SSH/Puzed production composition once packed-extension parity is proven.
- Give every implicit embedded or standalone server a durable data-root-scoped
  authority identity, and fence agent publication, acknowledgement, replay, and
  observation to the exact server, project, terminal, and incarnation.
- Add release, architecture, and boundary gates: deterministic artifact
  inventories, byte-identical Electron and standalone inventories, packaged
  runtime lifecycle verification on the supported architecture matrix, and
  import-graph rules in both directions.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `extension-platform`: agent provider registration and terminal-incarnation
  admission, exact-once observer retirement, target-owned vault references for
  dependency calls, terminal-scoped directory operations, the public observation
  toolkit, and the third-party author example and harness.
- `agent-status-and-sidebar`: authority isolation between concurrent servers,
  immutable scope fencing, and bounded lifecycle publication flow control.
- `built-in-extensions`: packaged runtime activation, supported-architecture
  release verification, and development staging and admission.
- `server-runtime-and-protocol`: data-root-scoped server authority identity.

## Impact

- `packages/extension-api` (public SDK, runtime validators, conformance CLI,
  generated declarations, documentation).
- `packages/server-core` (extension host protocol, agent runtime, provider
  registry, canonical projection, provider vault, built-in installer).
- `extensions/ssh`, `extensions/puzed`, `extensions/agent-codex`,
  `extensions/agent-claude-code`, `extensions/agent-cursor`,
  `extensions/agent-omp`, plus a third-party fixture package.
- Electron and standalone release staging, inventory verification, and the
  packaged and Docker-isolated end-to-end suites.
- The repository npm workspace graph, root lockfile, and boundary tooling.
