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

- [x] Move start/stop/default policy, output, optional input, resize, metadata
  updates, finalization, and error state into server-core.
- [x] Capture output/input exactly once at server boundaries.
- [x] Continue through client disconnect, reload, and view movement.
  - [x] Active capture remains server-owned when all observers disconnect;
    multiple observers receive lifecycle state without duplicating cast events.
- [x] Finalize accurately on PTY exit, explicit stop/close, server shutdown,
  writer failure, and restart recovery.

### Storage and metadata

- [x] Validate configured roots and opaque recording ids at the final
  filesystem boundary.
- [x] Preserve asciicast v3 compatibility and atomic adjacent metadata.
- [x] Import/reference supported legacy recording roots without moving user
  data silently.
- [x] Add interrupted, missing, malformed, and failed recovery states.

### Timeline and replay

- [x] Implement bounded list/search/filter/group metadata commands.
- [x] Stream replay ranges/chunks with cancellation and backpressure.
- [x] Keep reveal available only when a capable host represents the server
  machine; provide path/copy guidance elsewhere.
- [x] Require explicit authorized stop/delete and prevent traversal or active
  writer corruption.

### Privacy

- [x] Preserve input-recording default off and disclosure.
- [x] Ensure casts, metadata, paths, and input never enter hosted signaling,
  manager storage, analytics, or normal logs. Persisted cast paths are removed
  from the server `RecordingListItem` DTO before local or remote transport;
  recording adapter tests assert path-free responses, and recording data is not
  part of the remote application resume DTOs.
- [x] Apply the same input capture policy to keyboard, paste, macro, dictation,
  MCP, and remote writes through the server `TerminalInputSourceAdapter`'s
  single accepted-input boundary and `createRecordingInputCapture` callback.

### Tests

- [x] Run recording state and timeline E2E through `TerminayClient`. The
  framed client test starts a real `ServerConnection` with the
  `ServerRecordingAdapter`, then drives start, list, bounded replay, and stop
  through `RecordingsClient`.
- [x] Focused service coverage proves no-observer capture, independent observer
  removal, restart interruption, metadata-only paths, and input/environment
  privacy boundaries.
- [x] Test no-client capture, multiple observers, restart interruption,
  truncated files, disk full, path changes, and concurrent stop. Server-core,
  replay, and recording-service fixtures cover each case; concurrent adapter
  stops are idempotent and disk-full stream failures persist a path-free failed
  lifecycle.
- [x] Test bounded large replay, cancellation, unauthorized ids, traversal,
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

## Server-core slice evidence

The server-core recording slice now provides a transport-neutral
`ServerRecordingAdapter` for authorized `recordings.list`,
`recordings.replay`, `recordings.start`, `recordings.stop`,
`recordings.delete`, and `recordings.reveal` operations. Replay remains
bounded and cancellable, command handlers enforce server/project/scope
authorization, and reveal invokes a host callback without returning a cast
path to the client. Adapter disposal or client disconnect has no effect on an
active `RecordingService` session. `importLegacyRoot` registers historical
roots by metadata-only opaque reference, keeps unavailable roots in the
library index, and never moves user data.

Focused evidence is in
`packages/server-core/test/recordingService.test.mjs` and
`packages/server-core/test/recording-adapter.test.mjs` and
`packages/server-core/test/recording-legacy-root.test.mjs`: the service and
protocol adapter tests cover observer-independent capture, restart interruption,
bounded replay, and privacy boundaries after
`npm run build --workspace @terminay/server-core`. Full
`TerminayClient` E2E, host UI reveal integration, and legacy-root migration
remain separate acceptance work and are not claimed by this slice.
