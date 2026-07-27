# Server MCP control

## Goal

Move Terminay's local MCP/control endpoint into Terminay Server and resolve
every tool directly against server-owned terminal and project state.

## Governing specifications

- [Terminay MCP server](../features/mcp-server.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)
- [Terminal activity signals](../features/terminal-activity-signals.md)

## Why this is active

The control socket and capability validation live in Electron, while
project-aware tools route into `src/App.tsx`. That renderer round trip prevents
headless use and makes UI state part of the authorization path.

## Dependencies

- [Server terminal service](./8-server-terminal-service.md)
- [Server activity and agent services](./9-server-activity-and-agent-services.md)

## Work slices

### Control endpoint and capability

- [ ] Host the user-only local control socket in Terminay Server.
- [ ] Mint, inject, rotate, and revoke one capability per terminal.
- [ ] Resolve the calling session and implicit project from canonical server
  ownership.
- [ ] Bound framing, request size, concurrency, waits, and output.
- [ ] Keep the endpoint local-only and distinct from remote device auth.

### Tools

- [ ] Implement list/read/status/write/run/open/close/focus/rename/split
  directly against server services.
- [ ] Implement bounded idle, command-completion, and attention waits from
  canonical activity state.
- [ ] Return ambiguity, exit, timeout, cancellation, and revocation explicitly.
- [ ] Remove `control:request` renderer forwarding.

### Stdio adapter and installation

- [ ] Package the headless `terminay mcp` stdio adapter in standalone and
  Desktop-bundled server artifacts.
- [ ] Update Claude Code and Codex install detection, atomic config editing,
  status, and uninstall for the new artifact path.
- [ ] Preserve unrelated provider configuration and changed-entry review.
- [ ] Make the server setting immediately enable or revoke control operations.

### Tests

- [ ] Run protocol, socket, tool, wait, install, and uninstall tests without a
  renderer.
- [ ] Test scope after project/view moves and calling-terminal exit.
- [ ] Test copied/stale tokens, other-project ids, malformed frames, slow
  readers, and concurrent waits.
- [ ] Run focused real Codex and Claude Code smoke tests where available.

## Acceptance checks

- An agent controls only sibling terminals in its implicit project.
- MCP reads and waits work with no attached xterm client.
- Moving views does not widen scope; moving the calling terminal updates or
  revokes capability atomically.
- Disabling MCP or closing the caller invalidates the old token immediately.
- No MCP request is forwarded to a renderer or exposed on a network port.

## Definition of done

MCP is a headless server-local capability surface whose authorization and tool
behaviour depend only on canonical server state.
