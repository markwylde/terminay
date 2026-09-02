## 1. Capture lifecycle

- [x] 1.1 Move start/stop/default policy, output, optional input, resize,
  metadata updates, finalization, and error state into server-core, verified by
  `packages/server-core/test/recordingService.test.mjs`
- [x] 1.2 Capture output and input exactly once at server boundaries, verified
  by asserting one cast event per PTY event regardless of subscriber count
- [x] 1.3 Continue capture through client disconnect, reload, and view movement,
  verified by no-observer capture coverage
- [x] 1.4 Keep active capture server-owned when all observers disconnect and give
  multiple observers lifecycle state without duplicating cast events, verified by
  independent observer-removal tests
- [x] 1.5 Finalize accurately on PTY exit, explicit stop/close, server shutdown,
  writer failure, and restart recovery, verified by the restart-interruption and
  writer-failure fixtures

## 2. Storage and metadata

- [x] 2.1 Validate configured roots and opaque recording ids at the final
  filesystem boundary, verified by traversal and unauthorized-id tests
- [x] 2.2 Preserve asciicast v3 compatibility and atomic adjacent metadata,
  verified by format and metadata-only path coverage
- [x] 2.3 Import and reference supported legacy recording roots without silently
  moving user data, verified by
  `packages/server-core/test/recording-legacy-root.test.mjs`
- [x] 2.4 Add interrupted, missing, malformed, and failed recovery states,
  verified by truncated-file and disk-full fixtures

## 3. Timeline and replay

- [x] 3.1 Implement bounded list/search/filter/group metadata commands, verified
  by `packages/server-core/test/recording-adapter.test.mjs`
- [x] 3.2 Stream replay ranges and chunks with cancellation and backpressure,
  verified by bounded large-replay and cancellation tests
- [x] 3.3 Offer reveal only when a capable host represents the server machine and
  give path/copy guidance elsewhere, verified by the remote reveal-capability test
- [x] 3.4 Require explicit authorized stop and delete and prevent traversal or
  active-writer corruption, verified by active-delete and concurrent-stop tests

## 4. Privacy

- [x] 4.1 Keep input recording default off with disclosure, verified by the
  input-privacy boundary tests
- [x] 4.2 Remove persisted cast paths from the server `RecordingListItem` DTO
  before local or remote transport and keep recording data out of the remote
  application resume DTOs, verified by adapter tests asserting path-free responses
- [x] 4.3 Apply one input-capture policy to keyboard, paste, macro, dictation,
  MCP, and remote writes through the `TerminalInputSourceAdapter` accepted-input
  boundary and `createRecordingInputCapture`, verified by the environment and
  input privacy boundary tests

## 5. Tests

- [x] 5.1 Drive recording state and timeline end to end through `TerminayClient`,
  verified by a framed client test that starts a real `ServerConnection` with the
  `ServerRecordingAdapter` and exercises start, list, bounded replay, and stop
  through `RecordingsClient`
- [x] 5.2 Prove no-observer capture, independent observer removal, restart
  interruption, metadata-only paths, and input/environment privacy boundaries in
  focused service coverage
- [x] 5.3 Test no-client capture, multiple observers, restart interruption,
  truncated files, disk full, path changes, and concurrent stop, verified by
  server-core, replay, and recording-service fixtures; concurrent adapter stops
  are idempotent and a disk-full stream failure persists a path-free failed
  lifecycle
- [x] 5.4 Test bounded large replay, cancellation, unauthorized ids, traversal,
  active delete, and remote reveal capability, verified by the adapter suite
- [x] 5.5 Build the workspace with `npm run build --workspace @terminay/server-core`
  and confirm the focused suites pass
