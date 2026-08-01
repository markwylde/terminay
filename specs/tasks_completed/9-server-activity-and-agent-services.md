# Server activity and agent services

## Goal

Move terminal activity interpretation, provider hook reception, canonical agent
state, acknowledgement, and project/session mapping into Terminay Server.

## Governing specifications

- [Terminal activity signals](../features/terminal-activity-signals.md)
- [Agent status and sidebar](../features/agent-status-and-sidebar.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)

## Why this is active

Signal parsing begins near the PTY, but fallback reduction and presentation
facts are split across Electron and renderer state. Provider hooks and agent
snapshots also depend on Electron process ownership. Multiple clients need one
ordered authority with unchanged hook precedence.

## Dependencies

- [Server terminal service](./8-server-terminal-service.md)

## Work slices

### Terminal activity

- [x] Keep structured signal parsing beside the server PTY stream and preserve
  unmodified output bytes.
- [x] Move fallback interpretation, timeouts, foreground-process signals, and
  acknowledgement authority into server-core. The server model owns the
  contract and the embedded host delegates to it without a parallel Electron
  PTY authority. Evidence: `node --test packages/server-core/test/terminal-service.test.mjs packages/server-core/test/node-pty-adapter.test.mjs scripts/task9-embedded-agent-authority.test.mjs scripts/task9-terminal-authority-renderer-authorization.test.mjs scripts/task9-renderer-handoff.test.mjs scripts/task9-graceful-shutdown.test.mjs` (27 passing).
  - [x] Forward trusted foreground process changes from the `node-pty` adapter
    through the server terminal lifecycle into the composed agent authority.
    The adapter emits deduplicated process/shell facts only while subscribed;
    `TerminalService` preserves immutable server/project/session identity and
    disposes the listener on terminal exit; composition feeds
    `AgentStatusService.foregroundProcessChanged`. Evidence:
    `node-pty-adapter.test.mjs`, `terminal-service.test.mjs`, and
    `agent-terminal-integration.test.mjs`.
  - [x] Migrate the normal embedded terminal path off the Electron PTY-host
    authority. Terminal creation has no PTY-host fallback entry point, and
    embedded inactivity waits delegate through `ServerTerminalAuthority` to
    server-core's `TerminalService`. Server-owned authority bookkeeping covers
    accepted PTY write/resize handling. Evidence:
    `scripts/task9-embedded-agent-authority.test.mjs`,
    `scripts/server-terminal-authority-host-bookkeeping.test.mjs`, and
    `packages/server-core/test/terminal-service.test.mjs`.
  - [x] Retire the obsolete Electron PTY-host runtime and its direct
    fork/supervisor tests. The desktop build no longer emits `ptyHost.js`; the
    server-terminal runtime test covers the replacement authority bookkeeping.
    Evidence: `npm run test:server-terminal-runtime` and
    `scripts/task6-runtime-layout.test.mjs`.
  - [x] Authorize embedded terminal reads and mutations against the attached
    renderer before reaching server-owned terminal state. `get-cwd` and
    `get-buffer` reject unattached renderers; `kill` and remote metadata
    updates become no-ops. Evidence:
    `scripts/task9-terminal-authority-renderer-authorization.test.mjs`.
  - [x] Transfer a terminal renderer subscription during popout and merge by
    subscribing the destination before detaching the source, then reroute MCP
    control. Evidence: `scripts/task9-renderer-handoff.test.mjs` and
    `scripts/server-terminal-authority-host-bookkeeping.test.mjs`.
  - [x] Await and coalesce server-terminal authority shutdown on Desktop quit,
    before allowing the final application exit. Evidence:
    `scripts/task9-graceful-shutdown.test.mjs`.
- [x] Publish ordered project/session activity snapshots and events.
- [x] Accept scoped focus, viewed, and recent-input facts without making one
  client canonical.

### Agent runtime

- [x] Compose the loopback hook receiver, authentication, environment injection,
  drivers, trust, reducer, and acknowledgement into server-core.
  - [x] Compose the reduced agent authority into the standalone server transport
    and start its hook receiver before the default terminal is created. The
    authenticated `agent.snapshot` / `agent.acknowledge` registry publishes
    reduced snapshots only; `agent-protocol`, `agent-service`, terminal
    lifecycle, standalone runtime, and composition tests cover the transport
    path, redaction, two-client convergence, reconnect, and project-scoped
    snapshots/events. `standalone-http-transport.test.mjs` additionally proves
    the foreground CLI → inherited PTY hook → authenticated HTTP client path
    without revealing the hook token.
  - [x] Make the server-owned `agentIntegration.enabled` policy authoritative:
    disabled services inject no hook variables, revoke existing leases, clear
    the reduced snapshot, reject stale hook delivery, and issue fresh leases
    only after re-enable. `agent-service.test.mjs` covers the toggle boundary.
