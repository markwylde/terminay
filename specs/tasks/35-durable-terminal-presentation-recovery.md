# Durable terminal presentation recovery

## Goal

Keep local and remote terminal displays correct and interactive across
unrelated workspace updates, transient reconnects, renderer reloads, and an
arbitrarily long or high-output PTY lifetime without placing terminal history
inside the command header.

## Governing specifications

- [Terminal workspace](../features/terminal-workspace.md)
- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)
- [Multi-client terminal presentation](./33-multi-client-terminal-presentation.md)

## Current gap

Every `TerminalPanel` attachment is treated as a fresh emulator and requests
replay from byte zero. The renderer also rebuilds xterm when the broader
project context changes, including when `CmdOrCtrl+R` changes the project root.

The server calls a complete transcript a safe presentation only while it fits
inside the 32-KiB initial command-result replay allowance. Once terminal output
passes that allowance, a fresh local or remote display receives
`presentation_unavailable` even when the embedded server still retains the
complete transcript. The current hostile-control-sequence test proves only
whole-transcript replay below the allowance; it does not create, transfer, or
hydrate a checkpoint.

## Architecture decisions

### Stable renderer lifecycle

- Xterm lifetime is tied to the Dockview panel and immutable terminal session
  identity, not project-root, sidebar, file-upload, settings, or layout context.
- Terminal settings and dimensions update the existing emulator through their
  dedicated effects. Browser drop-upload capabilities may change independently
  without rebuilding the emulator or attachment.
- A surviving emulator resumes from its last rendered and acknowledged byte
  position. `freshPresentation` is used only when the emulator is genuinely
  empty.

### Canonical checkpoint authority

- Terminay Server owns one bounded headless xterm state machine per live PTY.
  It uses the pinned `@xterm/headless` and `@xterm/addon-serialize` versions and
  the same canonical terminal dimensions and emulator options as clients.
- Accepted PTY output enters the headless emulator exactly once in raw-byte
  order. Resize transitions are ordered with output and checkpoint positions.
  Emulator-generated replies are never forwarded to the PTY; presentation
  input remains solely under the existing controller lease.
- A checkpoint contains serialized screen and mode restoration bytes at a
  parser-safe raw position `C`, plus the ordered raw output/resize tail from
  `C` to the current stream head `H`, dimensions, format version, and a
  server-generated opaque identifier. A snapshot is never taken in the middle
  of UTF-8 or an ANSI control sequence. It includes bounded scrollback but
  always preserves the complete active screen, alternate screen, cursor,
  styles, and terminal modes represented at `C`.
- Snapshot bytes, parser work, retained tail, checkpoint frequency, per-session
  state, pinned-checkpoint count and lifetime, and per-attachment hydration
  queues have named hard limits. Crossing a limit fails that fresh hydration
  explicitly without terminating the PTY or affecting an already attached
  display.

### Race-free binary hydration

- Fresh attach pins an immutable checkpoint to the exact authorized
  `{serverId, projectId, sessionId, clientId, attachmentId}` boundary and begins
  output delivery at its checkpoint position.
- The attach command returns only bounded checkpoint metadata. Snapshot bytes
  are fetched through the existing binary query-result body rather than
  base64-encoded JSON. The checkpoint operation validates the exact attachment,
  opaque checkpoint id, project claim, authorization scope, expiry, and size.
- The client establishes its exact attachment subscription before fetching the
  pinned checkpoint and buffers subsequent output under a hard byte limit. It
  restores the checkpoint state into the empty xterm at geometry `C`, applies
  the ordered `C`→`H` raw output/resize tail, then enters live delivery.
  Positions must be contiguous; overlap, gap, token mismatch, expiry, or queue
  overflow fails closed.
- A pinned checkpoint is single-attachment, immutable, bounded, and released
  after successful fetch, detach, client close, timeout, or session exit. It
  contains terminal presentation only and is never persisted as workspace
  metadata or exposed across a project/session boundary.

## Implementation slices

### 1. Correct lifecycle and reproduce the regression

- [x] Make terminal-client resolution depend only on stable panel client,
  server id, project id, client id, and session id primitives.
