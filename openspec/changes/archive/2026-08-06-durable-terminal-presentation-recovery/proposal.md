## Why

Every terminal attachment was treated as a fresh emulator and asked for replay
from byte zero, and the renderer rebuilt xterm whenever unrelated project
context changed — including when `CmdOrCtrl+R` changed the project root. Worse,
a fresh display only worked while the whole transcript fitted inside the 32-KiB
initial command-result allowance; past that a local or remote user saw
`presentation_unavailable` even though the server still held the complete
transcript.

## What Changes

- Tie xterm lifetime to the Dockview panel and the immutable terminal session
  identity, not to project-root, sidebar, file-upload, settings, or layout
  context. A surviving emulator resumes from its last rendered and acknowledged
  byte position; `freshPresentation` is used only when the emulator is
  genuinely empty.
- Add a server-owned bounded headless terminal state machine per live PTY,
  using the pinned `@xterm/headless` and `@xterm/addon-serialize` versions and
  the same canonical dimensions and emulator options as clients.
- Define a checkpoint: serialized screen and mode restoration bytes at a
  parser-safe raw position `C`, the ordered raw output and resize tail from `C`
  to the stream head `H`, dimensions, a format version, and a server-generated
  opaque identifier.
- Fetch snapshot bytes through the existing binary query-result body rather
  than base64-encoded JSON, pinned to the exact
  `{serverId, projectId, sessionId, clientId, attachmentId}` boundary.
- **BREAKING** for the previous presentation path: remove
  `presentation_unavailable` decisions based on complete transcript size or the
  32-KiB command-header allowance, and remove the byte-zero fresh-attach
  surrogate.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `terminal-workspace`: attach begins at a valid presentation boundary,
  checkpoint hydration is authorization-scoped, and layout changes preserve a
  mounted terminal.
- `terminal-stream-congestion-and-recovery`: adds the contiguous
  checkpoint-to-live transition and its bounded catch-up and failure rules.

## Impact

- `packages/server-core`: checkpoint authority with injected clock and id
  generation, ordered checkpoint state queue, pinned-checkpoint lifecycle.
- Protocol: checkpoint metadata on attach plus an attachment-scoped binary
  checkpoint query.
- Renderer: terminal-client resolution depends only on stable primitives;
  hydration buffers, restores, drains, and acknowledges only bytes xterm wrote.
- Pinned dependency versions for `@xterm/headless` and
  `@xterm/addon-serialize`.
