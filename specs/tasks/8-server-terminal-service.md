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

- [ ] Move spawn configuration, child supervision, cwd/process inspection,
  input, resize, kill, exit, and shutdown into server-core.
- [ ] Assign immutable server/project/session ownership at creation.
- [ ] Remove PTY lifetime from Electron renderer/window destruction.
- [ ] Represent exit and server-restart interruption exactly once.

### Streams and replay

- [ ] Add per-session output positions, bounded replay snapshots, subscriber
  cursors, and duplicate suppression.
- [ ] Implement attach/detach/resume over `TerminayClient`.
- [ ] Bound queued output and define slow-consumer disconnect/resync.
- [ ] Preserve raw output bytes for xterm, recording, activity parsing, and
  other authorized consumers without double capture.

### Input and dimensions

- [ ] Route keyboard, paste, macro, dictation, MCP, and remote writes through
  one authorized input boundary with backpressure.
- [ ] Define terminal-size ownership when several clients attach, including
  release, stale clients, and narrow/mobile viewers.
- [ ] Reject input/resize/kill for exited, stale, cross-project, or
  cross-server sessions.

### Compatibility

- [ ] Adapt the existing Desktop terminal panels to the terminal client
  contract without changing xterm behaviour.
- [ ] Keep splits, search, clipboard, paste, links, drops, zoom, styling, note,
  and exit UX intact.
- [ ] Remove terminal application IPC after the Local client uses the server
  transport.

### Tests

- [ ] Exercise real shells in standalone and embedded modes.
- [ ] Test replay positions, retained-buffer gaps, duplicate suppression,
  backpressure, slow clients, disconnect, exit, and shutdown.
- [ ] Test two simultaneous clients with competing resize and input.
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
