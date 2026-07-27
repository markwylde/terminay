# Server recordings

## Goal

Move recording capture, metadata, storage, timeline, replay, and deletion into
Terminay Server with client-independent lifecycle and bounded remote access.

## Governing specifications

- [Terminal recording](../features/recording.md)
- [Terminal workspace](../features/terminal-workspace.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)

## Why this is active

Recording is privileged Electron state tied to existing terminal lifecycle
hooks. The server must capture once at the PTY boundary, continue with no
clients, and expose replay without granting clients filesystem paths.

## Dependencies

- [Server terminal service](./8-server-terminal-service.md)
- [Standalone and embedded server runtime](./6-standalone-and-embedded-server-runtime.md)

## Work slices

### Capture lifecycle

- [ ] Move start/stop/default policy, output, optional input, resize, metadata
  updates, finalization, and error state into server-core.
- [ ] Capture output/input exactly once at server boundaries.
- [ ] Continue through client disconnect, reload, and view movement.
- [ ] Finalize accurately on PTY exit, explicit stop/close, server shutdown,
  writer failure, and restart recovery.

### Storage and metadata

- [ ] Validate configured roots and opaque recording ids at the final
  filesystem boundary.
- [ ] Preserve asciicast v3 compatibility and atomic adjacent metadata.
- [ ] Import/reference supported legacy recording roots without moving user
  data silently.
- [ ] Add interrupted, missing, malformed, and failed recovery states.

### Timeline and replay

- [ ] Implement bounded list/search/filter/group metadata commands.
- [ ] Stream replay ranges/chunks with cancellation and backpressure.
- [ ] Keep reveal available only when a capable host represents the server
  machine; provide path/copy guidance elsewhere.
- [ ] Require explicit authorized stop/delete and prevent traversal or active
  writer corruption.

### Privacy

- [ ] Preserve input-recording default off and disclosure.
- [ ] Ensure casts, metadata, paths, and input never enter hosted signaling,
  manager storage, analytics, or normal logs.
- [ ] Apply the same input capture policy to keyboard, paste, macro, dictation,
  MCP, and remote writes.

### Tests

- [ ] Run recording state and timeline E2E through `TerminayClient`.
- [ ] Test no-client capture, multiple observers, restart interruption,
  truncated files, disk full, path changes, and concurrent stop.
- [ ] Test bounded large replay, cancellation, unauthorized ids, traversal,
  active delete, and remote reveal capability.

## Acceptance checks

- Recording continues after all clients disconnect while the PTY/server live.
- One PTY event produces one cast event regardless of subscriber count.
- Remote authorized replay is bounded and needs no direct filesystem access.
- Server shutdown/restart leaves a valid finalized or interrupted recording.
- Input remains absent unless separately enabled.

## Definition of done

Terminay Server owns the complete recording lifecycle and clients are
replaceable management/replay surfaces.
