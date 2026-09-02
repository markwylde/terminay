## 1. Terminal activity

- [x] 1.1 Keep structured signal parsing beside the server PTY stream and verify
  output bytes reach the client unmodified
- [x] 1.2 Move fallback interpretation, timeouts, foreground-process signals, and
  acknowledgement authority into `server-core`, verified by
  `packages/server-core/test/terminal-service.test.mjs`,
  `node-pty-adapter.test.mjs`, `scripts/task9-embedded-agent-authority.test.mjs`,
  `scripts/task9-terminal-authority-renderer-authorization.test.mjs`,
  `scripts/task9-renderer-handoff.test.mjs`, and
  `scripts/task9-graceful-shutdown.test.mjs` (27 passing)
- [x] 1.3 Forward deduplicated foreground process changes from the `node-pty`
  adapter into `AgentStatusService.foregroundProcessChanged`, verified by
  `node-pty-adapter.test.mjs`, `terminal-service.test.mjs`, and
  `agent-terminal-integration.test.mjs`
- [x] 1.4 Migrate the embedded terminal path off the Electron PTY-host authority
  so terminal creation has no PTY-host fallback, verified by
  `scripts/task9-embedded-agent-authority.test.mjs`,
  `scripts/server-terminal-authority-host-bookkeeping.test.mjs`, and
  `packages/server-core/test/terminal-service.test.mjs`
- [x] 1.5 Retire the Electron PTY-host runtime and its fork/supervisor tests, and
  verify the desktop build no longer emits `ptyHost.js` through
  `npm run test:server-terminal-runtime` and `scripts/task6-runtime-layout.test.mjs`
- [x] 1.6 Authorize embedded terminal reads and mutations against the attached
  renderer, verified by
  `scripts/task9-terminal-authority-renderer-authorization.test.mjs`
- [x] 1.7 Transfer a terminal renderer subscription during popout and merge by
  subscribing the destination before detaching the source, verified by
  `scripts/task9-renderer-handoff.test.mjs` and
  `scripts/server-terminal-authority-host-bookkeeping.test.mjs`
- [x] 1.8 Await and coalesce server-terminal authority shutdown on Desktop quit,
  verified by `scripts/task9-graceful-shutdown.test.mjs`
- [x] 1.9 Publish ordered project/session activity snapshots and events and verify
  scoped focus, viewed, and recent-input facts are accepted without making one
  client canonical

## 2. Agent runtime

- [x] 2.1 Compose the loopback hook receiver, authentication, environment
  injection, drivers, trust, reducer, and acknowledgement into `server-core`
- [x] 2.2 Compose the reduced agent authority into the standalone server
  transport and start its hook receiver before the default terminal is created,
  verified by the `agent-protocol`, `agent-service`, terminal lifecycle,
  standalone runtime, and composition suites
- [x] 2.3 Verify `standalone-http-transport.test.mjs` proves the foreground CLI to
  inherited PTY hook to authenticated HTTP client path without revealing the
  hook token
- [x] 2.4 Make the server-owned `agentIntegration.enabled` policy authoritative
  for injection, lease revocation, snapshot clearing, and stale hook rejection,
  verified by `agent-service.test.mjs`
- [x] 2.5 Resolve hooks only by exact immutable server terminal session and
  verify stale, reordered, cross-server, exited-session, malformed, and
  oversized hook events are rejected
- [x] 2.6 Verify provider-hook authority is preserved over raw and structured
  fallback signals
- [x] 2.7 Reconcile managed Codex and Claude Code hooks in embedded and
  standalone layouts, verified by `test:agent-host-reconciliation` installing and
  removing hooks while preserving user hooks and persisting no credentials
- [x] 2.8 Delegate Desktop preload compatibility IPC to
  `ServerTerminalAuthority.agentStatusIpcAdapter()` and verify `electron/main.ts`
  retains no legacy `AgentStatusService`, through
  `scripts/task9-embedded-agent-authority.test.mjs` and
  `scripts/task9-server-agent-ipc-adapter.test.mjs`
- [x] 2.9 Retire the Electron hook receiver, provider drivers, and signal
  interpreters, verified by `npm run test:agents` and `npm run build:app`
- [x] 2.10 Treat a managed hook as installed only when attached to its exact
  native event matcher, verified by
  `packages/server-core/test/activity-managed-hooks.test.mjs`
- [x] 2.11 Cancel a pending foreground shell-return retirement when a valid
  provider hook arrives, verified by `agent-service.test.mjs` and
  `agent-terminal-integration.test.mjs`

## 3. Client integration

- [x] 3.1 Drive tab indicators, Agents pane, header activity menu, navigation,
  and acknowledgement from server snapshots, verified by
  `npx playwright test e2e/agent-status-sidebar.spec.ts --grep "native agent lifecycle"`
  and `npm run build:app`
- [x] 3.2 Keep the scoped agent projection live across session navigation so
  `AgentStatusClient.setSessionScope` publishes without inventing a revision or
  transition, verified by `packages/client-core/test/agent-status.test.mjs`
- [x] 3.3 Forward the selected unread Agents-pane entry id through the
  renderer/preload acknowledgement path after focusing its terminal, verified by
  `scripts/task9-agent-acknowledgement-ui.test.mjs`
- [x] 3.4 Expose the canonical fallback projection through `activity.snapshot`,
  `activity.delta`, ordered `activity` events, and `activity.acknowledge`,
  verified by the `activity-protocol` and `activity-client` focused tests
- [x] 3.5 Carry `ActivityClient` in the production Desktop connection context and
  map only canonical snapshots into terminal tabs and header activity state,
  verified by `npm run build:app` and the composition/activity suites
- [x] 3.6 Carry one connection-owned validated workspace snapshot store and
  `AgentStatusClient` in that context so `App` consumes the server projection,
  verified by `scripts/task9-renderer-agent-client.test.mjs`, the workspace
  reconciliation test, and the server agent protocol/composition tests
- [x] 3.7 Preserve root/subagent lineage, ordering, filters, accessibility, and
  reduced-motion behaviour, verified by the focused component/store tests, the
  native lifecycle E2E, and `scripts/agent-ui-components.test.mjs`
- [x] 3.8 Make client reload and resync reproduce the same snapshot without
  inventing transitions, verified by
  `packages/client-core/test/agent-status.test.mjs`
- [x] 3.9 Filter preload agent snapshots to exact, still-active identities,
  verified by `scripts/task9-server-agent-ipc-adapter.test.mjs`

## 4. Tests

- [x] 4.1 Run parser, interpreter, agent reducer, driver, and hook fixtures
  against `server-core` and verify the activity fixture set passes alongside the
  parser/interpreter, driver, hook-runtime, and status-store suites
- [x] 4.2 Test multiple clients receiving identical ordered state and
  acknowledgement revisions, verified by `server-composition.test.mjs`
  reconnecting one of two clients to the live snapshot
- [x] 4.3 Test reconnect, terminal exit, missing hooks, hook recovery, and server
  restart semantics through `standalone-http-transport.test.mjs`,
  `activity-hook-receiver.test.mjs`, and the composed missing-hook fixture
- [x] 4.4 Verify a restarted standalone server with the same data root serves an
  empty `agent.snapshot.entries` to a freshly authenticated client
- [x] 4.5 Test cross-project/session navigation and authorization, verifying an
  activity entry resolves only to its exact project/session and that sibling
  acknowledgement and forged cross-project retargeting are rejected
