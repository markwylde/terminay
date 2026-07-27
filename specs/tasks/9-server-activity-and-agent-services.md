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

- [ ] Keep structured signal parsing beside the server PTY stream and preserve
  unmodified output bytes.
- [ ] Move fallback interpretation, timeouts, foreground-process signals, and
  acknowledgement authority into server-core.
- [ ] Publish ordered project/session activity snapshots and events.
- [ ] Accept scoped focus, viewed, and recent-input facts without making one
  client canonical.

### Agent runtime

- [ ] Move the loopback hook receiver, authentication, environment injection,
  drivers, trust, reducer, and acknowledgement into server-core.
- [ ] Resolve hooks only by exact immutable server terminal session.
- [ ] Preserve provider-hook authority over raw/structured fallback signals.
- [ ] Reject stale, reordered, cross-server, exited-session, malformed, and
  oversized hook events.
- [ ] Reconcile managed Codex and Claude Code hooks in embedded and standalone
  layouts without Electron path assumptions.

### Client integration

- [ ] Drive tab indicators, Agents pane, header activity menu, navigation, and
  acknowledgement from server snapshots.
- [ ] Preserve root/subagent lineage, ordering, filters, accessibility, and
  reduced-motion behaviour.
- [ ] Make client reload/resync reproduce the same snapshot without inventing
  transitions.

### Tests

- [ ] Run parser, interpreter, agent reducer, driver, and hook fixtures against
  server-core.
- [ ] Test multiple clients receiving identical ordered state and
  acknowledgement revisions.
- [ ] Test reconnect, terminal exit, missing hooks, hook recovery, and server
  restart semantics.
- [ ] Test cross-project/session navigation and authorization.

## Acceptance checks

- Two clients see one canonical agent/activity transition sequence.
- Hook-backed agent state cannot be overwritten by terminal fallback signals.
- Renderer reload does not lose the current server snapshot or duplicate an
  agent.
- Terminal exit ends only the entries for that terminal.
- Hook tokens and raw provider payloads never reach clients or logs.

## Definition of done

Terminay Server is the only activity and agent authority, and every client
renders the same scoped ordered state.
