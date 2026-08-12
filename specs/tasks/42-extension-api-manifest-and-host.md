# Extension API, manifest, and host

## Goal

Publish the narrow Extension API and supervise validated extensions in
fault-isolated server child processes with scoped brokers and declarative UI.

## Delivery phase

Phase 1 foundation, in parallel with [Task 41](./41-project-environment-domain-and-local-provider.md).

## Governing specifications

- [Server extension platform](../features/extension-platform.md)
- [Project environments](../features/project-environments.md)
- [Security threat model](../decisions/security-threat-model.md)

## Current gap

Server composition has an internal operation merge seam but no public extension
contract, manifest, provider registry, scoped vault broker, child host, or fixed
extension-management protocol.

## Parallel work streams

### Public SDK and protocol

- [x] Create dependency-light `@terminay/extension-api` types, runtime schemas,
  fixtures, conformance CLI, manifest/API/version rules, and namespacing.
- [x] Define fixed `extensions.*`/`projectEnvironments.*` DTOs, policies,
  permissions, idempotency, revisions, deadlines, and ordered events.
- [x] Define bounded declarative forms/options/cards/progress/actions without
  renderer code or raw HTML/assets.

### Host and brokers

- [x] Implement one child per extension using bundled Node, private framed IPC,
  minimal environment/cwd, bounded admission/messages/timeouts, shutdown, and
  crash-loop control.
- [x] Expose only namespaced config/data/cache, scoped log/vault resolution,
  provider registration/dependency calls, cancellation, and lifecycle callbacks.
- [x] Complete embedded and headless vault composition/unlock so both runtime
  modes satisfy the same secret-broker contract.

### Compatibility and hostile fixtures

- [x] Validate manifest, entrypoint, API/engine/platform/dependencies and reject
  unknown/colliding/escaping inputs before import.
- [x] Add incompatible, malformed, oversized, late-IPC, collision, crash, and
  cross-extension secret-denial fixtures.
- [x] Prove extension failures cannot block server or This server readiness.

## Acceptance checks

- The same fixture extension defines a provider in embedded and standalone
  servers; Desktop/web receive schemas/status only.
- A child cannot register a core operation, resolve another extension's secret,
  or crash the server/another provider.
- Auth actor/permissions come from the transport and every admin mutation is
  revisioned and audited without secret values.

## Definition of done

The public API, schemas, host lifecycle, scoped brokers, and fixed protocol are
versioned and proven independently of npm installation and official providers.