- [x] Separate xterm construction/disposal from attachment reconnect and from
  browser file-drop/project-root context.
- [x] Track the rendered acknowledgement cursor owned by the mounted emulator
  and use resume for a surviving display.
- [x] Add a focused renderer test proving project-root, sidebar, settings, and
  dimension updates preserve the same emulator and attachment.
- [x] Extend the local `CmdOrCtrl+O` then `CmdOrCtrl+R` E2E reproduction past
  1 MiB of terminal output and assert prior content plus subsequent input remain
  usable.

### 2. Build the checkpoint authority

- [x] Add a transport-neutral checkpoint authority in `server-core` with
  injected clock/id generation and explicit resource limits.
- [x] Feed raw PTY bytes and canonical resize transitions through one ordered
  checkpoint state queue without delaying ordinary terminal subscribers.
- [x] Serialize and pin versioned checkpoints with exact output positions and
  bounded active-screen/scrollback state.
- [x] Dispose checkpoint state on session exit, interruption, and shutdown;
  expire abandoned attachment pins without affecting the PTY.
- [x] Prove the headless authority never forwards device, status, colour,
  cursor, focus, mouse, or window-query replies into terminal input.

### 3. Add the protocol and client hydration contract

- [x] Replace the byte-zero fresh-attach surrogate with checkpoint metadata and
  checkpoint-position attachment.
- [x] Add an exact attachment-scoped binary checkpoint query and enforce body,
  queue, timeout, authorization, and identity limits on the server.
- [x] Subscribe before checkpoint retrieval, buffer the tail, hydrate once,
  drain contiguously, and acknowledge only bytes actually written by xterm.
- [x] Preserve the existing lightweight resume path for a surviving emulator
  and keep presentation ownership, dimensions, and takeover behavior unchanged.
- [x] Remove `presentation_unavailable` decisions based solely on complete
  transcript size or the 32-KiB command-header allowance.

### 4. Verify correctness and bounds

- [x] Round-trip checkpoints at every byte boundary around UTF-8, CSI, OSC,
  DCS, hyperlinks, alternate-screen, cursor/style, mouse/focus,
  bracketed-paste, and synchronized-output sequences.
- [x] Test output and resize arriving before pin, during serialization, between
  attach and subscribe, during binary fetch, during xterm write callbacks, and
  at the transition to live delivery; assert no gap or duplicate.
- [x] Test authorization mismatch, token guessing, cross-session reuse,
  duplicate fetch, expiry, detach, exit, oversized state, parser backlog,
  hydration queue overflow, and transport disconnect.
- [x] Test fresh recovery after more than the server raw replay window, after
  more than 1 MiB and many millions of output bytes, and with multiple local
  and remote observers.
- [x] Measure and assert checkpoint CPU, heap, serialized size, pinned-state,
  and hydration-queue ceilings under hostile output and maximum supported
  terminal geometry.
- [x] Run focused workspace tests, native server/client suites, boundary and
  type checks, then the Electron scenarios only through `npm run test:e2e`.

## Acceptance checks

- `CmdOrCtrl+R`, `CmdOrCtrl+O`, window resize, settings changes, and project
  metadata updates do not clear, replace, detach, or rehydrate a live display.
- A surviving emulator resumes from its acknowledged cursor after transient
  transport loss without replaying its lifetime transcript.
- A genuinely fresh local or remote emulator reconstructs the same visible
  grid, alternate-screen state, cursor, modes, and canonical dimensions after
  terminal output exceeds both 1 MiB and the retained raw replay window.
- Output produced throughout hydration is rendered exactly once and remains
  interactive under the existing presentation lease.
- Attach headers remain within protocol limits; checkpoint data uses a bounded
  binary body and never widens authorization or terminal-session scope.
- Resource exhaustion produces a precise recoverability error for the new
  display while the PTY and existing displays continue safely.

## Definition of done

The byte-zero/32-KiB presentation surrogate is removed, the server owns a
bounded canonical checkpoint path, clients hydrate without a snapshot/live
handoff gap, unrelated UI updates preserve mounted terminals, focused hostile
and load tests pass, and local plus remote Electron recovery scenarios pass in
the Docker E2E suite.
