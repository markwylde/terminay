## 1. Public SDK and protocol

- [x] 1.1 Create dependency-light `@terminay/extension-api` types, runtime schemas, fixtures, conformance CLI, and manifest/API/version/namespacing rules, verified by the conformance CLI passing against the fixture extensions.
- [x] 1.2 Define fixed `extensions.*` and `project-environments.*` DTOs, policies, permissions, idempotency, revisions, deadlines, and ordered events, verified by protocol schema tests.
- [x] 1.3 Define bounded declarative forms, options, cards, progress, and actions with no renderer code or raw HTML/assets, verified by contribution schema rejection tests.

## 2. Host and brokers

- [x] 2.1 Implement one child per extension using bundled Node, private framed IPC, minimal environment and cwd, bounded admission/messages/timeouts, shutdown, and crash-loop control, verified by host lifecycle tests.
- [x] 2.2 Expose only namespaced config/data/cache, scoped log and vault resolution, provider registration and dependency calls, cancellation, and lifecycle callbacks, verified by tests proving a child cannot register a core operation or resolve another extension's secret.
- [x] 2.3 Complete embedded and headless vault composition and unlock so both runtime modes satisfy the same secret-broker contract, verified by running the same broker suite in both compositions.

## 3. Compatibility and hostile fixtures

- [x] 3.1 Validate manifest, entrypoint, API/engine/platform/dependencies and reject unknown, colliding, or escaping inputs before import, verified by pre-import rejection tests.
- [x] 3.2 Add incompatible, malformed, oversized, late-IPC, collision, crash, and cross-extension secret-denial fixtures, verified by each fixture failing closed.
- [x] 3.3 Prove extension failures cannot block server or This server readiness, verified by readiness assertions while a fixture extension crashes.

## 4. Acceptance checks

- [x] 4.1 The same fixture extension defines a provider in embedded and standalone servers while Desktop and web receive schemas and status only.
- [x] 4.2 A child cannot register a core operation, resolve another extension's secret, or crash the server or another provider.
- [x] 4.3 Auth actor and permissions come from the transport, and every admin mutation is revisioned and audited without secret values.
