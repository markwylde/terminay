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

- [x] Host the user-only local control socket in Terminay Server.
- [x] Mint, inject, rotate, and revoke one capability per terminal.
- [x] Resolve the calling session and implicit project from canonical server
  ownership.
- [x] Authenticate the local peer/capability without trusting a PID supplied in
  the request body; reject absent, invalid, copied, or cross-process
  credentials rather than widening to PID ancestry.
- [x] Bound framing, request size, concurrency, waits, and output.
- [x] Keep the endpoint local-only and distinct from remote device auth.
- [x] Route validated operation names through an explicit server-owned handler
  table; unsupported operations and typed handler failures have bounded,
  stable error envelopes with no renderer or PID fallback.

### Tools

- [x] Provide a typed server-owned adapter boundary for every declared tool;
  validate bounded parameters before dispatch, propagate the request abort
  signal, and normalize scope/backend failures without renderer fallback.
- [x] Implement list/read/status/write/run/open/close directly against the
  server-owned TerminalService with implicit project scope and bounded replay
  or input.
- [ ] Bind focus/rename/split to the canonical server workspace view service;
  the terminal adapter accepts explicit host callbacks but has no view
  authority to call yet.
- [x] Implement bounded idle, command-completion, and attention waits from
  canonical TerminalActivityService state when that service is composed.
- [x] Return ambiguity, exit, timeout, cancellation, and revocation explicitly.
- [ ] Remove `control:request` renderer forwarding.

### Stdio adapter and installation

- [x] Expose a server-owned `terminay mcp` stdio entry for all declared tools;
  it connects only to the inherited local socket/token, advertises the
  bounded schemas, passes MCP arguments through the typed adapter boundary,
  and preserves typed control error codes in renderer-free results.
- [x] Package the headless `terminay mcp` stdio adapter in standalone and
  Desktop-bundled server artifacts. `npm run build:app` emits the
  renderer-free `dist-electron/serverMcpEntry.js`; standalone manifest and
  desktop artifact tests verify both entry points and reject Electron imports.
- [x] Update Claude Code and Codex install detection, atomic config editing,
  status, and uninstall for the new artifact path. `mcp-install-providers.test`
  covers the bundled `serverMcpEntry.js` command contract, status, idempotent
  install, permission preservation, malformed-config refusal, and uninstall.
- [x] Preserve unrelated provider configuration, file permissions, and
  changed-entry review; never silently replace a user-modified Terminay entry.
- [ ] Make the server setting immediately enable or revoke control operations.

### Tests

- [x] Run protocol, socket, tool, wait, install, and uninstall tests without a
  renderer.
- [x] Test scope after a project move and calling-terminal exit; the old
  capability is revoked before the replacement project scope is usable.
- [ ] Test scope after workspace/view moves; view identity is not yet exposed
  by the server control adapter.
- [x] Test copied/stale tokens, other-project ids, malformed frames, slow
  readers, forged PIDs, unbounded partial frames, concurrency limits, and
  concurrent waits.
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