- [x] Resolve hooks only by exact immutable server terminal session.
- [x] Preserve provider-hook authority over raw/structured fallback signals.
- [x] Reject stale, reordered, cross-server, exited-session, malformed, and
  oversized hook events.
- [x] Reconcile managed Codex and Claude Code hooks in embedded and standalone
  layouts without Electron path assumptions. The standalone CLI now composes
  `AgentStatusService`; normal embedded Desktop settings now reconcile through
  that composed service and do not start the Electron compatibility receiver.
  There is no Electron PTY-host compatibility authority in the normal
  embedded runtime. `test:agent-host-reconciliation` runs the composed
  embedded authority and the real standalone CLI: both install and remove the
  managed Codex/Claude hooks while preserving user hooks and never persisting
  endpoint/token credentials.
  - [x] Normal Desktop preload compatibility IPC delegates snapshot and
    acknowledgement to the composed server authority through
    `ServerTerminalAuthority.agentStatusIpcAdapter()`. `electron/main.ts`
    retains neither a legacy `AgentStatusService` nor a PTY-host terminal
    authority; unknown hook-injector session IDs are rejected rather than
    creating state. Evidence:
    `electron/serverTerminalAuthority.ts`, `electron/agentStatus/ipc.ts`,
    `electron/main.ts`, `scripts/task9-embedded-agent-authority.test.mjs`, and
    `scripts/task9-server-agent-ipc-adapter.test.mjs`.
  - [x] Retire the unused Electron hook receiver, provider drivers, and signal
    interpreters. `test:agents` now exercises the server-core hook, managed
    provider, lifecycle, and UI projection suites; no Electron runtime imports
    or owns this second agent authority. Evidence: `npm run test:agents` and
    `npm run build:app`.
  - [x] Treat a managed Codex or Claude hook as installed only when it is
    attached to its exact native event matcher. Reconciliation repairs a
    wrong-matcher Terminay hook while preserving user hooks. Evidence:
    `packages/server-core/test/activity-managed-hooks.test.mjs`.
  - [x] Cancel a pending foreground shell-return retirement when a valid
    provider hook arrives. Evidence:
    `packages/server-core/test/agent-service.test.mjs` and
    `packages/server-core/test/agent-terminal-integration.test.mjs`.

### Client integration

- [x] Drive tab indicators, Agents pane, header activity menu, navigation, and
  acknowledgement from server snapshots. The native lifecycle E2E exercises
  server hook state through tab indicators, the Agents pane, acknowledgement,
  cross-project navigation, waiting attention, and terminal focus; opening or
  closing Explorer preserves the Dockview/terminal ownership state. Evidence:
  `npx playwright test e2e/agent-status-sidebar.spec.ts --grep "native agent lifecycle" --reporter=line`
  and `npm run build:app`.
  - [x] Keep the scoped agent snapshot projection live across session navigation:
    `AgentStatusClient.setSessionScope` publishes a changed visible projection
    without inventing a revision or transition; covered by
    `packages/client-core/test/agent-status.test.mjs`.
  - [x] Agents-pane navigation forwards the selected unread snapshot entry ID
    through the renderer/preload acknowledgement path after focusing its
    terminal; covered by `scripts/task9-agent-acknowledgement-ui.test.mjs`.
  - [x] Expose the canonical fallback projection through authenticated
    `activity.snapshot`, `activity.delta`, ordered `activity` events, and the
    exact-identity `activity.acknowledge` command. `ActivityClient` applies
    snapshot/replay state and resyncs on gaps; `activity-protocol` and
    `activity-client` focused tests cover ordered publication, immutable
    acknowledgement, and client resync.
  - [x] The production Desktop connection context now carries `ActivityClient`
    beside the terminal client. `ProjectWorkspace` maps only its canonical
    snapshots into terminal tabs/header activity state and sends viewed/input
    acknowledgement through `activity.acknowledge`; legacy
    `terminal:activity` and raw-data listeners run only when no server client
    is available. `npm run build:app` and the server composition/activity
    protocol/client suite verify the connected path.
  - [x] The production Desktop connection context now also carries one
    connection-owned validated workspace snapshot store and `AgentStatusClient`.
    Its complete authenticated terminal-session union scopes the reduced agent
    projection; `App` consumes that server projection (not preload snapshots)
    and sends tab/sidebar acknowledgement through `agent.acknowledge`.
    `scripts/task9-renderer-agent-client.test.mjs`, the workspace reconciliation
    test, server agent protocol/composition tests, and `npm run build:app`
    verify the boundary.
