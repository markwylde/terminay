## 1. Discovery and binding

- [x] 1.1 Start discovery on every non-shell foreground, including `node` and `bun` wrappers, while binding still requires process-tree plus writable-journal proof, verified by wrapper-foreground discovery tests.
- [x] 1.2 Retry the same provider for wrapper discovery so rotating Codex to omp on a `node` foreground no longer abandons the journal that was about to appear, verified by a provider-retry test.
- [x] 1.3 Rebind on descendant or open-file identity change and cancel the observer when a writer leaves this PTY tree, verified by topology-polling tests.
- [x] 1.4 Include a bounded host `reason` in admission diagnostics so a throw is not an opaque `failed` class, verified by admission diagnostic assertions.

## 2. Process-scoped projection

- [x] 2.1 Mint an ephemeral `processInstanceId` per `AgentStatusService` at construction and stamp every snapshot, verified by snapshot assertions in `test/agent-service.test.mjs`.
- [x] 2.2 Carry `processInstanceId` in protocol snapshots and pin the first id on the client, ignoring later snapshots from a different live process until `reset`, verified by `test/agent-protocol.test.mjs` and `test/agent-status.test.mjs`.
- [x] 2.3 Drop mismatched `processInstanceId` values in renderer subscriptions, verified by `scripts/task9-renderer-agent-client.test.mjs`.

## 3. User-data root exclusivity

- [x] 3.1 Add an exclusive `.terminay-process.lock` alongside the Electron single-instance lock so a second process targeting the same user-data root fails closed, verified by `scripts/user-data-process-lock.test.mjs`.

## 4. Verification

- [x] 4.1 Run `npm run test --workspace @terminay/server-core -- test/agent-service.test.mjs test/extension-agent-runtime.test.mjs test/agent-protocol.test.mjs`.
- [x] 4.2 Run `npm run test --workspace @terminay/client-core -- test/agent-status.test.mjs`.
- [x] 4.3 Run `node --test scripts/task9-renderer-agent-client.test.mjs scripts/user-data-process-lock.test.mjs`.
- [x] 4.4 Run the Docker Electron dual-profile case in `e2e/agent-status-sidebar.spec.ts`.
