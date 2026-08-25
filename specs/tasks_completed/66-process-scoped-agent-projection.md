# Process-scoped Agents projection

## Goal

Keep the Agents pane bound to this running Terminay process. A `codex resume`
launched through a `node` wrapper must still bind. A second live process that
shares `~/.codex` or restored project/session labels must not populate this
pane. Two live processes must not share one user-data root.

## Governing specifications

- [Agent status and Agents sidebar](../features/agent-status-and-sidebar.md)

## Work shipped

- [x] Discovery starts on every non-shell foreground, including `node`/`bun`
  wrappers; bind still requires process-tree plus writable journal proof.
- [x] Each `AgentStatusService` mints an ephemeral `processInstanceId` at
  construction and stamps every snapshot.
- [x] Protocol snapshots carry `processInstanceId`. Clients pin the first id
  and ignore later snapshots from a different live process until `reset`.
- [x] Renderer subscriptions drop mismatched `processInstanceId` values.
- [x] Topology polling rebinds when descendant/open-file identity changes; a
  writer that leaves this PTY tree cancels the observer.
- [x] Exclusive `.terminay-process.lock` plus Electron single-instance lock
  fail closed when a second process targets the same user-data root.
- [x] Wrapper discovery retries the same provider. Rotating Codex → OMP on a
  `node` foreground abandoned the journal that was about to appear.
- [x] Admission diagnostics include a bounded host `reason` so a throw is not
  an opaque `failed` class.

## Verification

- `npm run test --workspace @terminay/server-core -- test/agent-service.test.mjs test/extension-agent-runtime.test.mjs test/agent-protocol.test.mjs`
- `npm run test --workspace @terminay/client-core -- test/agent-status.test.mjs`
- `node --test scripts/task9-renderer-agent-client.test.mjs scripts/user-data-process-lock.test.mjs`
- Docker Electron: `e2e/agent-status-sidebar.spec.ts` dual-profile case