- [x] Preserve root/subagent lineage, ordering, filters, accessibility, and
  reduced-motion behaviour. `AgentsSidebar` builds ordered root/subagent trees,
  filters by project, exposes accessible expand/focus controls, and preserves
  reduced-motion styling; focused component/store, the native lifecycle E2E,
  and server-core agent-service tests cover lineage and ordering.
  - [x] Respect `prefers-reduced-motion` by disabling Agents sidebar row and
    disclosure-chevron transitions. Evidence:
    `scripts/agent-ui-components.test.mjs`.
- [x] Make client reload/resync reproduce the same snapshot without inventing
  transitions. The transport-neutral client adapter applies ordered events,
  requires a snapshot on replay gaps, replaces a restarted-server snapshot,
  and suppresses identical snapshots. Evidence:
  `packages/client-core/test/agent-status.test.mjs`.
  - [x] Filter preload agent snapshots and live updates to exact, still-active
    server/project/session identities so exited or remapped sessions cannot
    leak retained agent rows. Evidence:
    `scripts/task9-server-agent-ipc-adapter.test.mjs`.

### Tests

- [x] Run parser, interpreter, agent reducer, driver, and hook fixtures against
  server-core. The server-core activity fixture set passes alongside the
  signal parser/interpreter and agent driver, hook-runtime, and status-store
  suites (22 + 9 + 10 + 12 + 10 + 13 tests).
- [x] Test multiple clients receiving identical ordered state and
  acknowledgement revisions. `server-composition.test.mjs` connects two
  clients, verifies canonical reduced agent revisions, and reconnects one
  client to the live snapshot.
- [x] Test reconnect, terminal exit, missing hooks, hook recovery, and server
  restart semantics.
  - [x] The real foreground standalone HTTP test now proves hook delivery,
    terminal exit making only that terminal's entry inactive, a replacement
    terminal receiving a fresh hook lease, and a freshly connected client
    receiving exactly the current reduced snapshot. It also protects the
    host-environment merge required for dynamically created terminal hooks.
  - [x] `activity-hook-receiver.test.mjs` proves missing-hook recovery,
    exact terminal-exit isolation, rejection of the stale pre-restart lease,
    and successful fresh-lease delivery after receiver restart at the
    receiver boundary.
  - [x] The composed missing-hook fixture proves an unsupported provider hook
    leaves `agent.snapshot` empty while canonical raw terminal activity remains
    available; the standalone restart fixture proves a fresh client sees the
    empty post-restart snapshot. Together with the reconnect/exit/recovery
    case above, this closes the complete lifecycle matrix.
  - [x] `standalone-http-transport.test.mjs` restarts the real foreground
    server with the same data root after live hook-backed agent state, then
    authenticates a fresh client and verifies `agent.snapshot.entries` is
    empty.
- [x] Test cross-project/session navigation and authorization. The server-core
  agent/activity regression proves an activity entry can resolve only to its
  exact project/session and rejects sibling-session acknowledgement and forged
  cross-project retargeting.

## Acceptance checks

- Two clients see one canonical agent/activity transition sequence.
- Hook-backed agent state cannot be overwritten by terminal fallback signals.
- Renderer reload does not lose the current server snapshot or duplicate an
  agent.
- Terminal exit ends only the entries for that terminal.
- Hook tokens and raw provider payloads never reach clients or logs.

## Completion audit

The prior runtime-audit gap is closed: the standalone CLI composes and exposes
the server-owned agent authority, and the focused composition suite verifies
canonical multi-client/reconnect behaviour. Desktop has no parallel Electron
agent authority; the native lifecycle E2E verifies the rendered path, including
the Explorer/Dockview lifecycle. The task is complete only on this evidence,
not merely because its checklist is checked.

## Definition of done

Terminay Server is the only activity and agent authority, and every client
renders the same scoped ordered state.
