# Server terminal service

## Goal

Move PTY lifecycle and terminal streaming into Terminay Server with resumable
multi-client subscriptions and exact server/project/session authorization.

## Governing specifications

- [Terminal workspace](../features/terminal-workspace.md)
- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)

## Why this is active

PTY hosts run as Node children, but Electron owns their maps, routes output to
one renderer, and kills sessions with `webContentsId`. The server cannot yet
keep a terminal alive across client reload, window close, or remote reconnect.

## Dependencies

- [Standalone and embedded server runtime](./6-standalone-and-embedded-server-runtime.md)

## Work slices

### PTY ownership

- [x] Keep concrete node-pty loading behind a window-independent server
  adapter; server-core tests prove one process survives subscription detach
  and resumes from a known output position.
- [ ] Move spawn configuration, child supervision, cwd/process inspection,
  input, resize, kill, exit, and shutdown into server-core.
- [x] Assign immutable server/project/session ownership at creation.
- [ ] Remove PTY lifetime from Electron renderer/window destruction.
- [x] Represent exit and server-restart interruption exactly once.

### Streams and replay

- [x] Provide a transport-neutral server attachment adapter with per-client
  session high-water marks, detach/resume, and retained-replay gap errors;
  the client facade below uses the same identity and cursor contract.
- [x] Add per-session output positions, bounded replay snapshots, subscriber
  cursors, and duplicate suppression.
- [x] Implement attach/detach/resume over `TerminayClient`; the transport-neutral
  `TerminayTerminalClient` facade exercises canonical terminal commands and
  subscriptions with stale-cursor duplicate suppression.
- [x] Bound queued output and define slow-consumer disconnect/resync.
- [x] Preserve raw output bytes for xterm, recording, activity parsing, and
  other authorized consumers without double capture. Terminal adapter,
  input-source, and PTY lifecycle tests pass with exact byte assertions,
  recording capture, activity parsing, and duplicate-suppressed replay.

### Input and dimensions

- [x] Route keyboard, paste, macro, dictation, MCP, and remote writes through
  one authorized input boundary with backpressure.
- [x] Define terminal-size ownership when several clients attach, including
  release, stale clients, and narrow/mobile viewers.
- [x] Reject input/resize/kill for exited, stale, cross-project, or
  cross-server sessions.

### Compatibility

- [x] Define and test a transport-neutral `TerminayTerminalPanelClient`
  attachment contract that preserves raw xterm bytes and routes input, resize,
  kill, and acknowledgement through the exact terminal attachment.
- [x] Add an opt-in Desktop `TerminalPanel` path that attaches/resumes through
  that contract, preserves the existing xterm surface, and keeps preload as a
  compatibility fallback until host wiring is complete.
- [x] Add a compatibility-only `DesktopTerminalAuthorityAdapter` for the
  remaining non-panel terminal input/resize/kill path; it forwards immutable
  server/project/session identity through `TerminayTerminalClient` and rejects
  renderer/window ownership fields.
- [ ] Adapt the existing Desktop terminal panels to the terminal client
  contract without changing xterm behaviour.
- [ ] Keep splits, search, clipboard, paste, links, drops, zoom, styling, note,
  and exit UX intact.
- [ ] Remove terminal application IPC after the Local client uses the server
  transport.

### Tests

- [ ] Exercise real shells in standalone and embedded modes.
- [x] Test replay positions, retained-buffer gaps, duplicate suppression,
  backpressure, slow clients, disconnect, exit, and shutdown.
- [x] Test two simultaneous clients with competing resize and input.
- [x] Exercise a real `/bin/sh` through the server's `createNodePtyFactory`
  seam; standalone and embedded application harnesses remain open above.
- [ ] Preserve terminal UI E2E coverage through the client contract.

## Acceptance checks

- A PTY survives client reload, disconnect, and native-window close while the
  server remains alive.
- Reconnect resumes from a known output position without duplicate PTY creation
  or acknowledged output.
- Two clients observe one exit event.
- Input and resize affect only the exact authorized live session.
- No Electron window or renderer id determines PTY ownership.

## Definition of done

Terminay Server is the sole PTY and terminal-stream authority. Desktop and web
surfaces are detachable clients with no process ownership.
